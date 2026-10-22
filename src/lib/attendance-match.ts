// Pure "who is this person?" ranking for people without a usable Aadhaar: name + date of birth against the camp list.
// No browser/Supabase imports so it can be unit-tested (scripts/test-attendance-match.mjs).
// Rule: a name match is only ever a SHORTLIST. Staff confirm the person on screen; DOB makes the shortlist trustworthy.

export interface MatchRow {
  id: string
  reg_no: string | null
  name: string
  aadhaar_last4: string | null
  /** yyyy-mm-dd or null when never captured */
  dob: string | null
  yob: number | null
}

/** exact = name matches and DOB (or at least the year) agrees; name_only = no DOB on file to compare; dob_differs = name matches but DOB does not */
export type MatchLevel = 'exact' | 'name_only' | 'dob_differs'

export interface Ranked<T> {
  row: T
  level: MatchLevel
  /** 0..1 name similarity */
  score: number
}

export const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

/** Levenshtein distance, bailing out once it exceeds `max`. */
function dist(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = cur[0]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** How well one query token matches one name token: 1 equal, initials and small typos score lower, else 0. */
function tokenScore(q: string, t: string): number {
  if (q === t) return 1
  if (q.length === 1 || t.length === 1) return q[0] === t[0] ? 0.7 : 0 // "R" vs "Ramesh"
  const max = Math.max(q.length, t.length) >= 7 ? 2 : 1
  if (Math.min(q.length, t.length) >= 4) {
    const d = dist(q, t, max)
    if (d <= max) return d === 1 ? 0.88 : 0.75
  }
  return 0
}

/** Similarity 0..1 of two names. Order-insensitive ("Kumar R" ~ "R. Kumar"); tolerant of initials and one-letter typos. */
export function nameScore(query: string, candidate: string): number {
  const q = norm(query).split(' ').filter(Boolean)
  const c = norm(candidate).split(' ').filter(Boolean)
  if (!q.length || !c.length) return 0
  const used = new Set<number>()
  let sum = 0
  for (const qt of q) {
    let best = 0
    let bi = -1
    c.forEach((ct, i) => {
      if (used.has(i)) return
      const s = tokenScore(qt, ct)
      if (s > best) { best = s; bi = i }
    })
    if (bi >= 0) used.add(bi)
    sum += best
  }
  const byWords = sum / q.length
  // OCR often drops the space between words ("SundariDevi"): compare the names with spaces removed as well.
  const qs = q.join('')
  const cs = c.join('')
  let squashed = 0
  if (qs === cs) squashed = 1
  else if (Math.min(qs.length, cs.length) >= 5) {
    const max = Math.max(qs.length, cs.length) >= 10 ? 2 : 1
    const d = dist(qs, cs, max)
    if (d <= max) squashed = d === 1 ? 0.9 : 0.8
  }
  return Math.max(byWords, squashed)
}

function dobLevel(row: Pick<MatchRow, 'dob' | 'yob'>, dob: string | null, yob: number | null): MatchLevel {
  if (!dob && !yob) return 'name_only'
  if (!row.dob && !row.yob) return 'name_only'
  if (dob && row.dob) return dob === row.dob ? 'exact' : 'dob_differs'
  const qy = dob ? Number(dob.slice(0, 4)) : yob
  const ry = row.dob ? Number(row.dob.slice(0, 4)) : row.yob
  return qy === ry ? 'exact' : 'dob_differs'
}

const RANK: Record<MatchLevel, number> = { exact: 0, name_only: 1, dob_differs: 2 }

/**
 * Rank people from `rows` against a typed or scanned name and date of birth. Rows scoring under `min` are dropped.
 * `onlyWithoutAadhaar` limits the shortlist to people who have no Aadhaar on file (the ones an Aadhaar scan can complete).
 */
export function rankByNameDob<T extends MatchRow>(
  rows: T[],
  q: { name: string; dob?: string | null; yob?: number | null },
  opts: { min?: number; onlyWithoutAadhaar?: boolean; limit?: number } = {},
): Ranked<T>[] {
  const min = opts.min ?? 0.75
  const dob = q.dob && /^\d{4}-\d{2}-\d{2}$/.test(q.dob) ? q.dob : null
  const yob = q.yob ?? null
  const out: Ranked<T>[] = []
  for (const row of rows) {
    if (opts.onlyWithoutAadhaar && row.aadhaar_last4) continue
    const score = nameScore(q.name, row.name)
    if (score < min) continue
    out.push({ row, level: dobLevel(row, dob, yob), score })
  }
  out.sort(
    (a, b) =>
      RANK[a.level] - RANK[b.level] ||
      b.score - a.score ||
      (a.row.reg_no ?? '').localeCompare(b.row.reg_no ?? '', undefined, { numeric: true }),
  )
  return out.slice(0, opts.limit ?? 8)
}

/** True when the text is a complete 12-digit number (spaces allowed): treat it as an Aadhaar, not a Reg. No. */
export function looksLikeAadhaar(text: string): boolean {
  return text.replace(/\s/g, '').length === 12 && /^\d{12}$/.test(text.replace(/\s/g, ''))
}
