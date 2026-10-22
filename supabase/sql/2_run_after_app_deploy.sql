-- FreedomCare: STEP 2 of 2 - LOCK DOWN. Run ONLY after:
--   (a) STEP 1 (1_run_now.sql) has run and the check query at its end shows your email as admin, AND
--   (b) the app version that calls public.check_aadhaar() is deployed (older app versions read the tables directly
--       and will show errors once this is applied).
-- Effect: ordinary staff can no longer read registered beneficiaries' details, any stored photo or scan, or edit
-- registrations. Staff keep everything the camp workflow needs. Admins (staff_profiles.role = 'admin') see all.
-- Nothing is deleted. To undo, run the ROLLBACK block at the bottom.

-- Registrations: staff may still INSERT (policy "staff insert" is untouched); only admins may read or edit them.
drop policy if exists "staff read" on public.beneficiaries;
drop policy if exists "staff update" on public.beneficiaries;
drop policy if exists "admin update beneficiaries" on public.beneficiaries;
create policy "admin update beneficiaries" on public.beneficiaries for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- ("admin read beneficiaries" was created in STEP 1)

-- Photos and scans: staff can upload but not download; admins can read everything.
drop policy if exists "staff read files" on storage.objects;
-- ("admin read files" was created in STEP 1)

-- Check (run as yourself in the SQL editor): should list the remaining policies
select tablename, policyname, cmd from pg_policies
where schemaname in ('public', 'storage') and tablename in ('beneficiaries', 'objects', 'camp_roster') order by 1, 2;

/* ROLLBACK (only if something broke; restores the previous open staff access):
create policy "staff read"   on public.beneficiaries for select to authenticated using (true);
create policy "staff update" on public.beneficiaries for update to authenticated using (true) with check (true);
create policy "staff read files" on storage.objects for select to authenticated
  using (bucket_id in ('handover-photos','documents'));
*/
