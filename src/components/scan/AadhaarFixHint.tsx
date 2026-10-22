"use client";
import { suggestAadhaarFixes, formatAadhaar } from "@/lib/ocr/verhoeff";

/**
 * Shown when a 12-digit number fails the Aadhaar checksum. If one digit that OCR often confuses would make it valid,
 * offer it as a tap-to-apply hint. It never changes anything by itself: staff compare the number with the card first.
 */
export function AadhaarFixHint({ digits, onPick }: { digits: string; onPick: (fixed: string) => void }) {
  const fixes = suggestAadhaarFixes(digits);
  return (
    <div role="alert" className="space-y-2 rounded-2xl bg-warn-bg px-4 py-3 text-sm font-semibold text-warn-fg">
      <p>This number does not pass the Aadhaar check, so a digit is probably wrong. Compare with the card.</p>
      {fixes.length > 0 && fixes.length <= 4 && (
        <div className="space-y-1.5">
          <p className="font-bold">Did a digit get misread? Tap the one that matches the card:</p>
          {fixes.map((f) => (
            <button
              key={f.digits}
              type="button"
              onClick={() => onPick(f.digits)}
              className="flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border border-warn-fg/30 bg-white px-3 text-left text-ink"
            >
              <span className="font-mono text-lg tracking-wider">{formatAadhaar(f.digits)}</span>
              <span className="text-xs font-semibold text-ink-muted">digit {f.position}: {f.from} to {f.to}</span>
            </button>
          ))}
        </div>
      )}
      {fixes.length > 4 && <p className="font-normal">Several single digits could be wrong. Re-read the whole number from the card.</p>}
    </div>
  );
}
