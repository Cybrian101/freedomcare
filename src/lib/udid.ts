/** Uppercase and strip spaces/dashes; "/" is kept (enrolment numbers use it). */
export function normalizeUdid(s: string): string {
  return (s ?? "").toUpperCase().replace(/[\s\-_.]+/g, "");
}

/** UDID card number: 2-letter state code + 10-18 digits, e.g. MH0123456789012. */
export const UDID_RE = /\b[A-Z]{2}\s?\d{10,18}\b/;
/** Enrolment / application no.: digit groups split by "/", e.g. 3321/00000/2311/0318749. */
export const ENROLMENT_RE = /\b\d{3,6}(?:\s?\/\s?\d{3,8}){2,4}\b/;

export function looksLikeUdid(s: string): boolean {
  return UDID_RE.test((s ?? "").toUpperCase());
}
export function looksLikeEnrolment(s: string): boolean {
  return ENROLMENT_RE.test(s ?? "");
}

/** Find the first UDID or enrolment-like number in text. */
export function extractUdid(text: string): { udid_no: string; udid_label: string } | null {
  const u = (text ?? "").toUpperCase().match(UDID_RE);
  if (u) return { udid_no: normalizeUdid(u[0]), udid_label: "UDID No" };
  const e = (text ?? "").match(ENROLMENT_RE);
  if (e) return { udid_no: normalizeUdid(e[0]), udid_label: "Enrolment No" };
  return null;
}
