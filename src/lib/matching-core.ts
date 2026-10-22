// Pure decision logic for "is this person already a beneficiary?". No browser/Supabase imports so it can be
// unit-tested (scripts/test-matching.mjs). The one rule it enforces: a failed or impossible lookup is NEVER a
// "no match". Only a completed server check against a verified dataset can say "confirmed_no_match".

export interface Candidate {
  id: string
  reg_no: string | null
  name: string
}

export type ServerLookup =
  | { status: 'ok'; rosterRow: Candidate | null; registered: Candidate | null }
  | { status: 'unavailable'; reason: 'offline' | 'error' }

export type InconclusiveReason = 'offline' | 'lookup_failed' | 'dataset_not_ready' | 'invalid_number'

export type MatchOutcome =
  | { kind: 'confirmed_match'; row: Candidate }
  | { kind: 'already_registered'; row: Candidate }
  | { kind: 'candidates'; rows: Candidate[]; pendingLocal: boolean }
  | { kind: 'confirmed_no_match' }
  | { kind: 'inconclusive'; reason: InconclusiveReason; candidates: Candidate[] }

export interface DecideInput {
  aadhaarValid: boolean
  /** shortlist from the on-device last-4 index (never a confirmation) */
  localCandidates: Candidate[]
  /** registrations saved on this device and not yet synced that carry the same Aadhaar */
  pendingLocal: Candidate[]
  datasetReady: boolean
  server: ServerLookup
}

export function decide(i: DecideInput): MatchOutcome {
  if (!i.aadhaarValid) return { kind: 'inconclusive', reason: 'invalid_number', candidates: [] }

  if (i.server.status === 'ok') {
    if (i.server.rosterRow) return { kind: 'confirmed_match', row: i.server.rosterRow }
    if (i.server.registered) return { kind: 'already_registered', row: i.server.registered }
    if (i.pendingLocal.length) return { kind: 'candidates', rows: i.pendingLocal, pendingLocal: true }
    // The server answered "none". That is only a reliable no-match if our own dataset is complete as well,
    // otherwise the person could be on the list under a mistyped Aadhaar.
    if (!i.datasetReady) return { kind: 'inconclusive', reason: 'dataset_not_ready', candidates: i.localCandidates }
    if (i.localCandidates.length) return { kind: 'candidates', rows: i.localCandidates, pendingLocal: false }
    return { kind: 'confirmed_no_match' }
  }

  // Server not reachable: we can only shortlist from the device.
  const all = [...i.pendingLocal, ...i.localCandidates]
  if (all.length) return { kind: 'candidates', rows: all, pendingLocal: i.pendingLocal.length > 0 }
  return { kind: 'inconclusive', reason: i.server.reason === 'offline' ? 'offline' : 'lookup_failed', candidates: [] }
}

/** Registration may only start when a reliable check found nothing, or staff accept a verify-on-sync draft. */
export function canStartRegistration(
  o: MatchOutcome,
  opts: { datasetReady: boolean },
): 'yes' | 'draft_needs_verification' | 'no' {
  if (o.kind === 'confirmed_no_match') return 'yes'
  if (
    o.kind === 'inconclusive' &&
    (o.reason === 'offline' || o.reason === 'lookup_failed') &&
    opts.datasetReady &&
    o.candidates.length === 0
  )
    return 'draft_needs_verification'
  return 'no'
}
