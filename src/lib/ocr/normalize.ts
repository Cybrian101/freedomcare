import { digitsOnly, isValidAadhaar } from "./verhoeff";
import { AADHAAR_KEYS, UDID_KEYS, type OcrField, type OcrFields, type OcrKind, type OcrResult } from "./types";

const REVIEW_BELOW = 0.8;

function clamp01(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s || /^(null|n\/a|na|unknown|not readable|unreadable|-+)$/i.test(s)) return null;
  return s;
}

/** DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD -> YYYY-MM-DD, else null */
export function normalizeDob(v: string | null): string | null {
  if (!v) return null;
  let m = v.match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{4})$/);
  let y: number, mo: number, d: number;
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > new Date().getFullYear()) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeGender(v: string | null): string | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (/^(m|male)/.test(s)) return "Male";
  if (/^(f|female)/.test(s)) return "Female";
  if (/trans|other/.test(s)) return "Transgender";
  return null;
}

function normalizeCareOf(v: string | null): string | null {
  if (!v) return null;
  return v.replace(/^(s|d|w|c)\s*[/.]\s*o\.?\s*:?\s*/i, (_m, p: string) => `${p.toUpperCase()}/O `).trim();
}

function normalizeField(key: string, value: string | null): string | null {
  if (value === null) return null;
  switch (key) {
    case "aadhaar_no": { const d = digitsOnly(value); return d || null; }
    case "vid": { const d = digitsOnly(value); return d.length === 16 ? d : null; }
    case "pincode": { const d = digitsOnly(value); return d.length === 6 ? d : null; }
    case "yob": { const d = digitsOnly(value); return /^(19|20)\d{2}$/.test(d) ? d : null; }
    case "phone": {
      let d = digitsOnly(value);
      if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
      return /^[6-9]\d{9}$/.test(d) ? d : null;
    }
    case "dob": return normalizeDob(value);
    case "gender": return normalizeGender(value);
    case "care_of": return normalizeCareOf(value);
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.toLowerCase() : null;
    case "disability_pct": {
      const m = value.match(/(\d{1,3})(?:\.\d+)?/);
      if (!m) return null;
      const n = +m[1];
      return n >= 0 && n <= 100 ? String(n) : null;
    }
    case "udid_no": return value.replace(/\s+/g, "").toUpperCase();
    case "doc_type": {
      const s = value.toLowerCase();
      if (/ack|enrol|resident|application|receipt/.test(s)) return "acknowledgement";
      if (/card|udid|id/.test(s)) return "card";
      return "other";
    }
    default: return value;
  }
}

/**
 * Turn raw model JSON ({key: {value, confidence}, legibility}) into a validated OcrResult.
 * Never invents values: anything that fails format validation becomes null and is flagged.
 */
export function normalizeModelOutput(raw: unknown, kind: OcrKind, attempts = 1): OcrResult {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const keys = kind === "aadhaar" ? AADHAAR_KEYS : UDID_KEYS;
  const fields: OcrFields = {};
  const needsReview: string[] = [];
  const warnings: string[] = [];

  for (const key of keys) {
    const entry = obj[key];
    let value: string | null = null;
    let confidence = 0;
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      value = clean(e.value);
      confidence = clamp01(e.confidence);
    } else if (typeof entry === "string") {
      value = clean(entry);
      confidence = 0.5;
    }
    const printed = value;
    value = normalizeField(key, value);
    if (printed !== null && value === null) {
      warnings.push(`${key}: printed value could not be validated, please type it in`);
      needsReview.push(key);
    }
    if (value === null) confidence = 0;
    fields[key] = { value, confidence } as OcrField;
  }

  let aadhaarValid: boolean | undefined;
  if (kind === "aadhaar") {
    const f = fields.aadhaar_no;
    aadhaarValid = isValidAadhaar(f.value);
    if (f.value && !aadhaarValid) {
      f.confidence = Math.min(f.confidence, 0.3);
      warnings.push("Aadhaar number failed the checksum - a digit is probably misread. Compare with the card.");
      if (!needsReview.includes("aadhaar_no")) needsReview.push("aadhaar_no");
    } else if (!f.value && !needsReview.includes("aadhaar_no")) {
      needsReview.push("aadhaar_no");
    }
    if (!fields.dob.value && !fields.yob.value) warnings.push("No date or year of birth read");
  } else if (!fields.udid_no.value && !needsReview.includes("udid_no")) {
    needsReview.push("udid_no");
  }

  for (const key of keys) {
    const f = fields[key];
    if (f.value !== null && f.confidence < REVIEW_BELOW && !needsReview.includes(key)) needsReview.push(key);
  }

  return { kind, fields, needsReview, warnings, legibility: clamp01(obj.legibility), aadhaarValid, attempts };
}
