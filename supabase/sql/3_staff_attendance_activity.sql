-- FreedomCare: STEP 3. Run in the Supabase SQL editor AFTER 1_run_now.sql. Safe to run twice.
-- ADDITIVE ONLY: new columns, new functions, one replaced function (mark_attendance, same behaviour plus an optional
-- date of birth). Nothing is dropped except the old one-argument mark_attendance, which the new one replaces.
-- Adds: staff names + the "staff" role, date of birth on the camp list, linking an Aadhaar to a listed person,
-- and an admin-only activity log that shows WHO did WHAT for WHICH beneficiary.

-- ============================================================================
-- 1. Staff names and the ordinary "staff" role (admins create staff in the app; roles stay admin/staff)
-- ============================================================================
alter table public.staff_profiles add column if not exists full_name text;
alter table public.staff_profiles drop constraint if exists staff_profiles_role_check;
alter table public.staff_profiles
  add constraint staff_profiles_role_check check (role in ('admin', 'staff', 'registration', 'distribution', 'viewer'));

-- ============================================================================
-- 2. Date of birth on the camp list (so attendance can match name + DOB when there is no Aadhaar)
-- ============================================================================
alter table public.camp_roster add column if not exists dob date;
alter table public.camp_roster add column if not exists yob smallint;

-- Add an Aadhaar (and DOB) to a person who is already on the camp list without one. Repeat-safe.
create or replace function public.link_aadhaar(p_roster_id uuid, p_aadhaar text, p_dob date, p_yob smallint)
returns public.camp_roster
language plpgsql security definer set search_path = '' as $$
declare r public.camp_roster; had_aadhaar boolean; had_dob boolean;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  if p_aadhaar !~ '^[2-9][0-9]{11}$' then raise exception 'invalid aadhaar format'; end if;
  select * into r from public.camp_roster where id = p_roster_id for update;
  if not found then raise exception 'beneficiary not found'; end if;
  if r.aadhaar_no is not null and r.aadhaar_no <> p_aadhaar then
    raise exception 'this person already has a different Aadhaar on file';
  end if;
  if exists (select 1 from public.camp_roster where aadhaar_no = p_aadhaar and id <> p_roster_id) then
    raise exception 'this Aadhaar is already on another record';
  end if;
  had_aadhaar := r.aadhaar_no is not null;
  had_dob := r.dob is not null or r.yob is not null;
  update public.camp_roster
     set aadhaar_no = p_aadhaar,
         dob = coalesce(dob, p_dob),
         yob = coalesce(yob, p_yob, extract(year from p_dob)::smallint)
   where id = p_roster_id returning * into r;
  if not had_aadhaar or (not had_dob and (p_dob is not null or p_yob is not null)) then
    insert into public.audit_log (actor, action, entity, entity_id, reg_no, detail)
    values ((select auth.uid()), 'details_added', 'camp_roster', r.id, r.reg_no,
            jsonb_build_object('aadhaar', not had_aadhaar, 'dob', not had_dob and (p_dob is not null or p_yob is not null)));
  end if;
  return r;
end $$;
revoke execute on function public.link_aadhaar(uuid, text, date, smallint) from public, anon;
grant execute on function public.link_aadhaar(uuid, text, date, smallint) to authenticated;

-- Attendance: same as before, plus an optional DOB that is saved only if the record has none yet.
drop function if exists public.mark_attendance(uuid);
create or replace function public.mark_attendance(p_id uuid, p_dob date default null)
returns public.camp_roster
language plpgsql security definer set search_path = '' as $$
declare r public.camp_roster;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  update public.camp_roster
     set attended_at = coalesce(attended_at, now()),
         attended_by = coalesce(attended_by, (select auth.uid())),
         dob = coalesce(dob, p_dob),
         yob = coalesce(yob, extract(year from p_dob)::smallint)
   where id = p_id returning * into r;
  if not found then raise exception 'beneficiary not found'; end if;
  return r;
end $$;
revoke execute on function public.mark_attendance(uuid, date) from public, anon;
grant execute on function public.mark_attendance(uuid, date) to authenticated;

