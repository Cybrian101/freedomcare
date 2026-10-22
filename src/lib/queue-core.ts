// Pure sync state machine for handover-photo submissions. No browser/IDB/Supabase imports so it can be
// unit-tested with a fake store + fake network (see scripts/test-queue.mjs).
//
// Status flow:
//   queued --(attempt)--> syncing --ok--> synced            (resolution: 'created' | 'duplicate')
//                                 --network/transient--> failed (retry w/ backoff, attempts++)
//                                 --permanent--> rejected  (needs a human; manual retry/delete)
//   failed --(backoff elapsed | Retry now)--> syncing ...
//   syncing found at app start (tab killed mid-upload) --> queued

export type QueueStatus = 'queued' | 'syncing' | 'failed' | 'rejected' | 'synced'
/** What the operation does. Items written before kinds existed have no `kind` and are handovers. */
export type QueueKind = 'handover' | 'attendance' | 'registration' | 'link' | 'profile'

export interface QueueItem {
  id: string // == submissionId (also the IndexedDB key); for registrations == the new beneficiary uuid
  kind?: QueueKind
  /** registration: the beneficiaries row to insert (id is client-generated => insert is idempotent).
   *  attendance: { dob } saved only if the record has none. link: { aadhaar_no, dob, yob } added to a listed person. */
  payload?: Record<string, unknown>
  /** registration only: scanned documents, uploaded after the row exists */
  docs?: { aadhaar?: Blob; udid?: Blob; profile?: Blob }
  docsUploaded?: string[]
  /** login that captured this item. The engine will not upload it under a different login unless `adopted`. */
  ownerId?: string
  ownerEmail?: string
  /** staff member's name at capture time, shown in the Sync log */
  ownerName?: string
  adopted?: boolean
  rosterId: string
  regNo: string | null
  name?: string
  blob: Blob | null // dropped once synced to free storage
  submissionId: string
  createdAt: number
  status: QueueStatus
  attempts: number
  lastError: string | null
  nextAttemptAt: number
  syncedAt?: number
  resolution?: 'created' | 'duplicate'
  uploaded?: boolean // photo already in storage; skip re-upload on retry
}

export type ErrorKind = 'network' | 'transient' | 'auth' | 'permanent'
export class QueueError extends Error {
  kind: ErrorKind
  constructor(kind: ErrorKind, message: string) {
    super(message)
    this.kind = kind
    this.name = 'QueueError'
  }
}

export interface QueueStore {
  getAll(): Promise<QueueItem[]>
  get(id: string): Promise<QueueItem | undefined>
  put(item: QueueItem): Promise<void>
  delete(id: string): Promise<void>
}

export interface CompleteResult {
  /** submission_id stored on the server row; differs from ours when another device won. */
  serverSubmissionId: string | null
  distributedAt: string | null
}

export interface QueueRemote {
  /** Upload blob to storage at `path` with upsert. Throw QueueError on failure. */
  upload(path: string, blob: Blob): Promise<void>
  /** Call complete_distribution. Throw QueueError on failure (e.g. permanent 'beneficiary not found'). */
  complete(rosterId: string, path: string, submissionId: string): Promise<CompleteResult>
  /** Idempotent attendance RPC. `dob` (yyyy-mm-dd) is stored only if the record has none yet. */
  attend(rosterId: string, dob?: string | null): Promise<void>
  /** Add an Aadhaar (and DOB) to a person already on the camp list. A repeat with the same values must resolve. */
  link(rosterId: string, aadhaar: string, dob: string | null, yob: number | null): Promise<void>
  /** Insert a registration with a client-generated id. A repeat of the same id must resolve, not throw. */
  register(id: string, row: Record<string, unknown>): Promise<void>
  /** Upload a registration document (private bucket). Existing object == success. */
  uploadDoc(path: string, blob: Blob): Promise<void>
  /** Attach an uploaded profile photo to a camp-list person (server checks the path belongs to that person). */
  setProfile(rosterId: string, path: string): Promise<void>
}

export const kindOf = (i: Pick<QueueItem, 'kind'>): QueueKind => i.kind ?? 'handover'

export const photoPath = (submissionId: string) => `${submissionId}.jpg`

export function backoffMs(attempts: number): number {
  // 15s, 30s, 60s, 120s, 240s, capped at 5 min, each with +-15% jitter
  const base = Math.min(15_000 * 2 ** Math.max(0, attempts - 1), 300_000)
  return Math.round(base * (0.85 + Math.random() * 0.3)) // +-15% jitter so devices do not retry in lockstep
}

export function isActive(i: QueueItem) {
  return i.status !== 'synced'
}

