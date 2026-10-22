const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** Verhoeff checksum validation (Aadhaar's last digit is the check digit). */
export function verhoeffValid(num: string): boolean {
  if (!/^\d+$/.test(num)) return false;
  let c = 0;
  const digits = num.split("").reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = D[c][P[i % 8][digits[i]]];
  return c === 0;
}

/** Valid Aadhaar: 12 digits, first digit 2-9, Verhoeff checksum OK. */
export function isValidAadhaar(num: string): boolean {
  return /^[2-9]\d{11}$/.test(num) && verhoeffValid(num);
}

/** Extract the first valid 12-digit Aadhaar from OCR text. Returns digits only, or null. */
export function normalizeAadhaar(text: string): string | null {
  const t = text ?? "";
  const grouped = [...t.matchAll(/(?<!\d)(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})(?!\d)/g)].map(
    (m) => m[1] + m[2] + m[3],
  );
  const hit = grouped.find(isValidAadhaar);
  if (hit) return hit;
  // Fallback for short inputs where OCR split digits oddly.
  const all = t.replace(/\D/g, "");
  if (all.length <= 40) {
    for (let i = 0; i + 12 <= all.length; i++) {
      const c = all.slice(i, i + 12);
      if (isValidAadhaar(c)) return c;
    }
  }
  return null;
}

/** "123456789012" -> "1234 5678 9012" */
export function formatAadhaar(num: string): string {
  return (num ?? "").replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

/** "XXXX XXXX 9012" */
export function maskAadhaar(num: string): string {
  const d = (num ?? "").replace(/\D/g, "");
  return d.length === 12 ? `XXXX XXXX ${d.slice(8)}` : "XXXX XXXX XXXX";
}
