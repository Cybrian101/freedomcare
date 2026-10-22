// Run: node scripts/test-aadhaar-qr.mjs
// Builds SYNTHETIC Aadhaar-style QR codes (made-up people) in the documented formats, renders them as images, decodes them
// with the same reader the app uses (ZXing) and parses them with src/lib/ocr/aadhaar-qr.ts.
// NOTE: this proves the decoder follows the published format. It has not been run against a real card.
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { readBarcodes } from 'zxing-wasm/reader'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const QRCode = require('qrcode')

mkdirSync('.tmp-test', { recursive: true })
writeFileSync('.tmp-test/aadhaar-qr.mjs', ts.transpileModule(readFileSync('src/lib/ocr/aadhaar-qr.ts', 'utf8'), { compilerOptions: { module: 'ESNext', target: 'ES2022' } }).outputText)
const { parseAadhaarQr } = await import(pathToFileURL(process.cwd() + '/.tmp-test/aadhaar-qr.mjs').href)
const gunzip = async (b) => new Uint8Array(gunzipSync(b))

function secureText(fields, { version = 'V2' } = {}) {
  const enc = (s) => Buffer.from(s, 'utf8')
  const parts = [version, '0', ...fields].map(enc)
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0x00, 0x10]) // binary data containing 0xFF, like the real photo block
  const joined = Buffer.concat([...parts.flatMap((p) => [p, Buffer.from([255])]), photo])
  const hex = gzipSync(joined).toString('hex')
  return BigInt('0x' + hex).toString(10)
}

const FIELDS = [
  '490512102026123456789', 'Ramesh Kumar Selvam', '14-03-1982', 'M', 'S/O Selvam', 'Chennai', 'Near Temple', '12/4',
  'Mylapore', '600004', 'Mylapore PO', 'Tamil Nadu', 'Kutchery Road', 'Mylapore Mambalam', 'Chennai',
]

/** Render text as a QR image (RGBA) exactly as a camera frame would present it, then decode it with ZXing (the app's decoder). */
async function roundTripQr(text, scale = 5) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'L' })
  const n = qr.modules.size, quiet = 4, dim = (n + quiet * 2) * scale
  const rgba = new Uint8ClampedArray(dim * dim * 4).fill(255)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) {
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + quiet) * scale + dy) * dim + (x + quiet) * scale + dx) * 4
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 0
    }
  }
  const res = await readBarcodes({ data: rgba, width: dim, height: dim }, { formats: ['QRCode'], tryHarder: true })
  return res.find((r) => r.isValid)?.text ?? null
}

test('secure QR: encodes, decodes from an image with ZXing, and parses into the right fields', async () => {
  const text = secureText(FIELDS)
  const read = await roundTripQr(text)
  assert.equal(read, text, 'ZXing must read the large numeric QR back exactly')
  const r = await parseAadhaarQr(read, gunzip)
  assert.equal(r.kind, 'secure')
  assert.equal(r.name, 'Ramesh Kumar Selvam')
  assert.equal(r.dob, '1982-03-14')
  assert.equal(r.gender, 'Male')
  assert.equal(r.pincode, '600004')
  assert.equal(r.state, 'Tamil Nadu')
  assert.equal(r.last4, '4905')
  assert.equal(r.aadhaar_no, null)
  assert.match(r.address, /Mylapore/)
})

test('works when the version marker is absent or different (positions are anchored on the reference id)', async () => {
  for (const version of ['V3', '']) {
    const r = await parseAadhaarQr(secureText(FIELDS, { version }), gunzip)
    assert.equal(r?.name, 'Ramesh Kumar Selvam')
  }
})

test('year-only date of birth is kept as a year', async () => {
  const f = [...FIELDS]; f[2] = '1982'
  const r = await parseAadhaarQr(secureText(f), gunzip)
  assert.equal(r.dob, null)
  assert.equal(r.yob, '1982')
})

test('old XML QR gives the full number', async () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><PrintLetterBarcodeData uid="234567890107" name="Anita Devi" gender="F" yob="1990" co="W/O Raman" house="5" street="Main Rd" vtc="Adyar" po="Adyar" dist="Chennai" state="Tamil Nadu" pc="600020"/>'
  const r = await parseAadhaarQr(xml, gunzip)
  assert.equal(r.kind, 'xml')
  assert.equal(r.aadhaar_no, '234567890107')
  assert.equal(r.last4, '0107')
  assert.equal(r.yob, '1990')
  assert.equal(r.gender, 'Female')
})

test('anything that does not look right is rejected, never guessed', async () => {
  assert.equal(await parseAadhaarQr('hello', gunzip), null)
  assert.equal(await parseAadhaarQr('https://example.com/x', gunzip), null)
  assert.equal(await parseAadhaarQr('1'.repeat(400), gunzip), null) // numeric but not gzip data
  const bad = [...FIELDS]; bad[9] = 'ABCDEF' // pincode not 6 digits
  assert.equal(await parseAadhaarQr(secureText(bad), gunzip), null)
  const badDob = [...FIELDS]; badDob[2] = 'yesterday'
  assert.equal(await parseAadhaarQr(secureText(badDob), gunzip), null)
})
