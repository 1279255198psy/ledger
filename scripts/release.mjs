#!/usr/bin/env node
/**
 * 账页 · GitHub 一键发布
 *
 * 只询问版本号，其余全部自动完成：
 *   同步版本号 → 本地构建校验 → 提交 → 打 tag → 推送 →
 *   等待 GitHub Actions 构建 → 校验产物 → 发布草稿 Release → 校验 latest.json
 *
 * 用法：
 *   npm run release               # 交互式询问版本号
 *   node scripts/release.mjs 1.2.3
 *   node scripts/release.mjs --dry-run 1.2.3   # 只检查，不改文件、不推送
 *
 * 首次运行会自动初始化 git 仓库、配置 origin、上传缺失的签名 Secrets。
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.GITHUB_REPO || '1279255198psy/ledger';
const BRANCH = 'main';
const CI_TIMEOUT_MS = 45 * 60 * 1000;
const LATEST_JSON_TIMEOUT_MS = 5 * 60 * 1000;
const IS_WIN = process.platform === 'win32';
const NPM = IS_WIN ? 'npm.cmd' : 'npm';
const GIT_CREDENTIAL = ['-c', 'credential.helper=!gh auth git-credential'];

// 认证失败时立即报错，避免卡在用户名/密码提示上。
process.env.GIT_TERMINAL_PROMPT = '0';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const skipBuild = argv.includes('--skip-build');
const versionArg = argv.find((arg) => !arg.startsWith('-'));

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const log = (message = '') => console.log(message);

// ---------- 进程工具 ----------

function spawnOptions(cmd, extra = {}) {
  return {
    cwd: ROOT,
    shell: IS_WIN && /\.(cmd|bat)$/i.test(cmd),
    ...extra,
  };
}

function run(cmd, args, extra = {}) {
  const res = spawnSync(cmd, args, spawnOptions(cmd, { stdio: 'inherit', ...extra }));
  if (res.error) throw new Error(`无法运行 ${cmd}：${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`命令失败（退出码 ${res.status}）：${cmd} ${args.join(' ')}`);
  }
  return res;
}

function capture(cmd, args, extra = {}) {
  const res = spawnSync(cmd, args, spawnOptions(cmd, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...extra,
  }));
  if (res.error) throw new Error(`无法运行 ${cmd}：${res.error.message}`);
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim();
    throw new Error(`命令失败：${cmd} ${args.join(' ')}${detail ? `\n${detail}` : ''}`);
  }
  return (res.stdout || '').trim();
}

function tryCapture(cmd, args, extra = {}) {
  try {
    return capture(cmd, args, extra);
  } catch {
    return null;
  }
}

function commandOk(cmd, args) {
  const res = spawnSync(cmd, args, spawnOptions(cmd, { encoding: 'utf8' }));
  return !res.error && res.status === 0;
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
}

// 借助 gh 已保存的登录凭据访问 GitHub，无需额外配置全局 credential helper。
function gitNet(args, extra = {}) {
  return run('git', [...GIT_CREDENTIAL, ...args], extra);
}

function tryGitNet(args) {
  return tryCapture('git', [...GIT_CREDENTIAL, ...args]);
}

// ---------- 版本号 ----------

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function normalizeVersion(value) {
  const parsed = parseVersion(value);
  if (!parsed) {
    throw new Error(`版本号格式不正确：「${value}」。请使用 x.y.z，例如 1.0.1。`);
  }
  return parsed.join('.');
}

function bumpVersion(current, kind) {
  const [major, minor, patch] = parseVersion(current);
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'major') return `${major + 1}.0.0`;
  return null;
}

async function resolveTarget(current) {
  const suggested = bumpVersion(current, 'patch');

  let answer = versionArg;
  if (!answer) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      answer = (await rl.question(
        `请输入要发布的版本号（当前 ${current}，直接回车 = ${suggested}）: `,
      )).trim();
    } finally {
      rl.close();
    }
  }

  if (!answer) answer = suggested;
  const keyword = bumpVersion(current, answer.trim().toLowerCase());
  const target = normalizeVersion(keyword || answer);

  if (compareVersions(target, current) < 0) {
    throw new Error(`新版本 ${target} 低于当前版本 ${current}，已取消。`);
  }
  return target;
}

// ---------- 前置检查 ----------

function ensureGitRepo() {
  if (existsSync(join(ROOT, '.git'))) return;
  if (dryRun) {
    log('  · 将初始化 git 仓库（main 分支）');
    return;
  }
  run('git', ['init', '-b', BRANCH]);
  log('  ✓ 已初始化 git 仓库（main）');
}

function ensureRemote() {
  if (!existsSync(join(ROOT, '.git'))) return;
  const existing = tryCapture('git', ['remote', 'get-url', 'origin']);
  if (existing) {
    if (!existing.includes(REPO)) {
      log(`  ! origin 当前指向 ${existing}，但脚本按 ${REPO} 操作 GitHub。`);
    }
    return;
  }
  if (dryRun) {
    log(`  · 将添加 origin → https://github.com/${REPO}.git`);
    return;
  }
  run('git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  log(`  ✓ 已添加 origin（${REPO}）`);
}

function ensureGitIdentity() {
  if (!existsSync(join(ROOT, '.git'))) return;
  if (tryCapture('git', ['config', 'user.name']) && tryCapture('git', ['config', 'user.email'])) return;
  if (dryRun) {
    log('  · 将根据 GitHub 账号配置 git 提交身份');
    return;
  }
  const login = capture('gh', ['api', 'user', '--jq', '.login']);
  const id = capture('gh', ['api', 'user', '--jq', '.id']);
  run('git', ['config', 'user.name', login]);
  run('git', ['config', 'user.email', `${id}+${login}@users.noreply.github.com`]);
  log(`  ✓ 已配置 git 提交身份（${login}）`);
}

function ensureSecrets() {
  const listed = (tryCapture('gh', ['secret', 'list', '--repo', REPO]) || '')
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
  const has = (name) => listed.includes(name);

  const names = ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'];
  const missing = names.filter((name) => !has(name));
  if (!missing.length) {
    log('  ✓ 更新签名 Secrets 已配置');
    return;
  }

  const keyDir = join(homedir(), '.tauri', 'zhangye-updater');
  const key = (process.env.TAURI_SIGNING_PRIVATE_KEY || '').trim()
    || readIfExists(process.env.TAURI_SIGNING_PRIVATE_KEY_FILE || join(keyDir, 'zhangye.key'));
  const password = (process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '').trim()
    || readIfExists(process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD_FILE || join(keyDir, 'password.txt'));

  if (missing.includes('TAURI_SIGNING_PRIVATE_KEY') && !key) {
    throw new Error(
      `缺少更新签名私钥，无法自动配置 Secret。\n`
      + `请确认 ${join(keyDir, 'zhangye.key')} 存在，或设置环境变量 TAURI_SIGNING_PRIVATE_KEY_FILE。`,
    );
  }
  if (missing.includes('TAURI_SIGNING_PRIVATE_KEY_PASSWORD') && !password) {
    throw new Error(
      `缺少更新签名私钥密码，无法自动配置 Secret。\n`
      + `请确认 ${join(keyDir, 'password.txt')} 存在，或设置环境变量 TAURI_SIGNING_PRIVATE_KEY_PASSWORD_FILE。`,
    );
  }

  if (dryRun) {
    log(`  · 将上传缺失的 Secrets：${missing.join('、')}`);
    return;
  }

  const values = {
    TAURI_SIGNING_PRIVATE_KEY: key,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
  };
  for (const name of missing) {
    const res = spawnSync('gh', ['secret', 'set', name, '--repo', REPO], {
      cwd: ROOT,
      input: values[name],
      encoding: 'utf8',
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    if (res.error || res.status !== 0) {
      throw new Error(
        `上传 Secret ${name} 失败：${(res.stderr || res.error?.message || '').trim()}`,
      );
    }
  }
  log(`  ✓ 已上传缺失的 Secrets：${missing.join('、')}`);
}

function ensureTagIsNew(target) {
  const tag = `v${target}`;

  if (!existsSync(join(ROOT, '.git'))) {
    const remoteTag = tryCapture('gh', ['api', `repos/${REPO}/git/ref/tags/${tag}`]);
    if (remoteTag) {
      throw new Error(`远端已存在 tag ${tag}，请换一个版本号，或先删除该 Release / tag。`);
    }
    return;
  }

  const remoteRefs = tryGitNet(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  if (remoteRefs) {
    throw new Error(
      `远端已存在 tag ${tag}，不能重复发布。\n`
      + `如需重发，请先在 GitHub 删除对应 Release 与 tag；否则请换一个版本号。`,
    );
  }
}

function ensureHistoryCompatible() {
  if (!existsSync(join(ROOT, '.git'))) return;

  const remoteHeads = tryGitNet(['ls-remote', '--heads', 'origin']) || '';
  const localHead = tryCapture('git', ['rev-parse', '--verify', 'HEAD']);

  if (remoteHeads && !localHead) {
    throw new Error(
      '远端仓库已有提交，但本地没有 git 历史。请先克隆仓库再运行发布脚本，避免覆盖远端内容。',
    );
  }
  if (!remoteHeads || !localHead) return;

  const hasRemoteMain = remoteHeads
    .split(/\r?\n/)
    .some((line) => line.endsWith(`refs/heads/${BRANCH}`));
  if (!hasRemoteMain) return;

  tryGitNet(['fetch', 'origin', BRANCH]);
  const remoteMain = tryCapture('git', ['rev-parse', '--verify', `origin/${BRANCH}`]);
  if (remoteMain && !commandOk('git', ['merge-base', '--is-ancestor', `origin/${BRANCH}`, 'HEAD'])) {
    throw new Error(
      `本地提交历史与远端 ${BRANCH} 不一致，直接推送会失败。\n`
      + `请先执行 git pull --rebase origin ${BRANCH}（或同步远端改动）后再发布。`,
    );
  }
}

async function preflight(current, target) {
  log('→ 检查发布环境 …');

  if (!commandOk('git', ['--version'])) throw new Error('未找到 git，请先安装 Git。');
  if (!commandOk('gh', ['--version'])) {
    throw new Error('未找到 GitHub CLI（gh），请先安装并运行 gh auth login。');
  }
  if (!commandOk('gh', ['auth', 'status'])) {
    throw new Error('gh 尚未登录，请先运行 gh auth login。');
  }

  let repoInfo;
  try {
    repoInfo = JSON.parse(capture('gh', [
      'repo', 'view', REPO, '--json', 'viewerPermission,isEmpty,defaultBranchRef',
    ]));
  } catch {
    throw new Error(`无法访问仓库 ${REPO}，请确认仓库存在且当前账号有权限。`);
  }
  if (!['ADMIN', 'MAINTAIN', 'WRITE'].includes(repoInfo.viewerPermission)) {
    throw new Error(`当前 GitHub 账号对 ${REPO} 没有写权限（${repoInfo.viewerPermission}）。`);
  }

  ensureGitRepo();
  ensureRemote();
  ensureGitIdentity();
  ensureSecrets();
  ensureTagIsNew(target);
  ensureHistoryCompatible();

  log('  ✓ 环境检查通过');
}

// ---------- 修改版本号 ----------

function updateJson(relativePath, mutate) {
  const path = join(ROOT, relativePath);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  mutate(data);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function updateCargoToml(target) {
  const path = join(ROOT, 'src-tauri', 'Cargo.toml');
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  let inPackage = false;
  let updated = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\[package\]\s*$/.test(line)) {
      inPackage = true;
      continue;
    }
    if (/^\[.+\]\s*$/.test(line)) {
      inPackage = false;
      continue;
    }
    if (inPackage && /^version\s*=/.test(line)) {
      lines[i] = `version = "${target}"`;
      updated = true;
      break;
    }
  }
  if (!updated) throw new Error('在 src-tauri/Cargo.toml 中找不到 [package] version。');
  writeFileSync(path, lines.join('\n'));
}

function updateCargoLock(target) {
  const path = join(ROOT, 'src-tauri', 'Cargo.lock');
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  const next = text.replace(
    /(\[\[package\]\]\r?\nname = "zhangye"\r?\nversion = ")[^"]+(")/,
    `$1${target}$2`,
  );
  if (next !== text) writeFileSync(path, next);
}

function updateReadme(oldVersion, newVersion) {
  if (oldVersion === newVersion) return;
  const path = join(ROOT, 'README.md');
  let text = readFileSync(path, 'utf8');
  text = text.replaceAll(`账页-Setup-${oldVersion}.exe`, `账页-Setup-${newVersion}.exe`);
  text = text.replaceAll(`账页_${oldVersion}_x64-setup.exe`, `账页_${newVersion}_x64-setup.exe`);
  writeFileSync(path, text);
}

function bumpVersions(current, target) {
  log(`→ 同步版本号 ${current} → ${target} …`);
  updateJson('package.json', (data) => { data.version = target; });
  updateJson('package-lock.json', (data) => {
    data.version = target;
    if (data.packages?.['']) data.packages[''].version = target;
  });
  updateJson('src-tauri/tauri.conf.json', (data) => { data.version = target; });
  updateCargoToml(target);
  updateCargoLock(target);
  updateReadme(current, target);
  log('  ✓ package.json / package-lock.json / tauri.conf.json / Cargo.toml / Cargo.lock / README.md 已更新');
}

function buildFrontend() {
  if (!existsSync(join(ROOT, 'node_modules'))) {
    log('→ 未找到 node_modules，先安装依赖 …');
    run(NPM, ['ci']);
  }
  log('→ 本地构建校验（TypeScript + Vite）…');
  run(NPM, ['run', 'build']);
  log('  ✓ 前端构建通过');
}

// ---------- 提交、tag、推送 ----------

function commitAndTag(target) {
  const tag = `v${target}`;
  log(`→ 提交并打 tag ${tag} …`);

  run('git', ['add', '-A']);
  const staged = capture('git', ['status', '--porcelain']);
  if (staged) {
    run('git', ['commit', '-m', `release: ${tag}`]);
  } else {
    log('  · 没有文件改动，跳过提交');
  }

  const head = capture('git', ['rev-parse', 'HEAD']);
  const existingTag = tryCapture('git', ['rev-parse', '--verify', `refs/tags/${tag}`]);
  if (existingTag) {
    const tagSha = capture('git', ['rev-list', '-n', '1', tag]);
    if (tagSha !== head) {
      throw new Error(`本地 tag ${tag} 已存在且不指向当前提交，请先删除该 tag 再运行。`);
    }
    log(`  · 本地 tag ${tag} 已存在并指向当前提交，继续使用`);
  } else {
    run('git', ['tag', '-a', tag, '-m', `账页 ${tag}`]);
    log(`  ✓ 已创建 tag ${tag}`);
  }

  return head;
}

function pushAll(target) {
  log('→ 推送提交与 tag …');
  try {
    gitNet(['push', 'origin', `HEAD:refs/heads/${BRANCH}`]);
  } catch {
    throw new Error(
      `推送 ${BRANCH} 失败。请确认网络正常、远端没有更新；`
      + `如远端有新提交，请先 git pull --rebase origin ${BRANCH} 后重试。`,
    );
  }
  gitNet(['push', 'origin', `refs/tags/v${target}`]);
  log('  ✓ 推送完成，GitHub Actions 将被触发');
}

// ---------- 等待 CI ----------

function pickRun(runs, sha, target) {
  return runs.find((item) => item.event === 'push'
    && (item.headSha === sha || item.headBranch === `v${target}`));
}

async function findRun(sha, target) {
  const fields = 'databaseId,status,conclusion,event,headSha,headBranch,createdAt,workflowName';

  for (let attempt = 0; attempt < 40; attempt += 1) {
    let runs = [];

    const byCommit = tryCapture('gh', [
      'run', 'list', '--repo', REPO, '--commit', sha, '--limit', '10', '--json', fields,
    ]);
    if (byCommit) {
      try { runs = JSON.parse(byCommit); } catch { runs = []; }
    }
    let match = pickRun(runs, sha, target);

    // 推送注解 tag 时 head_sha 可能是 tag 对象；再按最近运行与 tag 名匹配一次。
    if (!match) {
      const recent = tryCapture('gh', [
        'run', 'list', '--repo', REPO, '--limit', '20', '--json', fields,
      ]);
      if (recent) {
        try { runs = JSON.parse(recent); } catch { runs = []; }
      }
      match = pickRun(runs, sha, target);
    }

    if (match) return match;
    await sleep(3000);
  }
  return null;
}

function printFailedLogs(runId) {
  log('\n—— 构建失败日志（末尾 120 行）——');
  const res = spawnSync('gh', ['run', 'view', String(runId), '--repo', REPO, '--log-failed'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = (res.stdout || '').trim();
  if (output) console.error(output.split(/\r?\n/).slice(-120).join('\n'));
  else log('（未能获取日志，请打开 GitHub Actions 页面查看）');
}

function watchRun(runId) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      'gh',
      ['run', 'watch', String(runId), '--repo', REPO, '--exit-status', '--interval', '15'],
      { cwd: ROOT, stdio: 'inherit' },
    );
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      rejectPromise(new Error('等待 GitHub Actions 超时（45 分钟）。'));
    }, CI_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise(code);
    });
  });
}

async function waitForWorkflow(sha, target) {
  log('→ 等待 GitHub Actions 构建并签名（通常 10–20 分钟）…');
  const run = await findRun(sha, target);
  if (!run) {
    throw new Error(
      `没有找到本次推送触发的 Actions 运行。请打开 https://github.com/${REPO}/actions 检查。`,
    );
  }

  log(`  · 已找到运行 #${run.databaseId}（${run.workflowName}），开始等待…`);
  log(`    https://github.com/${REPO}/actions/runs/${run.databaseId}`);
  if (run.status === 'completed') {
    if (run.conclusion !== 'success') {
      printFailedLogs(run.databaseId);
      throw new Error(`Actions 运行 #${run.databaseId} 已结束：${run.conclusion}`);
    }
    log('  ✓ Actions 构建成功');
    return;
  }

  const code = await watchRun(run.databaseId);
  if (code !== 0) {
    printFailedLogs(run.databaseId);
    throw new Error(`Actions 构建失败（运行 #${run.databaseId}），请查看上方日志。`);
  }
  log('  ✓ Actions 构建成功');
}

// ---------- 手机安装包 ----------

function uploadAndroidApk(target) {
  const asciiName = `zhangye-v${target}-android.apk`;
  const candidates = [
    process.env.ZHANGYE_ANDROID_APK,
    join(ROOT, '..', 'ledger-android', 'release', `账页-v${target}-android.apk`),
    join(ROOT, '..', 'ledger-android', 'release', asciiName),
    join(ROOT, '..', `账页-v${target}-android.apk`),
    join(ROOT, '..', asciiName),
  ].filter(Boolean);
  const apk = candidates.find((path) => existsSync(path));

  if (!apk) {
    log('  ! 未找到手机安装包，Release 将不包含 .apk（手机端会提示手动下载）');
    return;
  }

  // gh 上传时会丢掉文件名里的中文（账页-v3.0.0-android.apk 变成了
  // -v3.0.0-android.apk），所以统一用 ASCII 文件名上传。手机端只按 .apk
  // 后缀识别资源，不受文件名影响。
  const uploadPath = basename(apk) === asciiName ? apk : join(tmpdir(), asciiName);
  if (uploadPath !== apk) copyFileSync(apk, uploadPath);

  log(`→ 上传手机安装包 ${apk} …`);
  try {
    run('gh', ['release', 'upload', `v${target}`, uploadPath, '--repo', REPO, '--clobber']);
  } finally {
    if (uploadPath !== apk) rmSync(uploadPath, { force: true });
  }
  log('  ✓ 手机安装包已上传');
}

// ---------- 发布草稿与校验 ----------

async function findRelease(target) {
  const tag = `v${target}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const raw = tryCapture('gh', [
      'release', 'view', tag, '--repo', REPO, '--json', 'isDraft,assets,url,tagName',
    ]);
    if (raw) {
      try { return JSON.parse(raw); } catch { /* 继续重试 */ }
    }
    await sleep(3000);
  }
  return null;
}

