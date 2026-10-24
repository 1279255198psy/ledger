interface CapacitorWindow {
  Capacitor?: {
    isNativePlatform?: () => boolean
    getPlatform?: () => string
  }
  androidBridge?: unknown
  webkit?: {
    messageHandlers?: {
      bridge?: unknown
    }
  }
}

/** True inside the Android/iOS Capacitor shell, false in a normal browser. */
export function isMobileApp(): boolean {
  if (typeof window === 'undefined') return false
  const capacitorWindow = window as unknown as CapacitorWindow
  const capacitor = capacitorWindow.Capacitor
  if (capacitor) {
    if (typeof capacitor.isNativePlatform === 'function') {
      return capacitor.isNativePlatform()
    }
    if (typeof capacitor.getPlatform === 'function') {
      return capacitor.getPlatform() !== 'web'
    }
  }
  // The native bridge is injected even before Capacitor attaches its runtime
  // object, so use it as a fallback instead of falling into the browser path.
  return (
    capacitorWindow.androidBridge !== undefined ||
    capacitorWindow.webkit?.messageHandlers?.bridge !== undefined
  )
}

/** True only inside the Android shell; notification capture does not exist on iOS. */
export function isAndroidApp(): boolean {
  if (!isMobileApp()) return false
  if (typeof window !== 'undefined') {
    const capacitor = (window as unknown as CapacitorWindow).Capacitor
    if (capacitor && typeof capacitor.getPlatform === 'function') {
      return capacitor.getPlatform() === 'android'
    }
  }
  return (
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
  )
}
