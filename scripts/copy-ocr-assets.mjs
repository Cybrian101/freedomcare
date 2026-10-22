// Copies the on-device OCR engine (tesseract.js worker + WASM core + English language data) into public/tesseract
// so scanning works with no network after the first load. Run automatically before dev/build.
import { cpSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const out = 'public/tesseract'
mkdirSync(join(out, 'lang'), { recursive: true })

cpSync('node_modules/tesseract.js/dist/worker.min.js', join(out, 'worker.min.js'))
const core = 'node_modules/tesseract.js-core'
for (const f of readdirSync(core)) if (/^tesseract-core.*\.(js|wasm)$/.test(f)) cpSync(join(core, f), join(out, f))

const lang = 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'
if (!existsSync(lang)) throw new Error('Missing @tesseract.js-data/eng; run npm install')
cpSync(lang, join(out, 'lang/eng.traineddata.gz'))
console.log('OCR assets copied to', out)

// QR decoder (ZXing, WebAssembly) for the QR printed on Aadhaar cards. Served from this site so it also works offline.
mkdirSync('public/zxing', { recursive: true })
const zx = 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'
if (!existsSync(zx)) throw new Error('Missing zxing-wasm; run npm install')
cpSync(zx, 'public/zxing/zxing_reader.wasm')
console.log('QR decoder copied to public/zxing')
