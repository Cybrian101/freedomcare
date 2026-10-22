// Run: node scripts/test-queue.mjs   (transpiles src/lib/queue-core.ts with the local TypeScript)
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const src = readFileSync('src/lib/queue-core.ts', 'utf8')
const out = ts.transpileModule(src, { compilerOptions: { module: 'ESNext', target: 'ES2022' } }).outputText
mkdirSync('.tmp-test', { recursive: true })
writeFileSync('.tmp-test/queue-core.mjs', out)
const core = await import(pathToFileURL(process.cwd() + '/.tmp-test/queue-core.mjs').href)
const { SyncEngine, QueueError, newItem, newAttendanceItem, newLinkItem, newRegistrationItem, photoPath, backoffMs } = core

function mk() {
  const db = new Map()
  const store = {
    getAll: async () => [...db.values()].map((x) => ({ ...x })),
    get: async (id) => (db.get(id) ? { ...db.get(id) } : undefined),
    put: async (i) => void db.set(i.id, { ...i }),
    delete: async (id) => void db.delete(id),
  }
  const net = { up: true, uploads: 0, completes: 0, serverSub: null, completeErr: null, attends: 0, lastDob: undefined, links: [], linkErr: null, regs: new Set(), regCalls: 0, docs: 0, regErr: null, docFailOnce: false }
  const remote = {
    attend: async (_r, dob) => {
      if (!net.up) throw new QueueError('network', 'x')
      net.attends++
      net.lastDob = dob
    },
    link: async (r, a, dob, yob) => {
      if (!net.up) throw new QueueError('network', 'x')
      if (net.linkErr) throw net.linkErr
      net.links.push({ r, a, dob, yob })
    },
    register: async (id) => {
      if (!net.up) throw new QueueError('network', 'x')
      net.regCalls++
      if (net.regErr) throw net.regErr
      net.regs.add(id) // set semantics == server primary key: a repeat is not a second row
    },
    uploadDoc: async () => {
      if (!net.up) throw new QueueError('network', 'x')
      if (net.docFailOnce) { net.docFailOnce = false; throw new QueueError('transient', 'storage 500') }
      net.docs++
    },
    upload: async () => {
      if (!net.up) throw new QueueError('network', 'x')
      net.uploads++
    },
    complete: async (_r, _p, sub) => {
      if (!net.up) throw new QueueError('network', 'x')
      if (net.completeErr) throw net.completeErr
      net.completes++
      return { serverSubmissionId: net.serverSub ?? sub, distributedAt: 'now' }
    },
  }
  let t = 1_000_000
  const who = { id: null }
  const eng = new SyncEngine(store, remote, () => t, () => who.id)
  return { db, net, eng, who, advance: (ms) => (t += ms) }
}
const item = (id = 's1') =>
  newItem({ rosterId: 'r1', regNo: '12', blob: new Blob(['x']), submissionId: id, now: 1_000_000 })

test('saved locally first, then synced', async () => {
  const { db, eng } = mk()
  await eng.enqueue(item())
  assert.equal(db.get('s1').status, 'queued')
  assert.equal(await eng.runOnce(), 1)
  const r = db.get('s1')
  assert.equal(r.status, 'synced')
  assert.equal(r.blob, null)
  assert.equal(r.resolution, 'created')
})

test('offline -> failed with backoff; recovers when online', async () => {
  const { db, net, eng, advance } = mk()
  net.up = false
  await eng.enqueue(item())
  await eng.runOnce()
  assert.equal(db.get('s1').status, 'failed')
  assert.equal(db.get('s1').attempts, 1)
  net.up = true
  assert.equal(await eng.runOnce(), 0) // backoff not elapsed
  advance(17_251) // max jittered 1st backoff is 15s*1.15
  assert.equal(await eng.runOnce(), 1)
  assert.equal(db.get('s1').status, 'synced')
})

test('force (Retry now) ignores backoff', async () => {
  const { db, net, eng } = mk()
  net.up = false
  await eng.enqueue(item())
  await eng.runOnce()
  net.up = true
  assert.equal(await eng.runOnce({ force: true }), 1)
  assert.equal(db.get('s1').status, 'synced')
})

