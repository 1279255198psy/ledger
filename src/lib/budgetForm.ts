/** Small helpers shared by the monthly and the custom-range budget editors. */

/** Splits cents so the parts add back up to the total exactly. */
export function splitEvenlyCents(totalCents: number, dayCount: number): number[] {
  const base = Math.floor(totalCents / dayCount)
  const extra = totalCents - base * dayCount
  return Array.from(
    { length: dayCount },
    (_, index) => base + (index < extra ? 1 : 0),
  )
}

/** Null means "not a valid non-negative amount" (blank is also null). */
export function parseCents(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

/**
 * Scales day amounts so they add up to the budget exactly. Rounding crumbs go
 * to the days that already carry the most.
 */
export function scaleValuesToTotalCents(
  values: number[],
  totalCents: number,
): number[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return values.map(() => 0)
  const scaled = values.map((value) => Math.floor((value / total) * totalCents))
  const remainder = totalCents - scaled.reduce((sum, value) => sum + value, 0)
  const order = values
    .map((value, index) => ({ index, value }))
    .sort((left, right) => right.value - left.value)
  for (let index = 0; index < remainder; index += 1) {
    const target = order[index % order.length]
    if (target) scaled[target.index] += 1
  }
  return scaled
}
