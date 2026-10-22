import { extractUdid } from "../udid";

const DISABILITY_RE = /(locomotor|visual impairment|blindness|low vision|hearing impairment|deaf|speech and language|intellectual|mental illness|cerebral palsy|multiple disabilit\w*|dwarfism|muscular dystrophy|leprosy|acid attack|autism|thalassemia|hemophilia|sickle cell|parkinson|multiple sclerosis|chronic neurological)/i;

/** Pure text -> fields for a UDID card / enrolment acknowledgement. Exported for tests. */
export function parseUdidText(text: string): { raw: Record<string, { value: string | null; confidence: number } | number>; found: boolean } {
  const id = extractUdid(text);
  const dob = /(\d{2})[\/-](\d{2})[\/-](\d{4})/.exec(text.slice(Math.max(0, text.search(/birth|dob/i))));
  const pct = /(\d{1,3})\s?%/.exec(text);
  const type = DISABILITY_RE.exec(text);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const ni = lines.findIndex((l) => /^name\b/i.test(l));
  let name: string | null = null;
  if (ni !== -1) {
    // value may sit on the same line ("Name : X") or on the next one
    const same = lines[ni].replace(/^name[^A-Za-z]*(address and other details)?[\s:,.-]*/i, "").replace(/[^A-Za-z .]/g, " ").replace(/\s+/g, " ").trim();
    const next = (lines[ni + 1] ?? "").replace(/\(.*?\)/g, "").replace(/[^A-Za-z .]/g, " ").replace(/\s+/g, " ").trim();
    const cand = same.length >= 4 ? same : next;
    if (cand.length >= 4 && /^[A-Za-z]/.test(cand)) name = cand;
  }
  const ack = /acknowledg|enrol|resident copy|application/i.test(text);
  return {
    found: !!id,
    raw: {
      udid_no: { value: id?.udid_no ?? null, confidence: id ? 0.7 : 0 },
      udid_label: { value: id?.udid_label ?? null, confidence: id ? 0.7 : 0 },
      doc_type: { value: id ? (ack ? "acknowledgement" : "card") : null, confidence: id ? 0.5 : 0 },
      name: { value: name, confidence: name ? 0.35 : 0 },
      dob: { value: dob ? `${dob[1]}/${dob[2]}/${dob[3]}` : null, confidence: dob ? 0.5 : 0 },
      disability_type: { value: type ? type[0] : null, confidence: type ? 0.5 : 0 },
      disability_pct: { value: pct ? pct[1] : null, confidence: pct ? 0.5 : 0 },
      legibility: id ? 0.7 : 0.3,
    },
  };
}

