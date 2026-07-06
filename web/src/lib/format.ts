/**
 * Compact token/count formatting for tight UI (budget panels, chips):
 * 1_500 → "1.5k", 2_400_000 → "2.4M". Distinct from the costs table's
 * locale formatter (`formatTokens` in routes/costs), which renders full
 * thousands-separated numbers.
 */
export function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
