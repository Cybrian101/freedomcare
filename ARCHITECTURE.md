# FreedomCare Architecture

Mobile-first PWA for Freedom Trust's Chennai camp (24 Oct 2026, sponsor Vara). Next.js 16 (App Router), Supabase (Auth, Postgres, Storage), Tailwind v4. Term: "beneficiary". Reg. No. is the token.

## Routes
- `/login` (group `(auth)`): Supabase email/password. Sign-ups disabled; admin creates accounts.
- `(app)` group (authenticated), three separate workflows:
  - `/registration` (+ `/registration/new`, `/registration/assign`): scan Aadhaar -> shows number, name, DOB -> match by Aadhaar; if not found, offer (a) add Aadhaar/DOB to a listed person who had none (`link_aadhaar`), or (b) save as a new member directly.
  - `/attendance`: type Reg. No./name/Aadhaar, scan Aadhaar, or name + DOB (`lib/attendance-match.ts`) -> `mark_attendance(id, dob?)`.
  - `/distribution` (+ `/distribution/profile?id=`): call token -> search -> photograph handover -> save (`complete_distribution`). No attendance step.
  - `/admin` (admins only): People, Staff (create/switch off logins, server action with service-role key), Activity (who did what for whom).
- `src/proxy.ts` (Next 16 replacement for middleware): refreshes session cookies, redirects anonymous users to `/login`, signed-in users away from `/login`. Static assets excluded by matcher.
- Route handlers: `/api/ocr` (Gemini fallback, server-only key).

## Staff and activity log
- Only admin-created logins exist (sign-ups disabled). Server actions in `app/(app)/admin/actions.ts` use `SUPABASE_SERVICE_ROLE_KEY` after checking `is_admin()`.
- `audit_log` rows (actor, action, beneficiary name, Reg. No.) are written by DB triggers/RPCs at sync time, so the actor is always the signed-in staff member. Read only via `admin_activity()`; ~150 bytes per row.
- SQL: `supabase/sql/3_staff_attendance_activity.sql` (after step 1).

## Data flow
- Phase 2 (camp day): `camp_roster` seeded from Excel. Staff find a beneficiary -> `mark_attendance(id)` -> handover: capture photo -> upload to `handover-photos` -> `complete_distribution(id, photo_path, submission_id)`. Both RPCs are idempotent; completion fails without a photo.
- Phase 1 (test): scan registration writes `beneficiaries` (Aadhaar + UDID fields, `source='registered'`); documents go to `documents` bucket.
- Reads/writes use the browser client under RLS (any authenticated user = staff). Server components use `lib/supabase/server.ts`.

## Offline queue (idb)
Camp wifi is unreliable. Handover = a queued job `{id, roster_id, photo Blob, submission_id (uuid, generated at capture), created_at}` stored in IndexedDB. A sync loop (on `online`, app focus, 15 s timer) per job: upload photo to `handover-photos/{roster_id}/{submission_id}.jpg` (upsert) -> call `complete_distribution` -> delete job. Retries are safe because of the stable `submission_id` and idempotent RPC. UI shows "queued" until synced; attendance may also be queued (idempotent). Roster for search can be cached in IndexedDB after first load for offline lookup.

## OCR flow
1. Capture/upload card image (client-side downscale).
2. Tesseract.js in-browser (eng) -> text.
3. Parse: `normalizeAadhaar` (12 digits, first 2-9, Verhoeff), `extractUdid`, name/DOB/address heuristics -> `OcrResult<T>` with per-field confidence.
4. Low confidence, checksum failure, or missing fields -> `needsReview=true`; optional fallback POST to `/api/ocr` (Gemini, `GEMINI_API_KEY`/`GEMINI_MODEL`, server-side only).
5. Staff always confirm/edit in a review form before save. Aadhaar is shown masked (`maskAadhaar`) except in edit.

## Security
- Anon key only in the browser; RLS on all tables; buckets private (staff read via signed URLs). RPC execute revoked from `anon`.
- Server trusts `auth.getClaims()` (validated JWT), never `getSession()`.
- Aadhaar numbers are sensitive: masked in lists, never logged, no third-party sends except the optional Gemini fallback (image only on explicit staff action).
- Secrets (`GEMINI_API_KEY`) never `NEXT_PUBLIC_`.

## Folder layout
```
src/proxy.ts                 auth guard
src/app/(auth)/login         login page
src/app/(app)/...            authenticated pages
src/app/api/ocr              Gemini fallback route
src/lib/supabase/{client,server}.ts
src/lib/{types,aadhaar,udid,roster}.ts
src/lib/offline/             idb queue + sync (UI/offline agent)
src/lib/ocr/                 tesseract + parsers (OCR agent)
supabase/migrations/         SQL
```

## Ownership
- Architect: ARCHITECTURE.md, `proxy.ts`, `lib/supabase/*`, `lib/types.ts`, `lib/aadhaar.ts`, `lib/udid.ts`, `lib/roster.ts`, route-group scaffolding.
- UI/UX: contents of `(app)` and `(auth)`, components, styling.
- OCR agent: `lib/ocr/*`, `/api/ocr`. Offline agent: `lib/offline/*`, service worker/manifest.
- Data agent: SQL migrations, seed script.
