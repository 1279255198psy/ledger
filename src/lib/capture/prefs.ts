const KEEP_SAMPLES_KEY = 'zhangye.captureKeepSamples.v1'

/**
 * Calibration mode: when on, raw notifications are not acknowledged after
 * ingest, so they stay visible on the debug page. Only needed while tuning the
 * parser against a new phone's real notices.
 */
export function loadKeepSamples(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(KEEP_SAMPLES_KEY) === '1'
  } catch {
    return false
  }
}

export function saveKeepSamples(value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEEP_SAMPLES_KEY, value ? '1' : '0')
  } catch {
    // Keeping samples is a debugging aid; failing to persist it must not
    // break the normal capture pipeline.
  }
}

/**
 * Makes a sample safe to paste elsewhere without losing the shape the parser
 * cares about: every digit becomes a bullet, so amounts, card tails and dates
 * keep their length and separators but show no real value.
 */
export function maskSampleText(text: string): string {
  return text.replace(/\d/g, '•')
}
