// Reads the QR code printed on an Aadhaar card / e-Aadhaar. The QR holds the card's details as DATA (name, date of birth,
// gender, address), which is far more reliable than reading the printed letters, so it is used first and the printed text
// is only a fallback. Pure functions: no DOM or network, so they are unit-tested (scripts/test-aadhaar-qr.mjs).
//
// Two formats exist:
//  - "Secure QR" (cards since 2018): one very large decimal number -> bytes -> gzip -> fields separated by byte 255. It
//    carries a reference id that starts with the LAST 4 DIGITS of the Aadhaar number (never the full number).
//  - Old XML QR: <PrintLetterBarcodeData uid="..." name="..." .../> and includes the full 12-digit number.
// Anything that does not look right is rejected (returns null) instead of being guessed: the caller falls back to OCR.

export interface AadhaarQr {
  kind: "secure" | "xml";
  name: string | null;
  /** yyyy-mm-dd when the card prints a full date */
  dob: string | null;
  yob: string | null;
  gender: string | null;
  care_of: string | null;
  address: string | null;
  pincode: string | null;
  district: string | null;
  state: string | null;
  /** old XML QR only */
  aadhaar_no: string | null;
  /** last 4 digits of the Aadhaar number (secure QR) or taken from the full number (XML QR) */
  last4: string | null;
}

export type Gunzip = (bytes: Uint8Array) => Promise<Uint8Array>;

/** gzip decoding with the browser's built-in stream (Chrome 80+, Safari 16.4+, Firefox 113+). */
export const browserGunzip: Gunzip = async (bytes) => {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const GENDER: Record<string, string> = { M: "Male", F: "Female", T: "Transgender" };

function isoDob(raw: string | null | undefined): { dob: string | null; yob: string | null } {
  const v = (raw ?? "").trim();
  const full = /^(\d{2})[-/](\d{2})[-/]((?:19|20)\d{2})$/.exec(v);
  if (full) return { dob: `${full[3]}-${full[2]}-${full[1]}`, yob: full[3] };
  if (/^(19|20)\d{2}$/.test(v)) return { dob: null, yob: v };
  return { dob: null, yob: null };
}

const clean = (s: string | undefined | null) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t || null;
};

function joinAddress(parts: (string | null)[]): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = clean(p);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out.length ? out.join(", ") : null;
}

function decimalToBytes(text: string): Uint8Array | null {
  if (!/^\d{200,}$/.test(text)) return null;
  let hex = BigInt(text).toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function splitOn255(bytes: Uint8Array, maxParts: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length && parts.length < maxParts; i++) {
    if (bytes[i] === 255) { parts.push(bytes.subarray(start, i)); start = i + 1; }
  }
  return parts;
}

const text = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);

function parseSecure(parts: string[]): AadhaarQr | null {
  // Anchor on the reference id (last 4 digits of the Aadhaar number + a timestamp) instead of trusting fixed positions:
  // the fields before it differ between QR versions.
  const r = parts.findIndex((p) => /^\d{18,21}$/.test(p));
  if (r < 0 || parts.length < r + 15) return null;
  const f = (n: number) => clean(parts[r + n]);
  const { dob, yob } = isoDob(f(2));
  const gender = GENDER[(f(3) ?? "").toUpperCase()] ?? null;
  const pin = f(9);
  const pincode = pin && /^\d{6}$/.test(pin) ? pin : null;
  const name = f(1);
  // Sanity checks: the date of birth, gender and pincode sit at fixed places after the name. When at least two of them are
  // where they should be, the layout is the expected one and the name can be trusted even if the third field is odd
  // (losing a good name over one unusual field was the commonest failure). Fewer than two: nothing is trusted.
  const checks = [!!(dob || yob), !!gender, !!pincode].filter(Boolean).length;
  if (!name || !/^[\p{L}][\p{L}\p{M} .'-]+$/u.test(name) || checks < 2) return null;
  return {
    kind: "secure",
    name,
    dob,
    yob,
    gender,
    care_of: f(4),
    address: joinAddress([f(7), f(12), f(6), f(8), f(14), f(10), f(13), f(5), f(11), pincode]),
    pincode,
    district: f(5),
    state: f(11),
    aadhaar_no: null,
    last4: parts[r].slice(0, 4),
  };
}

function parseXml(xml: string): AadhaarQr | null {
  if (!/PrintLetterBarcodeData|<[^>]*\buid=/i.test(xml)) return null;
  const a: Record<string, string> = {};
  for (const m of xml.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) a[m[1].toLowerCase()] = m[2];
  const uid = (a.uid ?? "").replace(/\D/g, "");
  const { dob, yob } = isoDob(a.dob ?? a.yob);
  const gender = GENDER[(a.gender ?? "").toUpperCase().slice(0, 1)] ?? clean(a.gender);
  if (!clean(a.name)) return null;
  return {
    kind: "xml",
    name: clean(a.name),
    dob,
    yob: yob ?? (/^(19|20)\d{2}$/.test(a.yob ?? "") ? a.yob : null),
    gender,
    care_of: clean(a.co),
    address: joinAddress([a.house, a.street, a.lm, a.loc, a.vtc, a.po, a.subdist, a.dist, a.state, a.pc]),
    pincode: /^\d{6}$/.test(a.pc ?? "") ? a.pc : null,
    district: clean(a.dist),
    state: clean(a.state),
    aadhaar_no: /^\d{12}$/.test(uid) ? uid : null,
    last4: /^\d{12}$/.test(uid) ? uid.slice(-4) : null,
  };
}

/** Parse the text read from the QR. Returns null when it is not an Aadhaar QR or does not pass the sanity checks. */
export async function parseAadhaarQr(raw: string, gunzip: Gunzip = browserGunzip): Promise<AadhaarQr | null> {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (t.startsWith("<")) return parseXml(t);
  const bytes = decimalToBytes(t);
  if (!bytes) return null;
  try {
    const inflated = await gunzip(bytes);
    // 17 text fields + a little slack; the rest of the data is a photo and a signature that are not needed
    const parts = splitOn255(inflated, 20).map(text);
    return parseSecure(parts);
  } catch {
    return null;
  }
}
