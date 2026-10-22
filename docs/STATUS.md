# FreedomCare - implementation status

Legend: DONE+TESTED (ran automatically), DONE (built, type-checked, NOT exercised in a browser), TODO, NEEDS-APPROVAL.

## Verified commands (this machine, Node 20)
| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 0 warnings (generated `public/tesseract`, `public/sw.js` ignored) |
| `npm test` | queue 14/14, matching 9/9, OCR parsers 12/12 |
| `npm run build` | succeeds; routes `/`, `/registration`, `/registration/new`, `/distribution`, `/distribution/profile`, `/queue`, `/login`, `/api/ocr` |
| `next start` smoke | `/home`, `/scan`, `/desk`, `/register` redirect to real pages; `/sw.js` and OCR assets served; no `Date.now`/`ERR_STREAM`/hydration text in the server log |

## Root causes of the reported errors
- **`Date.now()` prerender error**: the auth lookup (`getClaims`) ran inside the layout shell that is prerendered under `cacheComponents`. It now lives in its own `<Suspense>` (`AppFrame.tsx > Account`). The build is clean. **Not reproduced** before the fix because it needs a signed-in session (no test credentials); confirm in a signed-in dev session.
- **`ERR_STREAM_DESTROYED`**: expected to be a consequence of the failed render stream; **unverified** (same reason).
- **Hydration mismatch (`data-bs-theme`, `exifer-panel-container`)**: those attributes/elements are not produced by this codebase (no `data-bs-theme`, no `exifer` anywhere in `src`), so this is a browser extension injecting into the page. Not an app defect; no suppression flags added. Verify in a profile without extensions.
- **`/home` 404**: no such route. Now redirects to `/`.
- **`/api/ocr` 503**: the route returns 503 `not_configured` by design when `GEMINI_API_KEY` is unset. Fix is architectural: scanning now reads on the device first (see below) so a missing key no longer blocks scanning. Signed-out API calls now get 401 JSON instead of a login redirect.

## What changed
- **Two workflows**: `/registration` (scan -> match -> `/registration/new`) and `/distribution` (Reg. No. search -> `/distribution/profile?id=`). Old URLs redirect. Shared roster, one queue.
- **Local-first data** (`src/lib/local-db.ts`, IndexedDB): full roster download with count verification, indexed Reg. No./name search, readiness panel (`DatasetPanel`). "Offline-ready" is claimed only when the downloaded count equals the server count.
- **Matching** (`src/lib/matching-core.ts`): a failed, offline or unverified lookup can never yield "no match"; offline new registrations are only allowed as verify-on-sync drafts.
- **Queue** (`src/lib/queue-core.ts`): handover photos, attendance and registrations are persisted before any network call; bounded backoff with jitter; idempotent on client-generated ids; registrations keep their payload and documents until the server confirms; permanent conflicts are parked as "rejected" for review, never retried forever.
- **Truthful status**: distribution shows "Confirmed" only from the server row; a queued handover shows "Saved on this device - awaiting sync".
- **OCR**: on-device tesseract.js first (worker/WASM/English data self-hosted under `/tesseract`, copied by `scripts/copy-ocr-assets.mjs`); server Gemini only as fallback when local reading gives no checksum-valid number. Local pass also extracts name and DOB heuristically.
- **Offline shell**: `public/sw.js` caches pages and static assets; `PwaRegister` warms the main screens after sign-in; `SessionLease` locks the UI after 12 h without a successful online session check (unsynced data is untouched); sign-out refuses while unsynced items exist and clears the cached roster otherwise.
- **Privacy**: devices keep only the last 4 Aadhaar digits (shortlist; always staff-confirmed). Full numbers are not stored locally.

## Not tested in a real browser (needs a signed-in session)
Everything under "DONE" that touches the UI: dataset download, offline search, offline handover capture, refresh persistence, reconnect sync, service-worker offline start, camera. The engine and matching logic are unit-tested; the wiring is type-checked only.

## Not implemented / needs a decision
1. **In-app Excel import UI with preview** - TODO. The existing `scripts/parse_excel.py` already handles continuation rows and produced the 461-row seed. A UI needs a role model and write policy (identity columns are read-only to the app today).
2. **Roles and audit log** - drafted in `supabase/drafts/20261022000000_roles_audit.sql`, **not applied** (production DB change; needs your approval).
3. **Server-side idempotency table / HMAC Aadhaar lookup / orphan-photo reconciliation / signed-URL viewer / rate limiting** - TODO. Idempotency today relies on `submission_id` unique, `distributed_needs_photo` check, the idempotent RPCs and client-generated registration ids. Orphan photos (uploaded, record never saved) are possible and need a periodic cleanup job.
4. **Closed events / multi-event support** - the schema has no event table (single camp). Not added.
5. **Python OCR service** - not built; not needed while local OCR + optional Gemini exist.
6. **Costs / hosting recommendation, backups, legal review of Aadhaar use** - not written; need real camp numbers from you.
7. **Android hardware OCR benchmarks** - not measured.

## Needed from you
- A staff test login (or permission to create one) to run the signed-in browser checks above.
- Approval to apply the roles/audit draft migration.
- `GEMINI_API_KEY` only if you want the online fallback reader.