-- ============================================================================
-- 3. Activity log: who did what for which beneficiary (about 150 bytes per row; 10,000 actions is roughly 2 MB)
-- ============================================================================
alter table public.audit_log add column if not exists subject_name text;

-- Fill in the beneficiary's name automatically, so every existing and future audit insert carries it.
create or replace function public.audit_fill_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.subject_name is null and new.entity_id is not null then
    if new.entity = 'camp_roster' then
      select name into new.subject_name from public.camp_roster where id = new.entity_id;
    elsif new.entity = 'beneficiaries' then
      select name into new.subject_name from public.beneficiaries where id = new.entity_id;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.audit_fill_name() from public, anon, authenticated;
drop trigger if exists audit_log_fill_name on public.audit_log;
create trigger audit_log_fill_name before insert on public.audit_log
  for each row execute function public.audit_fill_name();

-- A new registration made at the camp (details saved by a staff member)
create or replace function public.audit_beneficiary() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor, action, entity, entity_id, detail)
  values ((select auth.uid()), 'registered', 'beneficiaries', new.id,
          jsonb_build_object('aadhaar', new.aadhaar_no is not null, 'udid', new.udid_no is not null));
  return new;
end $$;
revoke execute on function public.audit_beneficiary() from public, anon, authenticated;
drop trigger if exists beneficiaries_audit on public.beneficiaries;
create trigger beneficiaries_audit after insert on public.beneficiaries
  for each row execute function public.audit_beneficiary();

-- Admin-only feed (newest first). Names come from the staff profile, falling back to the login email.
create or replace function public.admin_activity(p_limit int default 200, p_before timestamptz default null)
returns table (id bigint, at timestamptz, staff_name text, action text, reg_no text, subject_name text, detail jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_admin()) then raise exception 'admins only'; end if;
  return query
    select a.id, a.at, coalesce(nullif(sp.full_name, ''), u.email::text, 'Unknown'), a.action, a.reg_no, a.subject_name, a.detail
    from public.audit_log a
    left join public.staff_profiles sp on sp.user_id = a.actor
    left join auth.users u on u.id = a.actor
    where p_before is null or a.at < p_before
    order by a.at desc
    limit least(greatest(p_limit, 1), 500);
end $$;
revoke execute on function public.admin_activity(int, timestamptz) from public, anon;
grant execute on function public.admin_activity(int, timestamptz) to authenticated;

-- Every login account with its name and role (admin only). Accounts without a profile row show as role "staff".
create or replace function public.admin_list_staff()
returns table (user_id uuid, email text, full_name text, role text, active boolean, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_admin()) then raise exception 'admins only'; end if;
  return query
    select u.id, u.email::text, sp.full_name, coalesce(sp.role, 'staff'),
           (u.banned_until is null or u.banned_until < now()), u.created_at, u.last_sign_in_at
    from auth.users u
    left join public.staff_profiles sp on sp.user_id = u.id
    order by (coalesce(sp.role, 'staff') = 'admin') desc, u.created_at;
end $$;
revoke execute on function public.admin_list_staff() from public, anon;
grant execute on function public.admin_list_staff() to authenticated;

-- Each staff member's OWN confirmed actions (what the server has accepted from their login). Powers the "Done" list on
-- the Sync screen, so it is right even after switching phones. Returns only the caller's rows; nobody else's.
create or replace function public.my_activity(p_limit int default 50)
returns table (id bigint, at timestamptz, action text, reg_no text, subject_name text, detail jsonb)
language sql stable security definer set search_path = '' as $$
  select a.id, a.at, a.action, a.reg_no, a.subject_name, a.detail
  from public.audit_log a
  where a.actor = (select auth.uid())
  order by a.at desc
  limit least(greatest(p_limit, 1), 200);
$$;
revoke execute on function public.my_activity(int) from public, anon;
grant execute on function public.my_activity(int) to authenticated;

