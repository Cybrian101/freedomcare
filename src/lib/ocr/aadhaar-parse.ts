import { extractAadhaarFromText } from "./verhoeff";

type RawField = { value: string | null; confidence: number };

const STATES = [
  "Andaman and Nicobar Islands", "Dadra and Nagar Haveli and Daman and Diu", "Jammu and Kashmir", "Andhra Pradesh",
  "Arunachal Pradesh", "Himachal Pradesh", "Madhya Pradesh", "Uttar Pradesh", "Tamil Nadu", "West Bengal",
  "Chhattisgarh", "Uttarakhand", "Maharashtra", "Karnataka", "Telangana", "Rajasthan", "Meghalaya", "Jharkhand",
  "Puducherry", "Pondicherry", "Chandigarh", "Lakshadweep", "Nagaland", "Mizoram", "Manipur", "Tripura", "Sikkim",
  "Gujarat", "Haryana", "Punjab", "Kerala", "Odisha", "Orissa", "Assam", "Bihar", "Delhi", "Goa", "Ladakh",
];
const STATE_RE = new RegExp(`\\b(${STATES.map((s) => s.replace(/ /g, "\\s+")).join("|")})\\b`, "gi");

const NOT_A_NAME = /government|india|aadhaar|aadhar|unique|authority|male|female|transgender|address|enrol|dob|birth|year|\bvid\b|virtual|help|uidai|www|download|issue|mobile|signature|digitally/i;
const BLOCK_END = /^\W*(vid\b|virtual id|help@|www\.|email|1947|uidai|aadhaar\s+(is|no)|\d{4}\s?\d{4}\s?\d{4}(\s?\d{4})?\W*$)/i;
const CARE_OF = /\b([SDWC])\s*\/\s*[O0]\s*[:.,-]?\s*([A-Za-z][A-Za-z .]*)/i;
const DATE = /(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4})/;
const PIN = /(?<!\d)[1-9]\d{5}(?!\d)/g;

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/** A line that looks like a person's name: mostly letters, a few real words. Returns the cleaned name or null. */
function asName(line: string): string | null {
  const visible = line.replace(/\s/g, "");
  if (!visible) return null;
  const letters = (visible.match(/[A-Za-z]/g) ?? []).length;
  if (letters / visible.length < 0.75) return null; // Hindi / symbol noise from the English-only OCR
  const cleaned = tidy(line.replace(/[^A-Za-z .]/g, " "));
  const words = cleaned.split(" ").filter(Boolean);
  if (cleaned.length < 3 || words.length > 5 || NOT_A_NAME.test(cleaned)) return null;
  if (words.filter((w) => w.replace(/\./g, "").length >= 2).length < Math.ceil(words.length / 2)) return null;
  return cleaned;
}

function guessName(lines: string[]): string | null {
  const to = lines.findIndex((l) => /^to\W*$/i.test(l)); // e-Aadhaar letter: "To" then the name
  if (to !== -1 && lines[to + 1]) {
    const n = asName(lines[to + 1]);
    if (n) return n;
  }
  // card front: Name, then DOB, then gender. Anchor on whichever of those lines was read.
  let anchor = lines.findIndex((l) => /\bdob\b|date of birth|year of birth|\byob\b/i.test(l));
  if (anchor === -1) anchor = lines.findIndex((l) => /\b(fe)?male\b|transgender/i.test(l));
  // Several lines above the anchor can look "name-like" (OCR noise from the photo box or the logo). Prefer the one with the
  // most real words and letters; on a tie the line nearest the anchor wins.
  let best: { name: string; score: number } | null = null;
  for (let i = anchor - 1; i >= Math.max(0, anchor - 6); i--) {
    const n = asName(lines[i]);
    if (!n) continue;
    const words = n.split(" ").filter(Boolean);
    const score = words.filter((w) => w.replace(/\./g, "").length >= 3).length * 2 + words.filter((w) => /^[A-Z]/.test(w)).length + n.replace(/[^A-Za-z]/g, "").length;
    if (!best || score > best.score) best = { name: n, score };
  }
  return best ? dropTrailingJunk(best.name) : null;
}

/** "Sundari Devi Raman ROR BRE": noise from the next part of the card glued onto a correctly read mixed-case name. */
function dropTrailingJunk(name: string): string {
  const words = name.split(" ");
  const mixed = words.filter((w) => /^[A-Z][a-z]{2,}/.test(w)).length;
  if (mixed < 2) return name; // an all-capitals name is printed that way: leave it alone
  while (words.length > 2 && /^[A-Z]{2,4}$/.test(words[words.length - 1]!)) words.pop(); // keeps single-letter initials such as "S"
  return words.join(" ");
}

function findDob(lines: string[]): RawField {
  for (let i = 0; i < lines.length; i++) {
    if (!/\bdob\b|date of birth|d\.o\.b/i.test(lines[i])) continue;
    const m = DATE.exec(lines[i]) ?? DATE.exec(lines[i + 1] ?? "");
    if (m) return { value: `${m[1]}/${m[2]}/${m[3]}`, confidence: 0.5 };
  }
  // unlabelled date: skip the ones on issue / download / generated lines
  for (const l of lines) {
    if (/issue|download|generated|print|date:/i.test(l)) continue;
    const m = DATE.exec(l);
    if (m) return { value: `${m[1]}/${m[2]}/${m[3]}`, confidence: 0.3 };
  }
  return { value: null, confidence: 0 };
}

interface AddressBlock { address: string | null; careOf: string | null; pincode: string | null }

