/** A short buzz to confirm a save on phones that support it (Android). Silent everywhere else. */
export function buzz() {
  try { navigator.vibrate?.(40); } catch { /* not supported */ }
}