test('upload ok but complete fails: retry does not re-upload', async () => {
  const { db, net, eng } = mk()
  net.completeErr = new QueueError('transient', 'server 500')
  await eng.enqueue(item())
  await eng.runOnce()
  assert.equal(db.get('s1').uploaded, true)
  net.completeErr = null
  await eng.runOnce({ force: true })
  assert.equal(net.uploads, 1)
  assert.equal(net.completes, 1)
  assert.equal(db.get('s1').status, 'synced')
})

test('permanent error -> rejected, not auto-retried; manual retry revives', async () => {
  const { db, net, eng, advance } = mk()
  net.completeErr = new QueueError('permanent', 'beneficiary not found')
  await eng.enqueue(item())
  await eng.runOnce()
  assert.equal(db.get('s1').status, 'rejected')
  advance(10 * 60_000)
  assert.equal(await eng.runOnce(), 0)
  assert.equal(db.get('s1').status, 'rejected')
  net.completeErr = null
  await eng.retry('s1')
  assert.equal(await eng.runOnce(), 1)
})

test('second device: server has other submission id -> synced as duplicate', async () => {
  const { db, net, eng } = mk()
  net.serverSub = 'other-device'
  await eng.enqueue(item())
  await eng.runOnce()
  assert.equal(db.get('s1').status, 'synced')
  assert.equal(db.get('s1').resolution, 'duplicate')
})

test('synced item is not reprocessed', async () => {
  const { db, eng } = mk()
  await eng.enqueue(item())
  await eng.runOnce()
  await eng.retry('s1')
  assert.equal(await eng.runOnce(), 0)
  assert.equal(db.get('s1').status, 'synced')
})

test('interrupted syncing recovered on start', async () => {
  const { db, eng } = mk()
  db.set('s1', { ...item(), status: 'syncing', attempts: 1 })
  await eng.recover()
  assert.equal(db.get('s1').status, 'queued')
  assert.equal(await eng.runOnce(), 1)
})

test('delete only for unsynced', async () => {
  const a = mk()
  await a.eng.enqueue(item('a'))
  await a.eng.runOnce()
  assert.equal(await a.eng.remove('a'), false)
  const b = mk()
  b.net.up = false
  await b.eng.enqueue(item('c'))
  await b.eng.runOnce()
  assert.equal(await b.eng.remove('c'), true)
  assert.equal(b.db.has('c'), false)
})

test('photo path and backoff', () => {
  assert.equal(photoPath('abc'), 'abc.jpg')
  for (let n = 0; n < 50; n++) {
    assert.ok(backoffMs(1) >= 12750 && backoffMs(1) <= 17250)
    assert.ok(backoffMs(20) <= 345000 && backoffMs(20) >= 255000)
  }
})

test('attendance is queued, synced once, and never marks distribution', async () => {
  const { db, net, eng } = mk()
  await eng.enqueue(newAttendanceItem({ rosterId: 'r1', regNo: '12', id: 'a1', now: 1_000_000 }))
  assert.equal(db.get('a1').status, 'queued')
  await eng.runOnce()
  assert.equal(db.get('a1').status, 'synced')
  assert.equal(net.attends, 1)
  assert.equal(net.completes, 0)
})

test('registration: offline keeps payload+docs, resumes, creates exactly one row', async () => {
  const { db, net, eng, advance } = mk()
  net.up = false
  await eng.enqueue(newRegistrationItem({ id: 'reg1', name: 'N', payload: { id: 'reg1', name: 'N' }, docs: { aadhaar: new Blob(['a']), udid: new Blob(['u']) }, now: 1_000_000 }))
  await eng.runOnce()
  assert.equal(db.get('reg1').status, 'failed')
  assert.ok(db.get('reg1').payload && db.get('reg1').docs.aadhaar, 'nothing discarded while unsynced')
  net.up = true
  advance(400_000)
  net.docFailOnce = true // first doc upload fails after the row insert
  await eng.runOnce()
  assert.equal(db.get('reg1').status, 'failed')
  assert.ok(db.get('reg1').docs, 'docs kept after partial failure')
  advance(400_000)
  await eng.runOnce()
  assert.equal(db.get('reg1').status, 'synced')
  assert.equal(net.regs.size, 1)
  assert.equal(db.get('reg1').docs, undefined)
})

