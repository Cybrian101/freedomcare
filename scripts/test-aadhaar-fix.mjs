// Run: node scripts/test-aadhaar-fix.mjs   (transpiles src/lib/aadhaar.ts + src/lib/ocr/verhoeff.ts)
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

mkdirSync('.tmp-test/fix/ocr', { recursive: true })
const tr = (f) => ts.transpileModule(readFileSync(f, 'utf8'), { compilerOptions: { module: 'ESNext', target: 'ES2022' } }).outputText
writeFileSync('.tmp-test/fix/aadhaar.mjs', tr('src/lib/aadhaar.ts'))
writeFileSync('.tmp-test/fix/ocr/verhoeff.mjs', tr('src/lib/ocr/verhoeff.ts').replace('"../aadhaar"', '"../aadhaar.mjs"'))
const { suggestAadhaarFixes, isValidAadhaar } = await import(pathToFileURL(process.cwd() + '/.tmp-test/fix/ocr/verhoeff.mjs').href)

const GOOD = '234567890107' // from the camp list: passes the checksum
test('a valid number gets no suggestions', () => assert.deepEqual(suggestAadhaarFixes(GOOD), []))
test('a confusable misread is repaired and the repair is valid', () => {
  for (let i = 0; i < 12; i++) {
    const swap = { 0: '8', 1: '7', 2: '7', 3: '8', 4: '9', 5: '6', 6: '5', 7: '1', 8: '3', 9: '4' }[GOOD[i]]
    const bad = GOOD.slice(0, i) + swap + GOOD.slice(i + 1)
    if (isValidAadhaar(bad)) continue
    const fixes = suggestAadhaarFixes(bad)
    assert.ok(fixes.some((f) => f.digits === GOOD), `position ${i + 1}: ${bad} should suggest ${GOOD}`)
    assert.ok(fixes.every((f) => isValidAadhaar(f.digits)))
  }
})
test('wrong length gives nothing', () => assert.deepEqual(suggestAadhaarFixes('12345'), []))
