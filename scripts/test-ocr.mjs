// Unit tests for Aadhaar validation + Gemini normaliser/runner (mocked fetch).
// Run: node scripts/test-ocr.mjs   (compiles the pure TS modules with tsc into .tmp-test, then uses node:test)
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

const out = ".tmp-test";
rmSync(out, { recursive: true, force: true });
execSync(
  `npx tsc src/lib/ocr/verhoeff.ts src/lib/ocr/normalize.ts src/lib/ocr/gemini.ts src/lib/ocr/types.ts src/lib/ocr/prompts.ts src/lib/aadhaar.ts --outDir ${out} --module commonjs --target es2022 --skipLibCheck --rootDir src`,
  { stdio: "inherit" },
);
const require = createRequire(import.meta.url);
const { isValidAadhaar, extractAadhaarFromText, maskAadhaar } = require(`./../${out}/lib/ocr/verhoeff.js`);
const { normalizeModelOutput, normalizeDob } = require(`./../${out}/lib/ocr/normalize.js`);
const { runOcr, buildResponseSchema } = require(`./../${out}/lib/ocr/gemini.js`);

// build a checksum-valid number by brute-forcing the last digit
const { verhoeffValid } = require(`./../${out}/lib/aadhaar.js`);
function makeValid(prefix11) {
  for (let d = 0; d < 10; d++) if (verhoeffValid(prefix11 + d)) return prefix11 + d;
  throw new Error("none");
}
const VALID = makeValid("23456789012");
const INVALID = VALID.slice(0, 11) + ((+VALID[11] + 1) % 10);

test("aadhaar validation", () => {
  assert.equal(isValidAadhaar(VALID), true);
  assert.equal(isValidAadhaar(VALID.replace(/(\d{4})(?=\d)/g, "$1 ")), true);
  assert.equal(isValidAadhaar(INVALID), false);
  assert.equal(isValidAadhaar("123456789012"), false); // first digit 1
  assert.equal(isValidAadhaar("2345"), false);
  assert.equal(isValidAadhaar(null), false);
});

test("extract from tesseract-like text prefers valid", () => {
  const t = `junk 9999 8888 7777 \n ${VALID.slice(0, 4)} ${VALID.slice(4, 8)} ${VALID.slice(8)} more`;
  assert.deepEqual(extractAadhaarFromText(t), { value: VALID, valid: true });
  assert.equal(extractAadhaarFromText("nothing here").value, null);
});

test("mask never exposes full number", () => {
  assert.equal(maskAadhaar(VALID), `XXXX XXXX ${VALID.slice(8)}`);
});

test("dob normalisation", () => {
  assert.equal(normalizeDob("05/03/1990"), "1990-03-05");
  assert.equal(normalizeDob("5-3-1990"), "1990-03-05");
  assert.equal(normalizeDob("31/13/1990"), null);
  assert.equal(normalizeDob("garbage"), null);
});

const f = (value, confidence = 0.95) => ({ value, confidence });

test("normaliser: valid aadhaar, formats, needsReview", () => {
  const r = normalizeModelOutput({
    legibility: 0.9,
    aadhaar_no: f(VALID.replace(/(\d{4})(?=\d)/g, "$1 ")),
    name: f("Asha Devi"), gender: f("female"), dob: f("05/03/1990"), yob: f(null, 0),
    care_of: f("s/o Ramesh"), address: f("12 Main Rd"), pincode: f("600001"), district: f("Chennai"),
    state: f("Tamil Nadu"), vid: f("123"), phone: f("+91 98765 43210"), email: f(null, 0),
  }, "aadhaar");
  assert.equal(r.aadhaarValid, true);
  assert.equal(r.fields.aadhaar_no.value, VALID);
  assert.equal(r.fields.gender.value, "Female");
  assert.equal(r.fields.dob.value, "1990-03-05");
  assert.equal(r.fields.care_of.value, "S/O Ramesh");
  assert.equal(r.fields.phone.value, "9876543210");
  assert.equal(r.fields.vid.value, null); // wrong length -> null + flagged
  assert.ok(r.needsReview.includes("vid"));
  assert.ok(!r.needsReview.includes("aadhaar_no"));
});

test("normaliser: checksum failure flags and caps confidence", () => {
  const r = normalizeModelOutput({ aadhaar_no: f(INVALID, 0.99) }, "aadhaar");
  assert.equal(r.aadhaarValid, false);
  assert.ok(r.needsReview.includes("aadhaar_no"));
  assert.ok(r.fields.aadhaar_no.confidence <= 0.3);
});

test("normaliser: garbage input never throws, nulls everything", () => {
  const r = normalizeModelOutput("nonsense", "aadhaar");
  assert.equal(r.fields.aadhaar_no.value, null);
  assert.ok(r.needsReview.includes("aadhaar_no"));
});

test("normaliser: udid acknowledgement vs card", () => {
  const r = normalizeModelOutput({
    doc_type: f("Acknowledgement"), udid_no: f("mh 0123456789012"), udid_label: f("Enrolment No"),
    name: f("X"), disability_type: f("Locomotor"), disability_pct: f("45 %"),
  }, "udid");
  assert.equal(r.fields.doc_type.value, "acknowledgement");
  assert.equal(r.fields.udid_no.value, "MH0123456789012");
  assert.equal(r.fields.disability_pct.value, "45");
  assert.equal(normalizeModelOutput({ disability_pct: f("150") }, "udid").fields.disability_pct.value, null);
});

function geminiReply(obj) {
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) };
}

test("runOcr: retries once on checksum failure and uses the valid second pass", async () => {
  let calls = 0; const bodies = [];
  const fetchImpl = async (url, init) => {
    calls++; bodies.push(JSON.parse(init.body));
    return geminiReply({ aadhaar_no: f(calls === 1 ? INVALID : VALID) });
  };
  const r = await runOcr({ apiKey: "k", model: "m", fetchImpl }, "aadhaar", "AAAA", "image/jpeg");
  assert.equal(calls, 2);
  assert.equal(r.aadhaarValid, true);
  assert.equal(r.attempts, 2);
  assert.match(bodies[1].systemInstruction.parts[0].text, /SECOND PASS/);
  assert.equal(bodies[0].generationConfig.temperature, 0);
  assert.equal(bodies[0].generationConfig.responseMimeType, "application/json");
});

test("runOcr: both passes invalid -> flagged, not silently accepted", async () => {
  const fetchImpl = async () => geminiReply({ aadhaar_no: f(INVALID) });
  const r = await runOcr({ apiKey: "k", model: "m", fetchImpl }, "aadhaar", "AAAA", "image/jpeg");
  assert.equal(r.aadhaarValid, false);
  assert.ok(r.needsReview.includes("aadhaar_no"));
});

test("runOcr: no retry for udid; rate limit surfaces as OcrError", async () => {
  let calls = 0;
  await runOcr({ apiKey: "k", model: "m", fetchImpl: async () => { calls++; return geminiReply({ udid_no: f("MH1") }); } }, "udid", "A", "image/jpeg");
  assert.equal(calls, 1);
  await assert.rejects(
    runOcr({ apiKey: "k", model: "m", fetchImpl: async () => ({ ok: false, status: 429 }) }, "udid", "A", "image/jpeg"),
    (e) => e.code === "rate_limited",
  );
});

test("response schema lists all fields", () => {
  const s = buildResponseSchema("aadhaar");
  assert.ok(s.properties.aadhaar_no && s.properties.vid && s.properties.legibility);
});
