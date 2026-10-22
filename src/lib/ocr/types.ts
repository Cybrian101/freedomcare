export type OcrKind = "aadhaar" | "udid";

export type OcrField = { value: string | null; confidence: number };

export const AADHAAR_KEYS = [
  "aadhaar_no", "name", "gender", "dob", "yob", "care_of", "address",
  "pincode", "district", "state", "vid", "phone", "email",
] as const;

export const UDID_KEYS = [
  "doc_type", "udid_no", "udid_label", "name", "dob", "disability_type",
  "disability_pct", "care_of", "address", "phone",
] as const;

export type OcrFields = Record<string, OcrField>;

export interface OcrResult {
  kind: OcrKind;
  fields: OcrFields;
  /** field keys the volunteer must double-check */
  needsReview: string[];
  /** human readable notes (e.g. checksum failed) */
  warnings: string[];
  /** overall image legibility reported by the model 0..1 */
  legibility: number;
  /** aadhaar only: number present and passes first-digit + Verhoeff */
  aadhaarValid?: boolean;
  /** how many model calls were used */
  attempts: number;
}

export type OcrErrorCode =
  | "not_configured" | "rate_limited" | "upstream_error" | "bad_request"
  | "unauthorized" | "unreadable" | "timeout";

export type OcrResponse =
  | { ok: true; result: OcrResult }
  | { ok: false; error: { code: OcrErrorCode; message: string } };