export function newAttendanceItem(p: { rosterId: string; regNo: string | null; name?: string; id: string; dob?: string | null; now?: number }): QueueItem {
  const now = p.now ?? Date.now()
  return {
    id: p.id, kind: 'attendance', rosterId: p.rosterId, regNo: p.regNo, name: p.name, blob: null,
    payload: p.dob ? { dob: p.dob } : undefined,
    submissionId: p.id, createdAt: now, status: 'queued', attempts: 0, lastError: null, nextAttemptAt: now,
  }
}

/** Profile photo taken for a person on the camp list. The person is fixed at capture time (rosterId) and the storage path
 *  is built from it, so the photo can only ever be attached to the person it was taken for. */
export const profilePath = (rosterId: string, id: string) => `profile/${rosterId}/${id}.jpg`

export function newProfileItem(p: {
  rosterId: string
  regNo: string | null
  name?: string
  blob: Blob
  id: string
  now?: number
}): QueueItem {
  const now = p.now ?? Date.now()
  return {
    id: p.id, kind: 'profile', rosterId: p.rosterId, regNo: p.regNo, name: p.name, blob: p.blob,
    submissionId: p.id, createdAt: now, status: 'queued', attempts: 0, lastError: null, nextAttemptAt: now,
  }
}

export function newLinkItem(p: {
  rosterId: string
  regNo: string | null
  name?: string
  id: string
  aadhaar: string
  dob?: string | null
  yob?: number | null
  now?: number
}): QueueItem {
  const now = p.now ?? Date.now()
  return {
    id: p.id, kind: 'link', rosterId: p.rosterId, regNo: p.regNo, name: p.name, blob: null,
    payload: { aadhaar_no: p.aadhaar, dob: p.dob ?? null, yob: p.yob ?? null },
    submissionId: p.id, createdAt: now, status: 'queued', attempts: 0, lastError: null, nextAttemptAt: now,
  }
}

export function newRegistrationItem(p: {
  id: string
  name: string
  payload: Record<string, unknown>
  docs?: { aadhaar?: Blob; udid?: Blob; profile?: Blob }
  now?: number
}): QueueItem {
  const now = p.now ?? Date.now()
  return {
    id: p.id, kind: 'registration', payload: p.payload, docs: p.docs, docsUploaded: [],
    rosterId: p.id, regNo: null, name: p.name, blob: null,
    submissionId: p.id, createdAt: now, status: 'queued', attempts: 0, lastError: null, nextAttemptAt: now,
  }
}

export function newItem(p: {
  rosterId: string
  regNo: string | null
  name?: string
  blob: Blob
  submissionId: string
  now?: number
}): QueueItem {
  const now = p.now ?? Date.now()
  return {
    id: p.submissionId,
    kind: 'handover',
    rosterId: p.rosterId,
    regNo: p.regNo,
    name: p.name,
    blob: p.blob,
    submissionId: p.submissionId,
    createdAt: now,
    status: 'queued',
    attempts: 0,
    lastError: null,
    nextAttemptAt: now,
  }
}

type Listener = () => void

export class SyncEngine {
  private running = false
  private listeners = new Set<Listener>()
  private store: QueueStore
  private remote: QueueRemote
  private clock: () => number
  private owner: () => string | null
  constructor(store: QueueStore, remote: QueueRemote, clock: () => number = Date.now, owner: () => string | null = () => null) {
    this.store = store
    this.remote = remote
    this.clock = clock
    this.owner = owner
  }

  /** True if this item may be uploaded under the current login (unknown owner on either side => allowed). */
  private mine(i: QueueItem): boolean {
    const me = this.owner()
    return !i.ownerId || !me || i.adopted === true || i.ownerId === me
  }