function findAddress(lines: string[], text: string): AddressBlock {
  let start = lines.findIndex((l) => /^\W*address\b/i.test(l));
  if (start === -1) start = lines.findIndex((l) => CARE_OF.test(l));
  let block = "";
  if (start !== -1) {
    const parts: string[] = [];
    for (let i = start; i < lines.length && parts.length < 8; i++) {
      if (i > start && BLOCK_END.test(lines[i])) break;
      parts.push(lines[i]);
      PIN.lastIndex = 0;
      if (PIN.test(lines[i])) break; // the address ends at the pincode
    }
    block = parts.join(" ");
  }
  block = tidy(
    block
      .replace(/^\W*address\s*[:\-]?/i, "")
      .replace(/(mobile|mob|phone)[^\d]{0,6}(\+?91[\s-]?)?\d{10}/gi, "")
      .replace(/[|_~]+/g, " ")
      .replace(/\s+,/g, ",")
      .replace(/,\s*,+/g, ","),
  );

  const pins = [...block.matchAll(PIN)].map((m) => m[0]);
  const labelled = /\bpin\s*(?:code)?\s*[:\-]?\s*(\d{6})\b/i.exec(text)?.[1] ?? null;
  const pincode = pins[pins.length - 1] ?? labelled;

  // care-of: take the one inside the address block, else the first on the document
  const co = CARE_OF.exec(block) ?? CARE_OF.exec(text);
  const careOf = co ? `${co[1].toUpperCase()}/O ${tidy(co[2])}` : null;

  let address = block;
  const inBlock = CARE_OF.exec(address);
  if (inBlock) address = address.replace(inBlock[0], "");
  if (pincode) address = address.replace(new RegExp(`[\\s,\\-:]*(?:pin\\s*(?:code)?\\s*[:\\-]?\\s*)?${pincode}\\W*$`, "i"), "");
  address = tidy(address.replace(/^[\s,.:\-]+|[\s,\-:]+$/g, ""));
  return { address: address.length >= 8 ? address : null, careOf, pincode };
}

function findDistrictState(address: string | null, text: string): { district: string | null; state: string | null; districtConf: number } {
  const hay = address ?? text;
  const labelled = (re: RegExp) => re.exec(hay)?.[1]?.trim() ?? null;
  const end = String.raw`(?=\s*(?:,|\bstate\b|\bpin\b|\bdist|-|\d|$))`;
  let district = labelled(new RegExp(String.raw`\bdist(?:rict|\.)?\s*[:\-.]?\s*([A-Za-z][A-Za-z ]*?)${end}`, "i"));
  let state = labelled(new RegExp(String.raw`\bstate\s*[:\-.]?\s*([A-Za-z][A-Za-z ]*?)${end}`, "i"));
  let districtConf = district ? 0.45 : 0;

  const all = [...hay.matchAll(STATE_RE)];
  const last = all[all.length - 1];
  if (!state && last) state = tidy(last[1]).replace(/\b\w/g, (c) => c.toUpperCase());
  if (!district && last && last.index !== undefined) {
    // "..., <district>, <state> - <pin>": the comma segment just before the state
    const seg = hay.slice(0, last.index).split(",").map((s) => tidy(s.replace(/[^A-Za-z .]/g, " "))).filter((s) => s.length >= 3);
    const cand = seg[seg.length - 1];
    if (cand && cand.split(" ").length <= 3 && !NOT_A_NAME.test(cand)) { district = cand; districtConf = 0.25; }
  }
  return { district, state, districtConf };
}

export interface AadhaarParse {
  raw: Record<string, RawField | number>;
  /** the key identifier was found: a checksum-valid number, or (back side only) a readable address */
  found: boolean;
  number: { value: string | null; valid: boolean };
}

/** Pure text -> fields for an Aadhaar card (front and/or back) or e-Aadhaar letter. Exported for tests. */
export function parseAadhaarText(text: string): AadhaarParse {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // the 16-digit VID looks like three Aadhaar groups plus one more; take it out before looking for the 12-digit number
  const vidRe = /(?:(?:vid|virtual\s*id)\s*[:\-]?\s*)?(?<!\d)(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})(?!\d)/i;
  const vidM = vidRe.exec(text);
  const vid = vidM ? vidM.slice(1, 5).join("") : null;
  const number = extractAadhaarFromText(vidM ? text.replace(vidM[0], " ") : text);

  const dob = findDob(lines);
  const yob = /(?:year of birth|yob)\s*[:\-]?\s*((?:19|20)\d{2})/i.exec(text)?.[1] ?? null;
  const gender = /\b(female|male|transgender)\b/i.exec(text)?.[1] ?? null;
  const name = guessName(lines);
  const { address, careOf, pincode } = findAddress(lines, text);
  const { district, state, districtConf } = findDistrictState(address, text);
  const phone = /(?:mobile|mob|phone|contact)\s*(?:no\.?)?\s*[:\-]?\s*(?:\+?91[\s-]?)?([6-9]\d{9})/i.exec(text)?.[1] ?? null;
  const email = [...text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0]).find((e) => !/uidai/i.test(e)) ?? null;

  const f = (value: string | null, confidence: number): RawField => ({ value, confidence: value ? confidence : 0 });
  const backOnly = !number.value && !!address && !!pincode;
  const found = number.valid || backOnly;

  return {
    found,
    number,
    raw: {
      aadhaar_no: { value: number.value, confidence: number.valid ? 0.7 : number.value ? 0.2 : 0 },
      name: f(name, 0.4),
      gender: f(gender, 0.6),
      dob,
      yob: f(dob.value ? null : yob, 0.5),
      care_of: f(careOf, 0.4),
      address: f(address, 0.4),
      pincode: f(pincode, 0.5),
      district: f(district, districtConf),
      state: f(state, 0.5),
      vid: f(vid, 0.5),
      phone: f(phone, 0.5),
      email: f(email, 0.5),
      legibility: found ? 0.7 : 0.3,
    },
  };
}