## Update: OCR, admin page, SQL (latest)
- OCR measured in Node with the shipped engine/data on the two sample disability cards: clean card read correctly (~0.5 s); the sideways enrolment sample failed at 0 degrees and read its enrolment number correctly at 90 degrees (~3.5 s). The app now auto-rotates (0/90/270) and has an on-device UDID/enrolment reader. Not yet timed on a phone; no Aadhaar sample was available.
- Photos: compressed on the phone (longest side 1600 px, JPEG, <= 1.5 MB) with a fallback decode path for iPhone.
- Admin page `/admin` (nav item shows only for admins). Protection is database RLS, applied by `supabase/sql/2_run_after_app_deploy.sql`.
- SQL to run: `supabase/sql/1_run_now.sql` then, after deploying this app version, `supabase/sql/2_run_after_app_deploy.sql`. Step 1 was dry-run inside a rolled-back transaction (no errors, nothing kept).

## Update: three workflows, staff management, activity log
- **Workflows are now separate**: Register (`/registration`), Attendance (`/attendance`, new nav item), Distribute (`/distribution`: token -> search -> photo -> save; no attendance step).
- **Register**: scanning an Aadhaar now shows number + name + DOB (editable). If the Aadhaar is not found, it lists people who are on the camp list WITHOUT an Aadhaar and match the card's name/DOB ("This is them: add Aadhaar and DOB"), or saves the scanned person as a new member directly. Both are queued offline-first.
- **Attendance**: type Reg. No./name/Aadhaar, scan Aadhaar, or name + DOB (fuzzy name, DOB makes it exact; a differing DOB needs a second confirmation). Works offline from the device list.
- **Admin** (`/admin`): People, Staff (add name/email/password, switch off a login, reset password), Activity (staff name, what, which beneficiary, when).
- **Verified**: typecheck, lint, all test suites (queue 18, matching 9, OCR 12, Aadhaar 3, UDID 8, name/DOB matcher 7), `npm run build`. SQL step 3 was dry-run against the live database inside a rolled-back transaction (link, repeat link, duplicate refusal, attendance keeping an existing DOB, activity feed); nothing was kept.
- **NOT verified**: the screens in a real browser/phone (needs a signed-in session), and staff creation (needs the service-role key).
- **To go live**: run `supabase/sql/3_staff_attendance_activity.sql`; add `SUPABASE_SERVICE_ROLE_KEY` in Vercel; redeploy. Until the SQL is run the app keeps working (list download falls back to the old columns); only the new admin tabs and DOB/link features report that the SQL is missing.

## Update: OCR safety, offline readiness, Sync log per login, mobile review
- **Sync log** is tied to the signed-in staff login: "Still waiting" (with the reason: waiting for internet / failed, will retry / needs attention), "Done - confirmed by the server" (from `my_activity()`, so it also shows work done on other phones), and a separate "belongs to another login" box for items left on the phone by someone else. Each entry says what it is (Handover photo / Attendance / New member / Details added), for whom, by whom and when; handover photos show a thumbnail.
- **Offline readiness checklist** on the Sync screen reads the browser caches: list downloaded and verified, screens stored, scanner engine stored. The scanner engine is now loaded once in the background while online (`warmOcrEngine`), because the right WASM build depends on the phone.
- **OCR**: a number that fails the checksum now offers "Did a digit get misread?" one-tap fixes (single digit, only OCR-confusable swaps). Unread name/DOB are flagged on the confirm screen. Name matching tolerates OCR dropping the space between words.
- **Measured** (Node, shipped engine, synthetic cards with rotation/noise/blur, fake people): Aadhaar number 4/4, DOB 3/4, name 2/4 (name is the weak field on a noisy photo; staff always confirm). No real Aadhaar was available, so real-card accuracy is NOT measured.
- **Mobile**: fixed the Aadhaar number box clipping below ~390px, bottom menu overflow at 320-360px (5-6 items), iOS zoom on inputs under 16px, missing `viewport-fit=cover` (notch/home-bar padding), 40px tap targets, camera top bar under the notch, header crowding at 320px. NOT tested on physical devices.

## Update: offline rebuilt, scanner pipeline, profile photos, UI unified
- **Offline**: the service worker is generated per build and stores every build file at install (previously only files requested while online, so a never-opened screen such as the profile could not start offline), serves screens from the phone with network time-outs, and registers on every page. Verified in Chrome against a production build: with the server stopped, the page loaded from the phone and the app started (React attached, all scripts run). NOT verified: signed-in screens offline on a real phone (needs a login), iOS Safari.
- **Scanner**: reads at full resolution (was 1600 px, too small for a 12 MP photo of a card), finds the card's orientation on a small copy first, reads the QR code (name, DOB, gender, address; last 4 digits of the number) with ZXing-wasm (fallback to the phone's own detector when present), re-reads the digit line enlarged, tries a shadow-resistant black-and-white pass, cross-checks the number against the QR, and corrects a single misread digit only when the QR's last 4 digits confirm it. On large synthetic phone photos (tilted, sideways, noisy, shadowed): number 5/5, DOB 5/5, name 4/5, about 1.5-3 s each (was 7-17 s). The QR decoder follows the published Secure QR format but has NOT been run on a real card.
- **Profile photo** at attendance, on the distribution profile and at registration, mapped to the person by id (see ARCHITECTURE). Needs `supabase/sql/3_staff_attendance_activity.sql`.
- **UI**: every screen now uses the design kit; two-column layouts on desktop, single column on phones (checked at 320, 390, 768 and 1280 px), new camera screen with the person's name and Reg. No. always shown, Install button on Home.