  /** Staff explicitly agree to send an item captured under another login using the current one. */
  async adopt(id: string) {
    const i = await this.store.get(id)
    if (!i || i.status === 'synced') return
    await this.store.put({ ...i, adopted: true, status: i.status === 'rejected' ? 'rejected' : 'queued', nextAttemptAt: 0 })
    this.emit()
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private emit() {
    this.listeners.forEach((l) => l())
  }

  /** Persist FIRST (the "Saved on this device" moment). Caller then calls runOnce() without awaiting. */
  async enqueue(item: QueueItem) {
    await this.store.put(item)
    this.emit()
  }

  /** On app start: items stuck in 'syncing' were interrupted; make them eligible again. */
  async recover() {
    for (const i of await this.store.getAll()) {
      if (i.status === 'syncing') await this.store.put({ ...i, status: 'queued', nextAttemptAt: 0 })
    }
    this.emit()
  }

  /** Manual retry for one item (also revives 'rejected' ones). */
  async retry(id: string) {
    const i = await this.store.get(id)
    if (!i || i.status === 'synced') return
    await this.store.put({ ...i, status: 'queued', nextAttemptAt: 0, lastError: null })
    this.emit()
  }

  async retryAll() {
    for (const i of await this.store.getAll()) {
      if (i.status === 'failed' || i.status === 'rejected')
        await this.store.put({ ...i, status: 'queued', nextAttemptAt: 0 })
    }
    this.emit()
  }

  /** Only unsynced, non-in-flight items may be deleted. Returns false if refused. */
  async remove(id: string): Promise<boolean> {
    const i = await this.store.get(id)
    if (!i || i.status === 'synced' || i.status === 'syncing') return false
    await this.store.delete(id)
    this.emit()
    return true
  }

  /** Process every due item once, sequentially. Re-entrancy safe. Returns number synced. */
  async runOnce(opts: { force?: boolean } = {}): Promise<number> {
    if (this.running) return 0
    this.running = true
    let ok = 0
    try {
      const all = (await this.store.getAll()).sort((a, b) => a.createdAt - b.createdAt)
      for (const it of all) {
        const due =
          it.status === 'queued' ||
          (it.status === 'failed' && (opts.force || it.nextAttemptAt <= this.clock()))
        if (!due || !this.mine(it)) continue
        if (await this.process(it)) ok++
        // stop early if the network is evidently down: the next item would just fail too
        const after = await this.store.get(it.id)
        if (after?.status === 'failed' && after.lastError?.startsWith('Offline')) break
      }
    } finally {
      this.running = false
      this.emit()
    }
    return ok
  }

  private async process(item: QueueItem): Promise<boolean> {
    let cur: QueueItem = { ...item, status: 'syncing', attempts: item.attempts + 1 }
    await this.store.put(cur)
    this.emit()
    try {
      const kind = kindOf(cur)
      if (kind === 'attendance') {
        await this.remote.attend(cur.rosterId, (cur.payload?.dob as string | undefined) ?? null)
        await this.store.put({ ...cur, status: 'synced', lastError: null, syncedAt: this.clock(), resolution: 'created' })
        return true
      }
      if (kind === 'profile') {
        if (!cur.blob && !cur.uploaded) throw new QueueError('permanent', 'Photo data missing on this device')
        const path = profilePath(cur.rosterId, cur.id)
        if (!cur.uploaded && cur.blob) {
          await this.remote.uploadDoc(path, cur.blob) // repeat-safe
          cur = { ...cur, uploaded: true }
          await this.store.put(cur)
        }
        await this.remote.setProfile(cur.rosterId, path)
        await this.store.put({ ...cur, blob: null, status: 'synced', lastError: null, syncedAt: this.clock(), resolution: 'created' })
        return true
      }
      if (kind === 'link') {
        const a = cur.payload?.aadhaar_no as string | undefined
        if (!a) throw new QueueError('permanent', 'Aadhaar data missing on this device')
        await this.remote.link(cur.rosterId, a, (cur.payload?.dob as string | null) ?? null, (cur.payload?.yob as number | null) ?? null)
        await this.store.put({ ...cur, status: 'synced', lastError: null, syncedAt: this.clock(), resolution: 'created' })
        return true
      }
      if (kind === 'registration') {
        if (!cur.payload) throw new QueueError('permanent', 'Registration data missing on this device')
        await this.remote.register(cur.id, cur.payload) // idempotent on the client-generated id
        const done = new Set(cur.docsUploaded ?? [])
        for (const [name, blob] of Object.entries(cur.docs ?? {})) {
          if (!blob || done.has(name)) continue
          await this.remote.uploadDoc(`${cur.id}/${name}.jpg`, blob as Blob)
          done.add(name)
          cur = { ...cur, docsUploaded: [...done] }
          await this.store.put(cur)
        }
        await this.store.put({ ...cur, docs: undefined, status: 'synced', lastError: null, syncedAt: this.clock(), resolution: 'created' })
        return true
      }
      if (!cur.blob && !cur.uploaded) throw new QueueError('permanent', 'Photo data missing on this device')
      const path = photoPath(cur.submissionId)
      if (!cur.uploaded && cur.blob) {
        await this.remote.upload(path, cur.blob) // repeat-safe
        cur = { ...cur, uploaded: true }
        await this.store.put(cur)
      }
      const res = await this.remote.complete(cur.rosterId, path, cur.submissionId)
      const dup = !!res.serverSubmissionId && res.serverSubmissionId !== cur.submissionId
      await this.store.put({
        ...cur,
        status: 'synced',
        blob: null, // free space; server has the photo
        lastError: null,
        syncedAt: this.clock(),
        resolution: dup ? 'duplicate' : 'created',
      })
      return true
    } catch (e) {
      const err = e instanceof QueueError ? e : new QueueError('transient', (e as Error)?.message ?? String(e))
      if (err.kind === 'permanent') {
        await this.store.put({ ...cur, status: 'rejected', lastError: err.message })
      } else {
        const msg = err.kind === 'network' ? 'Offline - will retry' : err.message
        await this.store.put({
          ...cur,
          status: 'failed',
          lastError: msg,
          nextAttemptAt: this.clock() + backoffMs(cur.attempts),
        })
      }
      return false
    }
  }
}
