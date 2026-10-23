-- FreedomCare: STEP 4. Run in the Supabase SQL editor AFTER this app version is deployed (an older app on a phone would
-- keep retrying a refused card upload; its registration itself is already saved). Safe to run twice.
-- No image of an Aadhaar or UDID card may be stored. The details READ from a card (number, name, date of birth, address,
-- UDID) stay in the tables as before; only the pictures are refused.
-- Files that may be uploaded after this:
--   handover-photos/<uuid>.jpg                    handover photo (one person, or one photo for a wheelchair group)
--   documents/<beneficiary id>/profile.jpg        profile photo taken at registration
--   documents/profile/<roster id>/<uuid>.jpg      profile photo taken at attendance / distribution
-- Anything else (for example documents/<id>/aadhaar.jpg from an older app version) is refused.

drop policy if exists "staff upload files" on storage.objects;
create policy "staff upload files" on storage.objects for insert to authenticated with check (
  (bucket_id = 'handover-photos' and name ~ '^[0-9a-f-]{36}\.jpg$')
  or (bucket_id = 'documents' and (
        name ~ '^[0-9a-f-]{36}/profile\.jpg$'
     or name ~ '^profile/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'))
);

-- Card scans already stored. Supabase does not allow deleting files with SQL: remove them with
--   node scripts/purge-card-scans.mjs            (lists them)
--   node scripts/purge-card-scans.mjs --delete   (deletes them; needs SUPABASE_SERVICE_ROLE_KEY)
-- or in the dashboard: Storage > documents > open each folder > delete aadhaar.jpg / udid.jpg.
-- After that this must return no rows:
select name, created_at from storage.objects
where bucket_id = 'documents' and name !~ '^([0-9a-f-]{36}/profile|profile/[0-9a-f-]{36}/[0-9a-f-]{36})\.jpg$';

-- ROLLBACK (only if an old app version must upload again):
-- drop policy if exists "staff upload files" on storage.objects;
-- create policy "staff upload files" on storage.objects for insert to authenticated
--   with check (bucket_id in ('handover-photos','documents'));
