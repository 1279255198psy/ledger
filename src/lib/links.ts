import { isDesktopApp } from './desktop'
import { isMobileApp } from './platform'

/**
 * Opens a URL outside the app: the system browser on desktop/mobile, and a
 * new tab when the web build runs in a normal browser.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isDesktopApp()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
    return
  }

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener noreferrer'
  // Capacitor hands main-frame navigations to the system browser. A blank
  // target would create a pop-up the Android WebView cannot show.
  anchor.target = isMobileApp() ? '_self' : '_blank'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
