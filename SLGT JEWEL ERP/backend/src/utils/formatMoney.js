const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** User-facing only. Keep API data and calculations numeric. */
export function formatINR(value) {
  const n = Number(value);
  return inr.format(Number.isFinite(n) ? n : 0);
}