async function publishDraft(target) {
  const tag = `v${target}`;
  log('→ 校验 Release 产物 …');

  const release = await findRelease(target);
  if (!release) {
    throw new Error(`没有找到 tag ${tag} 的 Release，请在 GitHub Actions 页面确认构建结果。`);
  }

  const names = release.assets.map((asset) => asset.name);
  const installer = names.find((name) => /\.exe$/i.test(name));
  const signature = names.find((name) => /\.exe\.sig$/i.test(name));
  const hasLatestJson = names.includes('latest.json');
  const androidApk = names.find((name) => /\.apk$/i.test(name));

  if (!installer) throw new Error(`Release ${tag} 中没有找到 .exe 安装包。`);
  if (!signature) throw new Error(`Release ${tag} 中没有找到 .exe.sig 更新签名。`);
  if (!hasLatestJson) throw new Error(`Release ${tag} 中没有找到 latest.json 更新清单。`);
  log(`  ✓ 安装包：${installer}`);
  log(`  ✓ 更新签名：${signature}`);
  log('  ✓ 更新清单：latest.json');
  if (androidApk) log(`  ✓ 手机安装包：${androidApk}`);
  else log('  ! 本次 Release 不包含 .apk，手机端会提示前往 GitHub 手动下载');

  if (release.isDraft) {
    run('gh', ['release', 'edit', tag, '--repo', REPO, '--draft=false', '--latest']);
    log(`  ✓ 已发布 Release 并标记为 Latest：${release.url}`);
  } else {
    log(`  · Release 已是发布状态：${release.url}`);
  }

  return release.url;
}

