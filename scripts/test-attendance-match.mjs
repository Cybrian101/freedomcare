// Run: node scripts/test-attendance-match.mjs   (transpiles src/lib/attendance-match.ts with the local TypeScript)
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const out = ts.transpileModule(readFileSync('src/lib/attendance-match.ts', 'utf8'), { compilerOptions: { module: 'ESNext', target: 'ES2022' } }).outputText
mkdirSync('.tmp-test', { recursive: true })
writeFileSync('.tmp-test/attendance-match.mjs', out)
const { nameScore, rankByNameDob, looksLikeAadhaar } = await import(pathToFileURL(process.cwd() + '/.tmp-test/attendance-match.mjs').href)

const row = (id, reg_no, name, extra = {}) => ({ id, reg_no, name, aadhaar_last4: null, dob: null, yob: null, ...extra })
const rows = [
  row('a', '10', 'A. Quillan'),
  row('b', '11', 'Quillan Murugan', { dob: '1980-05-02' }),
  row('c', '12', 'Ezhilarasan G', { aadhaar_last4: '7609' }),
  row('d', '13', 'K.Anjalidevi', { yob: 1990 }),
]

test('order, initials and punctuation do not matter', () => {
  assert.equal(nameScore('Quillan A', 'A. Quillan'), 1)
  assert.ok(nameScore('Murugan', 'Quillan Murugan') >= 0.75)
})
test('one-letter typo still matches, a different name does not', () => {
  assert.ok(nameScore('Ezhilarasn G', 'Ezhilarasan G') >= 0.75)
  assert.equal(nameScore('Kumar', 'Quillan'), 0)
})
test('matching DOB ranks first; missing DOB on file is name_only; different DOB is flagged', () => {
  const r = rankByNameDob(rows, { name: 'Quillan', dob: '1980-05-02' })
  assert.equal(r[0].row.id, 'b')
  assert.equal(r[0].level, 'exact')
  assert.equal(r.find((x) => x.row.id === 'a').level, 'name_only')
  const wrong = rankByNameDob(rows, { name: 'Quillan Murugan', dob: '1975-01-01' })
  assert.equal(wrong.find((x) => x.row.id === 'b').level, 'dob_differs')
})
test('year-only record compares by year', () => {
  assert.equal(rankByNameDob(rows, { name: 'Anjalidevi', dob: '1990-07-07' })[0].level, 'exact')
  assert.equal(rankByNameDob(rows, { name: 'Anjalidevi', dob: '1991-07-07' })[0].level, 'dob_differs')
})
test('no DOB typed: everything is name_only', () => {
  assert.ok(rankByNameDob(rows, { name: 'Quillan' }).every((x) => x.level === 'name_only'))
})
test('onlyWithoutAadhaar skips people who already have one', () => {
  const r = rankByNameDob(rows, { name: 'Ezhilarasan G' }, { onlyWithoutAadhaar: true })
  assert.equal(r.length, 0)
  assert.equal(rankByNameDob(rows, { name: 'Ezhilarasan G' }).length, 1)
})
test('looksLikeAadhaar', () => {
  assert.ok(looksLikeAadhaar('9970 3312 9715'))
  assert.ok(!looksLikeAadhaar('488'))
  assert.ok(!looksLikeAadhaar('Quillan'))
})

test('OCR that lost the space between words still matches', () => {
  assert.equal(nameScore('SundariDevi', 'Sundari Devi'), 1)
  assert.ok(nameScore('SundariDevl', 'Sundari Devi') >= 0.75)
  assert.equal(nameScore('Kumar', 'Sundari Devi'), 0)
})
