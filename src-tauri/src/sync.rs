use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const DEFAULT_PORT: u16 = 47821;
const PORT_ATTEMPTS: u16 = 10;
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const AUTH_FAILURE_LIMIT: u32 = 30;
const AUTH_FAILURE_WINDOW: Duration = Duration::from_secs(60);

/// Serializes every read-check-write of the snapshot file, whether it comes
/// from the phone over HTTP or from this app's own commands.
static BLOB_LOCK: Mutex<()> = Mutex::new(());

struct ServerContext {
    token: String,
    pairing_id: String,
    version: String,
    device_name: String,
    last_peer_at: Mutex<Option<String>>,
    failed_auth: Mutex<(u32, Instant)>,
}

struct RunningServer {
    stop: Arc<AtomicBool>,
    port: u16,
    context: Arc<ServerContext>,
}

#[derive(Default)]
pub struct SyncServerState {
    running: Mutex<Option<RunningServer>>,
}

impl SyncServerState {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    running: bool,
    port: Option<u16>,
    addresses: Vec<String>,
    blob_etag: Option<String>,
    blob_size: u64,
    last_peer_at: Option<String>,
    has_data: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobRead {
    contents: String,
    etag: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BlobReceived {
    etag: String,
    size: usize,
}

fn blob_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    Ok(dir.join("sync-blob.bin"))
}

fn etag_of(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("\"{}\"", hex)
}

fn current_blob(path: &PathBuf) -> Option<Vec<u8>> {
    fs::read(path).ok()
}

fn atomic_write(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_file_name("sync-blob.tmp");
    fs::write(&temp, bytes).map_err(|error| format!("写入同步数据失败：{error}"))?;
    match fs::rename(&temp, path) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::write(path, bytes).map_err(|error| format!("保存同步数据失败：{error}"))?;
            let _ = fs::remove_file(&temp);
            Ok(())
        }
    }
}

fn secure_eq(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in left.as_bytes().iter().zip(right.as_bytes()) {
        diff |= a ^ b;
    }
    diff == 0
}

fn header_value(request: &Request, name: &str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|header| header.value.as_str().to_string())
}

fn bearer_token(request: &Request) -> Option<String> {
    let value = header_value(request, "authorization")?;
    value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))
        .map(|token| token.trim().to_string())
}

fn respond(request: Request, status: u16, body: String, extra: Vec<Header>) {
    let mut response = Response::from_string(body)
        .with_status_code(StatusCode(status))
        .with_header(
            Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap(),
        )
        .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap())
        .with_header(
            Header::from_bytes("Access-Control-Allow-Methods", "GET, PUT, OPTIONS").unwrap(),
        )
        .with_header(
            Header::from_bytes(
                "Access-Control-Allow-Headers",
                "Authorization, Content-Type, If-Match",
            )
            .unwrap(),
        )
        .with_header(Header::from_bytes("Access-Control-Expose-Headers", "ETag").unwrap());
    for header in extra {
        response = response.with_header(header);
    }
    let _ = request.respond(response);
}

fn etag_header(etag: &str) -> Header {
    Header::from_bytes("ETag", etag).unwrap()
}

fn is_authorized(request: &Request, context: &ServerContext) -> bool {
    bearer_token(request)
        .map(|token| secure_eq(&token, &context.token))
        .unwrap_or(false)
}

fn auth_failure_allowed(context: &ServerContext) -> bool {
    let Ok(mut state) = context.failed_auth.lock() else {
        return true;
    };
    if state.1.elapsed() > AUTH_FAILURE_WINDOW {
        *state = (0, Instant::now());
    }
    if state.0 >= AUTH_FAILURE_LIMIT {
        return false;
    }
    state.0 += 1;
    true
}