-- ============================================================================
-- 4. Profile photo, mapped to the person it was taken for (registration AND distribution/attendance)
-- ============================================================================
-- A path inside the private 'documents' bucket. For the camp list it is always profile/<roster id>/<uuid>.jpg, and the
-- function below refuses any path that does not start with THAT person's id, so a photo cannot be attached to someone else.
alter table public.camp_roster add column if not exists profile_photo_path text;
alter table public.beneficiaries add column if not exists profile_photo_path text;
-- A small portrait thumbnail (base64 JPEG, about 12 KB) so EVERY phone can show the person's picture at the distribution desk,
-- online or offline. The full-quality photo stays in the private bucket for admins.
alter table public.camp_roster add column if not exists profile_thumb text;
alter table public.beneficiaries add column if not exists profile_thumb text;

drop function if exists public.set_profile_photo(uuid, text);
create or replace function public.set_profile_photo(p_roster_id uuid, p_path text, p_thumb text default null)
returns public.camp_roster
language plpgsql security definer set search_path = '' as $$
declare r public.camp_roster; old_path text;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  if p_path is null or p_path !~ ('^profile/' || p_roster_id::text || '/[0-9a-f-]{36}\.jpg$') then
    raise exception 'photo path does not belong to this person';
  end if;
  if p_thumb is not null and (length(p_thumb) > 60000 or p_thumb !~ '^[A-Za-z0-9+/=]+$') then raise exception 'invalid thumbnail'; end if;
  select profile_photo_path into old_path from public.camp_roster where id = p_roster_id for update;
  if not found then raise exception 'beneficiary not found'; end if;
  update public.camp_roster set profile_photo_path = p_path, profile_thumb = coalesce(p_thumb, profile_thumb) where id = p_roster_id returning * into r;
  if old_path is distinct from p_path then
    insert into public.audit_log (actor, action, entity, entity_id, reg_no, detail)
    values ((select auth.uid()), 'profile_photo_added', 'camp_roster', r.id, r.reg_no, jsonb_build_object('replaced', old_path is not null));
  end if;
  return r;
end $$;
revoke execute on function public.set_profile_photo(uuid, text, text) from public, anon;
grant execute on function public.set_profile_photo(uuid, text, text) to authenticated;

-- Carry a camp-registered person's profile photo over when they are given a Reg. No. and join the camp list.
create or replace function public.promote_registration(p_beneficiary_id uuid, p_reg_no text, p_appliances jsonb)
returns public.camp_roster
language plpgsql security definer set search_path = '' as $$
declare b public.beneficiaries; r public.camp_roster;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_reg_no), '') = '' then raise exception 'Reg. No. required'; end if;
  if jsonb_typeof(p_appliances) is distinct from 'array' then raise exception 'appliances must be a list'; end if;
  select * into b from public.beneficiaries where id = p_beneficiary_id;
  if not found then raise exception 'beneficiary not found'; end if;
  select * into r from public.camp_roster where registered_beneficiary_id = p_beneficiary_id;
  if found then return r; end if;                      -- repeat-safe
  if exists (select 1 from public.camp_roster where reg_no = trim(p_reg_no)) then
    raise exception 'Reg. No. % is already in use', trim(p_reg_no);
  end if;
  insert into public.camp_roster (reg_no, name, aadhaar_no, dob, yob, profile_photo_path, profile_thumb, appliances, registered_beneficiary_id, review_note)
  values (trim(p_reg_no), b.name, b.aadhaar_no, b.dob, b.yob, b.profile_photo_path, b.profile_thumb, p_appliances, b.id, 'Registered at camp; Reg. No. assigned by hand')
  returning * into r;
  insert into public.audit_log (actor, action, entity, entity_id, reg_no)
  values ((select auth.uid()), 'reg_no_assigned', 'camp_roster', r.id, r.reg_no);
  return r;
end $$;
revoke execute on function public.promote_registration(uuid, text, jsonb) from public, anon;
grant execute on function public.promote_registration(uuid, text, jsonb) to authenticated;

-- Check: should list the six functions
select proname from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('link_aadhaar', 'mark_attendance', 'admin_activity', 'admin_list_staff', 'my_activity', 'set_profile_photo') order by 1;
