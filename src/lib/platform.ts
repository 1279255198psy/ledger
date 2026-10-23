interface CapacitorWindow {
  Capacitor?: {
    isNativePlatform?: () => boolean
    getPlatform?: () => string
  }
}

/** True inside the Android/iOS Capacitor shell, false in a normal browser. */
export function isMobileApp(): boolean {
  if (typeof window === 'undefined') return false
  const capacitor = (window as unknown as CapacitorWindow).Capacitor
  if (!capacitor) return false
  return capacitor.isNativePlatform
    ? capacitor.isNativePlatform()
    : typeof capacitor.getPlatform === 'function' &&
        capacitor.getPlatform() !== 'web'
}