fn handle_request<F>(
    mut request: Request,
    context: &ServerContext,
    path: &PathBuf,
    notify_blob: F,
) where
    F: Fn(&str, usize),
{
    let method = request.method().clone();

    if method == Method::Options {
        respond(request, 204, String::new(), Vec::new());
        return;
    }

    let url = request.url().to_string();
    let path_only = url.split('?').next().unwrap_or("");

    if method == Method::Get && path_only == "/v1/info" {
        let has_data = current_blob(path)
            .map(|bytes| !bytes.is_empty())
            .unwrap_or(false);
        let body = serde_json::json!({
            "app": "账页",
            "protocol": 1,
            "version": context.version,
            "name": context.device_name,
            "pairingId": context.pairing_id,
            "hasData": has_data,
        })
        .to_string();
        respond(request, 200, body, Vec::new());
        return;
    }

    if path_only != "/v1/blob" {
        respond(
            request,
            404,
            "{\"error\":\"not found\"}".to_string(),
            Vec::new(),
        );
        return;
    }

    if !is_authorized(&request, context) {
        if !auth_failure_allowed(context) {
            respond(
                request,
                429,
                "{\"error\":\"too many failed attempts\"}".to_string(),
                Vec::new(),
            );
            return;
        }
        respond(
            request,
            401,
            "{\"error\":\"unauthorized\"}".to_string(),
            Vec::new(),
        );
        return;
    }

    if let Ok(mut last) = context.last_peer_at.lock() {
        *last = Some(chrono::Local::now().to_rfc3339());
    }

    if method == Method::Get {
        match current_blob(path) {
            Some(bytes) if !bytes.is_empty() => {
                let etag = etag_of(&bytes);
                let body = String::from_utf8_lossy(&bytes).to_string();
                respond(request, 200, body, vec![etag_header(&etag)]);
            }
            _ => {
                respond(
                    request,
                    404,
                    "{\"error\":\"no snapshot\"}".to_string(),
                    Vec::new(),
                );
            }
        }
        return;
    }

    if method == Method::Put {
        let declared = header_value(&request, "content-length")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        if declared > MAX_BODY_BYTES {
            respond(
                request,
                413,
                "{\"error\":\"payload too large\"}".to_string(),
                Vec::new(),
            );
            return;
        }

        let mut body = Vec::new();
        let mut reader = request.as_reader().take((MAX_BODY_BYTES + 1) as u64);
        if reader.read_to_end(&mut body).is_err() {
            respond(
                request,
                400,
                "{\"error\":\"cannot read body\"}".to_string(),
                Vec::new(),
            );
            return;
        }
        if body.is_empty() || body.len() > MAX_BODY_BYTES {
            respond(
                request,
                413,
                "{\"error\":\"payload too large\"}".to_string(),
                Vec::new(),
            );
            return;
        }
        if std::str::from_utf8(&body).is_err() {
            respond(
                request,
                400,
                "{\"error\":\"body must be utf-8\"}".to_string(),
                Vec::new(),
            );
            return;
        }

        // The check and the write must see the same file, even if the desktop
        // app writes its reply at the same moment.
        let _guard = BLOB_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        let current = current_blob(path).filter(|bytes| !bytes.is_empty());
        let current_etag = current.as_ref().map(|bytes| etag_of(bytes));
        let if_match = header_value(&request, "if-match");
        let matched = match (&if_match, &current_etag) {
            (Some(value), Some(etag)) => value == etag,
            (Some(value), None) => value.trim() == "*",
            (None, _) => false,
        };
        if !matched {
            let mut extra = Vec::new();
            if let Some(etag) = &current_etag {
                extra.push(etag_header(etag));
            }
            respond(
                request,
                409,
                "{\"error\":\"etag mismatch\"}".to_string(),
                extra,
            );
            return;
        }

        if let Err(error) = atomic_write(path, &body) {
            respond(
                request,
                500,
                serde_json::json!({ "error": error }).to_string(),
                Vec::new(),
            );
            return;
        }
        let etag = etag_of(&body);
        let size = body.len();
        drop(_guard);
        notify_blob(&etag, size);
        respond(
            request,
            200,
            serde_json::json!({ "etag": etag, "size": size }).to_string(),
            vec![etag_header(&etag)],
        );
        return;
    }

    respond(
        request,
        405,
        "{\"error\":\"method not allowed\"}".to_string(),
        Vec::new(),
    );
}

