// Run: node scripts/test-matching.mjs   (transpiles src/lib/matching-core.ts with the local TypeScript)
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const out = ts.transpileModule(readFileSync('src/lib/matching-core.ts', 'utf8'), { compilerOptions: { module: 'ESNext', target: 'ES2022' } }).outputText
mkdirSync('.tmp-test', { recursive: true })
writeFileSync('.tmp-test/matching-core.mjs', out)
const { decide, canStartRegistration } = await import(pathToFileURL(process.cwd() + '/.tmp-test/matching-core.mjs').href)

const P = { id: 'p', reg_no: '466', name: 'T. Example Person' }
const base = { aadhaarValid: true, localCandidates: [], pendingLocal: [], datasetReady: true }
const none = { status: 'ok', rosterRow: null, registered: null }

test('server hit is a confirmed match', () => {
  assert.equal(decide({ ...base, server: { status: 'ok', rosterRow: P, registered: null } }).kind, 'confirmed_match')
})
test('server none + verified dataset + no shortlist = confirmed no match', () => {
  assert.equal(decide({ ...base, server: none }).kind, 'confirmed_no_match')
})
test('server none but dataset not ready is inconclusive, not no-match', () => {
  const o = decide({ ...base, datasetReady: false, server: none })
  assert.equal(o.kind, 'inconclusive')
  assert.equal(canStartRegistration(o, { datasetReady: false }), 'no')
})
test('server none but last-4 shortlist exists => candidates for review', () => {
  assert.equal(decide({ ...base, localCandidates: [P], server: none }).kind, 'candidates')
})
test('503/timeout/offline NEVER yields no-match', () => {
  for (const reason of ['offline', 'error']) {
    const o = decide({ ...base, server: { status: 'unavailable', reason } })
    assert.equal(o.kind, 'inconclusive')
  }
})
test('offline with shortlist shows candidates (verification required)', () => {
  assert.equal(decide({ ...base, localCandidates: [P], server: { status: 'unavailable', reason: 'offline' } }).kind, 'candidates')
})
test('offline, ready dataset, nothing found => only a verify-on-sync draft is allowed', () => {
  const o = decide({ ...base, server: { status: 'unavailable', reason: 'offline' } })
  assert.equal(canStartRegistration(o, { datasetReady: true }), 'draft_needs_verification')
  assert.equal(canStartRegistration(o, { datasetReady: false }), 'no')
})
test('pending local registration with same Aadhaar blocks a second one', () => {
  const o = decide({ ...base, pendingLocal: [{ id: 'x', reg_no: null, name: 'Pending' }], server: { status: 'unavailable', reason: 'offline' } })
  assert.equal(o.kind, 'candidates')
  assert.equal(canStartRegistration(o, { datasetReady: true }), 'no')
})
test('invalid Aadhaar number is inconclusive', () => {
  assert.equal(decide({ ...base, aadhaarValid: false, server: none }).kind, 'inconclusive')
})