test('registration rejected (e.g. duplicate Aadhaar) is kept for review, not retried', async () => {
  const { db, net, eng, advance } = mk()
  net.regErr = new QueueError('permanent', 'Aadhaar already registered')
  await eng.enqueue(newRegistrationItem({ id: 'reg2', name: 'N', payload: { id: 'reg2' }, now: 1_000_000 }))
  await eng.runOnce()
  assert.equal(db.get('reg2').status, 'rejected')
  advance(10_000_000)
  await eng.runOnce()
  assert.equal(net.regCalls, 1)
  assert.ok(db.get('reg2').payload, 'evidence preserved')
})

test('legacy items without kind are handovers', async () => {
  const { db, net, eng } = mk()
  const it = item('legacy'); delete it.kind
  await eng.enqueue(it)
  await eng.runOnce()
  assert.equal(db.get('legacy').status, 'synced')
  assert.equal(net.completes, 1)
})

test('items captured under another login are held until adopted', async () => {
  const { db, net, eng, who } = mk()
  who.id = 'userB'
  await eng.enqueue({ ...item('o1'), ownerId: 'userA' })
  await eng.enqueue({ ...item('o2'), ownerId: 'userB' })
  await eng.runOnce()
  assert.equal(db.get('o1').status, 'queued', 'A item not uploaded by B')
  assert.equal(db.get('o2').status, 'synced')
  assert.equal(net.completes, 1)
  await eng.adopt('o1')
  await eng.runOnce()
  assert.equal(db.get('o1').status, 'synced')
  who.id = 'userA'
  await eng.enqueue({ ...item('o3'), ownerId: 'userA' })
  await eng.runOnce()
  assert.equal(db.get('o3').status, 'synced', 'owner can always upload their own')
})

test('unknown current login does not block uploads', async () => {
  const { db, eng } = mk()
  await eng.enqueue({ ...item('u1'), ownerId: 'userA' })
  await eng.runOnce()
  assert.equal(db.get('u1').status, 'synced')
})

test('attendance carries the date of birth to the server only when one was given', async () => {
  const { net, eng } = mk()
  await eng.enqueue(newAttendanceItem({ rosterId: 'r1', regNo: '12', id: 'a2', dob: '1980-05-02', now: 1_000_000 }))
  await eng.runOnce()
  assert.equal(net.lastDob, '1980-05-02')
  await eng.enqueue(newAttendanceItem({ rosterId: 'r2', regNo: '13', id: 'a3', now: 1_000_001 }))
  await eng.runOnce()
  assert.equal(net.lastDob, null)
})

test('link Aadhaar: queued offline, sent once online, permanent conflict is parked not retried', async () => {
  const { db, net, eng } = mk()
  net.up = false
  await eng.enqueue(newLinkItem({ rosterId: 'r1', regNo: '12', id: 'l1', aadhaar: '234567890107', dob: '1980-05-02', now: 1_000_000 }))
  await eng.runOnce()
  assert.equal(db.get('l1').status, 'failed')
  assert.equal(net.links.length, 0)
  net.up = true
  await eng.runOnce({ force: true })
  assert.equal(db.get('l1').status, 'synced')
  assert.deepEqual(net.links, [{ r: 'r1', a: '234567890107', dob: '1980-05-02', yob: null }])

  net.linkErr = new QueueError('permanent', 'this Aadhaar is already on another record')
  await eng.enqueue(newLinkItem({ rosterId: 'r2', regNo: '13', id: 'l2', aadhaar: '234567890107', now: 1_000_002 }))
  await eng.runOnce()
  assert.equal(db.get('l2').status, 'rejected')
})
