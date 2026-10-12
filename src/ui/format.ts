/** Display only: stored combat values are never rounded. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1e9) return value.toExponential(2)
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(value)
}
