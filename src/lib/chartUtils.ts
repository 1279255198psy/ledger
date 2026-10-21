const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

/**
 * Builds a readable axis with a small amount of headroom. A finer set of nice
 * steps keeps the top tick close to the data instead of jumping from 10k to
 * 15k (or 20k to 30k) just because the rough step crossed a threshold.
 */
export function niceScale(
  rawMax: number,
  tickCount = 4,
): { max: number; ticks: number[] } {
  const target = Math.max(rawMax * 1.06, 100)
  const roughStep = target / tickCount
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const normalized = roughStep / magnitude
  const niceStep =
    NICE_STEPS.find((candidate) => normalized <= candidate + 1e-9) ??
    NICE_STEPS[NICE_STEPS.length - 1]
  const step = niceStep * magnitude
  const max = Math.ceil(target / step) * step
  const ticks: number[] = []
  for (let value = 0; value <= max + step / 2; value += step) {
    ticks.push(value)
  }
  return { max, ticks }
}

export function topRoundedBarPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 4,
): string {
  if (height <= 0) return ''
  const r = Math.min(radius, width / 2, height)
  return [
    `M ${x} ${y + height}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height}`,
    'Z',
  ].join(' ')
}
