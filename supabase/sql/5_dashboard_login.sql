-- FreedomCare: STEP 5. Dashboard logins (role 'viewer'). Run in the Supabase SQL editor after step 3. Safe to run twice.
-- A dashboard login can LOOK at everything (camp list, registrations, photos, which staff member did what) and can
-- CHANGE nothing. The block is in the database, so it holds even if someone opens another screen by typing its address.
-- Logins are made by an admin in the app (Admin > Staff > Add, "Dashboard").

-- ============================================================================
-- 1. Who is a dashboard login
-- ============================================================================
create or replace function public.is_viewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_profiles p where p.user_id = (select auth.uid()) and p.role = 'viewer');
$$;
revoke execute on function public.is_viewer() from public, anon;
grant execute on function public.is_viewer() to authenticated;

-- ============================================================================
-- 2. Read-only: every write to the people tables is refused for a dashboard login (direct writes AND the app's
--    functions such as mark_attendance / complete_distribution, which write through these tables)
-- ============================================================================
create or replace function public.forbid_viewer_writes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select public.is_viewer()) then
    raise exception 'dashboard logins can only view, not change anything' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists camp_roster_viewer_readonly on public.camp_roster;
create trigger camp_roster_viewer_readonly before insert or update or delete on public.camp_roster
  for each row execute function public.forbid_viewer_writes();
drop trigger if exists beneficiaries_viewer_readonly on public.beneficiaries;
create trigger beneficiaries_viewer_readonly before insert or update or delete on public.beneficiaries
  for each row execute function public.forbid_viewer_writes();

-- No uploads from a dashboard login. Same allowed paths as step 4 (no card images), plus the viewer block.
drop policy if exists "staff upload files" on storage.objects;
create policy "staff upload files" on storage.objects for insert to authenticated with check (
  not (select public.is_viewer())
  and (
    (bucket_id = 'handover-photos' and name ~ '^[0-9a-f-]{36}\.jpg$')
    or (bucket_id = 'documents' and (
          name ~ '^[0-9a-f-]{36}/profile\.jpg$'
       or name ~ '^profile/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'))
  )
);

-- ============================================================================
-- 3. What a dashboard login may read (kept even after step 2 limits ordinary staff)
-- ============================================================================
drop policy if exists "dashboard read beneficiaries" on public.beneficiaries;
create policy "dashboard read beneficiaries" on public.beneficiaries for select to authenticated using ((select public.is_viewer()));
drop policy if exists "dashboard read photos" on storage.objects;
create policy "dashboard read photos" on storage.objects for select to authenticated
  using (bucket_id in ('handover-photos', 'documents') and (select public.is_viewer()));

-- Staff names for "marked present by ..." / "handed over by ...". Admins and dashboard logins only.
create or replace function public.staff_names() returns table (user_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select u.id, coalesce(nullif(trim(sp.full_name), ''), split_part(u.email::text, '@', 1))
  from auth.users u left join public.staff_profiles sp on sp.user_id = u.id
  where (select public.is_admin()) or (select public.is_viewer());
$$;
revoke execute on function public.staff_names() from public, anon;
grant execute on function public.staff_names() to authenticated;

-- Check: should list both triggers
select event_object_table, trigger_name from information_schema.triggers where trigger_name like '%viewer_readonly' order by 1;