fn bind_server(port: u16) -> Result<(Server, u16), String> {
    let mut last_error = String::new();
    for offset in 0..PORT_ATTEMPTS {
        let candidate = port + offset;
        match Server::http(format!("0.0.0.0:{candidate}")) {
            Ok(server) => return Ok((server, candidate)),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(format!("无法启动同步服务：{last_error}"))
}

fn lan_addresses(port: u16) -> Vec<String> {
    let mut addresses = Vec::new();
    if let Ok(interfaces) = if_addrs::get_if_addrs() {
        for interface in interfaces {
            let ip = interface.ip();
            if ip.is_ipv4() && !ip.is_loopback() && !ip.is_unspecified() {
                addresses.push(format!("{ip}:{port}"));
            }
        }
    }
    addresses.sort();
    addresses.dedup();
    addresses
}

fn status_for(app: &AppHandle, running: &RunningServer) -> Result<ServerStatus, String> {
    let path = blob_path(app)?;
    let bytes = current_blob(&path);
    Ok(ServerStatus {
        running: true,
        port: Some(running.port),
        addresses: lan_addresses(running.port),
        blob_size: bytes.as_ref().map(|b| b.len() as u64).unwrap_or(0),
        blob_etag: bytes.as_ref().map(|b| etag_of(b)),
        last_peer_at: running
            .context
            .last_peer_at
            .lock()
            .ok()
            .and_then(|value| value.clone()),
        has_data: bytes.map(|b| !b.is_empty()).unwrap_or(false),
    })
}

#[tauri::command]
pub fn sync_server_start(
    app: AppHandle,
    state: tauri::State<'_, SyncServerState>,
    token: String,
    pairing_id: String,
    version: String,
    device_name: String,
    preferred_port: Option<u16>,
) -> Result<ServerStatus, String> {
    let path = blob_path(&app)?;
    let mut slot = state
        .running
        .lock()
        .map_err(|_| "同步服务状态不可用".to_string())?;

    if let Some(existing) = slot.as_ref() {
        if existing.context.token == token && existing.context.pairing_id == pairing_id {
            return status_for(&app, existing);
        }
        existing.stop.store(true, Ordering::SeqCst);
        *slot = None;
        // Give the old accept loop a moment to release the port.
        drop(slot);
        thread::sleep(Duration::from_millis(700));
        slot = state
            .running
            .lock()
            .map_err(|_| "同步服务状态不可用".to_string())?;
    }

    let (server, port) = bind_server(preferred_port.unwrap_or(DEFAULT_PORT))?;
    let server = Arc::new(server);
    let stop = Arc::new(AtomicBool::new(false));
    let context = Arc::new(ServerContext {
        token,
        pairing_id,
        version,
        device_name,
        last_peer_at: Mutex::new(None),
        failed_auth: Mutex::new((0, Instant::now())),
    });

    let thread_server = server.clone();
    let thread_stop = stop.clone();
    let thread_context = context.clone();
    let thread_app = app.clone();
    let thread_path = path.clone();

    thread::spawn(move || {
        while !thread_stop.load(Ordering::SeqCst) {
            match thread_server.recv_timeout(Duration::from_millis(400)) {
                Ok(Some(request)) => {
                    handle_request(
                        request,
                        &thread_context,
                        &thread_path,
                        |etag, size| {
                            let _ = thread_app.emit(
                                "sync-blob-received",
                                BlobReceived {
                                    etag: etag.to_string(),
                                    size,
                                },
                            );
                        },
                    );
                }
                Ok(None) => {}
                Err(_) => break,
            }
        }
    });

    let running = RunningServer {
        stop,
        port,
        context,
    };
    let status = status_for(&app, &running)?;
    *slot = Some(running);
    Ok(status)
}

#[tauri::command]
pub fn sync_server_stop(state: tauri::State<'_, SyncServerState>) -> Result<(), String> {
    let mut slot = state
        .running
        .lock()
        .map_err(|_| "同步服务状态不可用".to_string())?;
    if let Some(server) = slot.take() {
        server.stop.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub fn sync_server_status(
    app: AppHandle,
    state: tauri::State<'_, SyncServerState>,
) -> Result<ServerStatus, String> {
    let path = blob_path(&app)?;
    let bytes = current_blob(&path);
    let slot = state
        .running
        .lock()
        .map_err(|_| "同步服务状态不可用".to_string())?;
    let (running, port, last_peer_at) = match slot.as_ref() {
        Some(server) => (
            true,
            Some(server.port),
            server
                .context
                .last_peer_at
                .lock()
                .ok()
                .and_then(|value| value.clone()),
        ),
        None => (false, None, None),
    };
    Ok(ServerStatus {
        running,
        port,
        addresses: port.map(lan_addresses).unwrap_or_default(),
        blob_size: bytes.as_ref().map(|b| b.len() as u64).unwrap_or(0),
        blob_etag: bytes.as_ref().map(|b| etag_of(b)),
        last_peer_at,
        has_data: bytes.map(|b| !b.is_empty()).unwrap_or(false),
    })
}

#[tauri::command]
pub fn sync_server_read_blob(app: AppHandle) -> Result<Option<BlobRead>, String> {
    let path = blob_path(&app)?;
    match current_blob(&path) {
        Some(bytes) if !bytes.is_empty() => Ok(Some(BlobRead {
            etag: etag_of(&bytes),
            contents: String::from_utf8_lossy(&bytes).to_string(),
        })),
        _ => Ok(None),
    }
}

#[tauri::command]
pub fn sync_server_write_blob(app: AppHandle, contents: String) -> Result<String, String> {
    let path = blob_path(&app)?;
    let bytes = contents.as_bytes();
    if bytes.len() > MAX_BODY_BYTES {
        return Err("同步数据太大".to_string());
    }
    let _guard = BLOB_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    atomic_write(&path, bytes)?;
    Ok(etag_of(bytes))
}

/// Writes the desktop's own snapshot only if nobody else wrote meanwhile.
/// `None` means "the caller saw no file"; a quoted ETag means "unchanged since
/// this ETag". Returns the new ETag, or `None` when the write lost a race.
fn write_blob_if_matches(
    path: &PathBuf,
    contents: &[u8],
    expected: Option<&str>,
) -> Result<Option<String>, String> {
    if contents.is_empty() {
        return Err("同步数据不能为空".to_string());
    }
    if contents.len() > MAX_BODY_BYTES {
        return Err("同步数据太大".to_string());
    }

    let _guard = BLOB_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let current = current_blob(path).filter(|bytes| !bytes.is_empty());
    let current_etag = current.as_ref().map(|bytes| etag_of(bytes));
    let matches = match (expected, &current_etag) {
        (Some(value), Some(etag)) => value == etag,
        (Some(value), None) => value.trim() == "*",
        (None, None) => true,
        (None, Some(_)) => false,
    };
    if !matches {
        return Ok(None);
    }
    atomic_write(path, contents)?;
    Ok(Some(etag_of(contents)))
}

#[tauri::command]
pub fn sync_server_write_blob_if(
    app: AppHandle,
    contents: String,
    expected_etag: Option<String>,
) -> Result<Option<String>, String> {
    let path = blob_path(&app)?;
    write_blob_if_matches(&path, contents.as_bytes(), expected_etag.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::{Shutdown, SocketAddr, TcpStream};

    fn test_context() -> ServerContext {
        ServerContext {
            token: "test-token".to_string(),
            pairing_id: "pairing-1".to_string(),
            version: "3.3.0".to_string(),
            device_name: "电脑".to_string(),
            last_peer_at: Mutex::new(None),
            failed_auth: Mutex::new((0, Instant::now())),
        }
    }

    fn temp_path(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "zhangye-sync-test-{}-{}.bin",
            std::process::id(),
            label
        ));
        let _ = fs::remove_file(&path);
        path
    }

    fn header_value(response: &str, name: &str) -> Option<String> {
        response.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            if key.eq_ignore_ascii_case(name) {
                Some(value.trim().to_string())
            } else {
                None
            }
        })
    }

    fn body(response: &str) -> &str {
        response.split("\r\n\r\n").nth(1).unwrap_or("")
    }

    #[test]
    fn serves_info_without_auth_and_guards_the_blob() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let path = temp_path("auth");
        // info is public so the phone can verify it found the right app.
        let response = exchange_server(&server, &path, "GET /v1/info HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        assert!(body(&response).contains("\"pairingId\":\"pairing-1\""));

        let response = exchange_server(&server, &path, "GET /v1/blob HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 401"), "{response}");

        let response = exchange_server(&server, &path, "GET /v1/blob HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer wrong\r\nConnection: close\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 401"), "{response}");

        let response = exchange_server(&server, &path, "GET /v1/blob HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer test-token\r\nConnection: close\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 404"), "{response}");

        let response = exchange_server(&server, &path, "OPTIONS /v1/blob HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 204"), "{response}");
    }

    #[test]
    fn enforces_if_match_and_returns_etags() {
        let server = Server::http("127.0.0.1:0").unwrap();
        let path = temp_path("etag");

        let put = "PUT /v1/blob HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer test-token\r\nIf-Match: *\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello";
        let response = exchange_server(&server, &path, put);
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        let etag = header_value(&response, "etag").expect("etag header");
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");

        let get = "GET /v1/blob HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer test-token\r\nConnection: close\r\n\r\n";
        let response = exchange_server(&server, &path, get);
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        assert_eq!(body(&response), "hello");
        assert_eq!(header_value(&response, "etag"), Some(etag.clone()));

        // Missing If-Match after data exists is a conflict, not an overwrite.
        let put_without = "PUT /v1/blob HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer test-token\r\nContent-Length: 3\r\nConnection: close\r\n\r\nnew";
        let response = exchange_server(&server, &path, put_without);
        assert!(response.starts_with("HTTP/1.1 409"), "{response}");

        let stale = format!(
            "PUT /v1/blob HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer test-token\r\nIf-Match: \"deadbeef\"\r\nContent-Length: 3\r\nConnection: close\r\n\r\nnew"
        );
        let response = exchange_server(&server, &path, &stale);
        assert!(response.starts_with("HTTP/1.1 409"), "{response}");

        let fresh = format!(
            "PUT /v1/blob HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer test-token\r\nIf-Match: {etag}\r\nContent-Length: 3\r\nConnection: close\r\n\r\nnew"
        );
        let response = exchange_server(&server, &path, &fresh);
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn conditional_writes_do_not_clobber() {
        let path = temp_path("conditional");

        let first = write_blob_if_matches(&path, b"one", None).unwrap();
        let first_etag = first.expect("first write should win");
        assert_eq!(fs::read_to_string(&path).unwrap(), "one");

        // Someone else wrote in between; a caller that saw "no file" loses.
        assert_eq!(write_blob_if_matches(&path, b"two", None).unwrap(), None);
        assert_eq!(fs::read_to_string(&path).unwrap(), "one");

        assert_eq!(
            write_blob_if_matches(&path, b"two", Some("\"stale\"")).unwrap(),
            None
        );
        let second = write_blob_if_matches(&path, b"two", Some(&first_etag))
            .unwrap()
            .expect("matching etag should win");
        assert_ne!(second, first_etag);
        assert_eq!(fs::read_to_string(&path).unwrap(), "two");

        let _ = fs::remove_file(&path);
    }

    fn exchange_server(server: &Server, path: &PathBuf, raw: &str) -> String {
        let addr: SocketAddr = server.server_addr().to_ip().unwrap();
        let request = raw.to_string();
        let handle = thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            stream.write_all(request.as_bytes()).unwrap();
            stream.shutdown(Shutdown::Write).unwrap();
            let mut output = String::new();
            let mut reader = std::io::BufReader::new(stream);
            let _ = reader.read_to_string(&mut output);
            output
        });
        let request = server.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
        handle_request(request, &test_context(), path, |_, _| {});
        handle.join().unwrap()
    }
}
