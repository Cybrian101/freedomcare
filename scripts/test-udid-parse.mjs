// Run: node scripts/test-udid-parse.mjs   (synthetic text only; no real beneficiary data)
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const opts = { compilerOptions: { module: 'ESNext', target: 'ES2022' } }
mkdirSync('.tmp-test', { recursive: true })
writeFileSync('.tmp-test/udid.mjs', ts.transpileModule(readFileSync('src/lib/udid.ts', 'utf8'), opts).outputText)
writeFileSync(
  '.tmp-test/udid-parse.mjs',
  ts.transpileModule(readFileSync('src/lib/ocr/udid-parse.ts', 'utf8'), opts).outputText.replace('"../udid"', '"./udid.mjs"'),
)
const { parseUdidText } = await import(pathToFileURL(process.cwd() + '/.tmp-test/udid-parse.mjs').href)
const v = (r, k) => r.raw[k].value

// Shaped like real OCR output from a UDID card (noise lines included), with made-up values.
const CARD = `1. UNIQUE DISABILITY ID
== Government of India Sa!
Name Aw Eb
SAMPLE PERSON
UD ID
MH0123456789012
Disability Type
LOCOMOTOR DISABILITY
Date of Birth % of Disability
15-08-1994 45%
Date of Issue Valid upto
01-01-2026 PERMANENT`

const ENROL = `Enrolment No : 3321/00000/2311/0318749 Date : 07/11/2023 07:26:55
Department of Empowerment of Persons with Disabilities
Acknowledgement / Resident Copy
Name, Address and other details
Sample Name ( Female )
Date of Birth : 27/07/2010`

test('UDID card: number, type, dob, percentage', () => {
  const r = parseUdidText(CARD)
  assert.equal(r.found, true)
  assert.equal(v(r, 'udid_no'), 'MH0123456789012')
  assert.equal(v(r, 'udid_label'), 'UDID No')
  assert.equal(v(r, 'doc_type'), 'card')
  assert.match(v(r, 'disability_type'), /locomotor/i)
  assert.equal(v(r, 'dob'), '15/08/1994')
  assert.equal(v(r, 'disability_pct'), '45')
})

test('enrolment acknowledgement is recognised as such and keeps the slashes', () => {
  const r = parseUdidText(ENROL)
  assert.equal(r.found, true)
  assert.equal(v(r, 'udid_no'), '3321/00000/2311/0318749')
  assert.equal(v(r, 'udid_label'), 'Enrolment No')
  assert.equal(v(r, 'doc_type'), 'acknowledgement')
  assert.equal(v(r, 'dob'), '27/07/2010')
})

test('garbage text finds nothing and invents nothing', () => {
  const r = parseUdidText('Ss hy J mi bg & 4 bE oe .\nLC 5 SA bl rh SY Fs.')
  assert.equal(r.found, false)
  for (const k of ['udid_no', 'name', 'dob', 'disability_type', 'disability_pct']) assert.equal(v(r, k), null)
})