async function verifyLatestJson(target) {
  const url = `https://github.com/${REPO}/releases/latest/download/latest.json`;
  log('→ 校验应用内更新清单 …');

  const deadline = Date.now() + LATEST_JSON_TIMEOUT_MS;
  let lastState = '尚未响应';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}?t=${Date.now()}`, {
        redirect: 'follow',
        headers: { 'cache-control': 'no-cache' },
      });
      if (response.ok) {
        const data = await response.json();
        const version = String(data.version || '').replace(/^v/, '');
        if (version === target) {
          const platform = data.platforms?.['windows-x86_64'];
          if (platform?.signature) {
            log('  ✓ latest.json 已指向新版本，更新签名有效');
          } else {
            log('  ! latest.json 已指向新版本，但 windows-x86_64 缺少签名，请检查构建产物。');
          }
          return;
        }
        lastState = `latest.json 当前版本为 ${data.version}`;
      } else {
        lastState = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastState = error.message;
    }
    await sleep(10000);
  }

  throw new Error(
    `Release 已发布，但 ${url} 暂未指向 ${target}（${lastState}）。\n`
    + 'GitHub CDN 可能仍在刷新，请稍后打开该地址确认。',
  );
}

// ---------- 主流程 ----------

function printPlan(target) {
  log('');
  log('（试运行）正式发布时将执行：');
  log(`  1. 同步版本号到 v${target} 对应的所有文件`);
  log(`  2. 运行 npm run build 做本地校验${skipBuild ? '（已用 --skip-build 跳过）' : ''}`);
  log(`  3. git commit "release: v${target}" 并创建 tag v${target}`);
  log(`  4. 推送 ${BRANCH} 与 tag 到 ${REPO}`);
  log('  5. 等待 GitHub Actions 构建、签名并上传草稿 Release');
  log('  6. 上传手机安装包 .apk（若本地存在）');
  log('  7. 校验安装包、.sig、latest.json 后发布草稿并标记 Latest');
  log('  8. 校验应用内更新地址返回新版本');
  log('');
  log('本次为试运行，未修改任何文件、未推送、未发布。');
}

async function main() {
  log('');
  log('账页 · GitHub 一键发布');
  log('─'.repeat(46));

  const current = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const target = await resolveTarget(current);
  log(`准备发布 v${target}（当前 v${current}）${dryRun ? ' · 试运行' : ''}`);
  log('');

  await preflight(current, target);

  if (dryRun) {
    printPlan(target);
    return;
  }

  bumpVersions(current, target);
  if (!skipBuild) buildFrontend();
  const head = commitAndTag(target);
  pushAll(target);

  log('');
  await waitForWorkflow(head, target);
  log('');
  uploadAndroidApk(target);
  const releaseUrl = await publishDraft(target);
  log('');
  await verifyLatestJson(target);

  log('');
  log('─'.repeat(46));
  log('✅ 发布完成');
  log(`   版本：v${target}`);
  log(`   Release：${releaseUrl}`);
  log(`   更新清单：https://github.com/${REPO}/releases/latest/download/latest.json`);
  log('   已安装的旧版本会在下次启动时自动收到更新提示。');
  log('');
}

main().catch((error) => {
  log('');
  log(`❌ ${error.message}`);
  process.exitCode = 1;
});
