// Thin layer over the shared Aadhaar helpers (src/lib/aadhaar.ts) plus OCR-specific text helpers.
import { isValidAadhaar as isValid, verhoeffValid, formatAadhaar, maskAadhaar } from "../aadhaar";

export { verhoeffValid, formatAadhaar, maskAadhaar };

/** Tolerates spaces/dashes. */
export function isValidAadhaar(input: string | null | undefined): boolean {
  if (!input) return false;
  return isValid(input.replace(/[\s-]/g, ""));
}

export function digitsOnly(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

/** Pull a candidate 12-digit number from free text (e.g. tesseract output). Prefers checksum-valid. */
export function extractAadhaarFromText(text: string): { value: string | null; valid: boolean } {
  const cands: string[] = [];
  const re = /(?<!\d)(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) cands.push(m[1] + m[2] + m[3]);
  const valid = cands.find((c) => isValid(c));
  if (valid) return { value: valid, valid: true };
  const loose = cands.find((c) => /^[2-9]/.test(c));
  return { value: loose ?? cands[0] ?? null, valid: false };
}

/** Digits that OCR commonly mistakes for each other on printed cards. */
const CONFUSABLE: Record<string, string> = {
  "0": "869", "1": "74", "2": "73", "3": "825", "4": "91", "5": "638", "6": "580", "7": "12", "8": "3069", "9": "408",
};

export interface AadhaarFix {
  /** the corrected 12 digits */
  digits: string;
  /** 1-based position that changed */
  position: number;
  from: string;
  to: string;
}

/**
 * For a 12-digit number that FAILS the checksum, list the single-digit changes that make it valid AND swap a digit for
 * one OCR often confuses it with (e.g. 8 read as 3). Verhoeff catches every single-digit error, so each position has at
 * most one repair; most numbers give 0 to 2 suggestions. A suggestion is only a hint: staff still compare with the card.
 */
export function suggestAadhaarFixes(input: string): AadhaarFix[] {
  const d = digitsOnly(input);
  if (d.length !== 12 || isValid(d)) return [];
  const out: AadhaarFix[] = [];
  for (let i = 0; i < 12; i++) {
    for (const to of CONFUSABLE[d[i]] ?? "") {
      const next = d.slice(0, i) + to + d.slice(i + 1);
      if (isValid(next)) out.push({ digits: next, position: i + 1, from: d[i], to });
    }
  }
  return out;
}
