// Run: node scripts/test-aadhaar-parse.mjs   (synthetic text only; no real beneficiary data)
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

const out = ".tmp-test/aadhaar";
execSync(
  `npx tsc src/lib/ocr/aadhaar-parse.ts src/lib/ocr/verhoeff.ts src/lib/aadhaar.ts --outDir ${out} --module commonjs --target es2022 --skipLibCheck --rootDir src`,
  { stdio: "inherit" },
);
const require = createRequire(import.meta.url);
const { parseAadhaarText } = require(`./../${out}/lib/ocr/aadhaar-parse.js`);
const { verhoeffValid } = require(`./../${out}/lib/aadhaar.js`);

function makeValid(prefix11) {
  for (let d = 0; d < 10; d++) if (verhoeffValid(prefix11 + d)) return prefix11 + d;
  throw new Error("none");
}
const NUM = makeValid("23456789012");
const GROUPED = `${NUM.slice(0, 4)} ${NUM.slice(4, 8)} ${NUM.slice(8)}`;
const v = (r, k) => r.raw[k].value;

const FRONT = `Government of India
Ee 1 aa
Sample Person Kumar
Date of Birth: 15/08/1994
Male
${GROUPED}
VID : 9123 4567 8901 2345`;

const BACK = `Address:
S/O Ramesh Kumar, 12 Gandhi Street,
Anna Nagar, Chennai, Tamil Nadu - 600040
${GROUPED}
VID : 9123 4567 8901 2345
help@uidai.gov.in www.uidai.gov.in`;

test("front: number, name, dob, gender, vid (VID is not mistaken for the number)", () => {
  const r = parseAadhaarText(FRONT);
  assert.equal(r.found, true);
  assert.equal(v(r, "aadhaar_no"), NUM);
  assert.equal(v(r, "name"), "Sample Person Kumar");
  assert.equal(v(r, "dob"), "15/08/1994");
  assert.equal(v(r, "gender"), "Male");
  assert.equal(v(r, "vid"), "9123456789012345");
});

test("female is not read as male", () => {
  assert.equal(v(parseAadhaarText("Name Here\nDOB: 01/01/2000\nFemale\n" + GROUPED), "gender"), "Female");
});

test("back: care-of, address, pincode, district, state", () => {
  const r = parseAadhaarText(BACK);
  assert.equal(r.found, true);
  assert.equal(v(r, "care_of"), "S/O Ramesh Kumar");
  assert.equal(v(r, "pincode"), "600040");
  assert.equal(v(r, "state"), "Tamil Nadu");
  assert.equal(v(r, "district"), "Chennai");
  assert.equal(v(r, "address"), "12 Gandhi Street, Anna Nagar, Chennai, Tamil Nadu");
  assert.equal(v(r, "name"), null); // never invent a name from address lines
});

test("back with labelled district and state", () => {
  const r = parseAadhaarText(`Address: D/O Meena Devi, H.No 4, Main Road,\nPost Office Sample, Dist: Madurai, State: Tamil Nadu, 625001`);
  assert.equal(v(r, "care_of"), "D/O Meena Devi");
  assert.equal(v(r, "district"), "Madurai");
  assert.equal(v(r, "state"), "Tamil Nadu");
  assert.equal(v(r, "pincode"), "625001");
});

test("e-Aadhaar letter: To / name / address / mobile", () => {
  const r = parseAadhaarText(`To
Sample Person
C/O: Ramesh Kumar, 12 Gandhi Street, Anna Nagar,
Chennai, Tamil Nadu - 600040
Mobile: 9876543210
Your Aadhaar No.: ${GROUPED}
Year of Birth: 1994`);
  assert.equal(v(r, "name"), "Sample Person");
  assert.equal(v(r, "care_of"), "C/O Ramesh Kumar");
  assert.equal(v(r, "phone"), "9876543210");
  assert.equal(v(r, "yob"), "1994");
  assert.equal(v(r, "pincode"), "600040");
  assert.equal(r.found, true);
});

test("year of birth only (no full dob)", () => {
  const r = parseAadhaarText(`Sample Person\nYear of Birth: 1980\nMale\n${GROUPED}`);
  assert.equal(v(r, "dob"), null);
  assert.equal(v(r, "yob"), "1980");
  assert.equal(v(r, "name"), "Sample Person");
});

test("garbage text yields nulls and found=false", () => {
  const r = parseAadhaarText("~~ ## 12 aa\n!!");
  assert.equal(r.found, false);
  for (const k of ["name", "dob", "address", "pincode", "state", "care_of"]) assert.equal(v(r, k), null);
});

test("invalid checksum number is returned but not 'found'", () => {
  const bad = NUM.slice(0, 11) + ((+NUM[11] + 1) % 10);
  const r = parseAadhaarText(`Sample Person\nDOB: 15/08/1994\nMale\n${bad.slice(0, 4)} ${bad.slice(4, 8)} ${bad.slice(8)}`);
  assert.equal(r.found, false);
  assert.equal(v(r, "aadhaar_no"), bad);
});
