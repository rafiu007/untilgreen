// A deliberately buggy function: the demo asks a coding agent to fix it,
// and the untilgreen gate (`npm test`) decides when it is actually fixed.
export function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("median expects a non-empty array");
  }
  const sorted = [...values].sort(); // BUG: lexicographic sort for numbers
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
