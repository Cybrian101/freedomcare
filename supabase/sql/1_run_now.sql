-- FreedomCare: STEP 1 of 2. Run this first, in the Supabase SQL editor.
-- ADDITIVE ONLY: creates new tables/functions/policies and one new nullable column. Drops nothing, changes no data,
-- and changes nobody's current access. Safe to run twice (everything is "if not exists" / "create or replace").

-- ============================================================================
-- 1. Roles
-- ============================================================================
create table if not exists public.staff_profiles (
  user_id    uuid primary key references auth.users on delete cascade,
  role       text not null check (role in ('admin', 'registration', 'distribution', 'viewer')),
  created_at timestamptz not null default now()
);
alter table public.staff_profiles enable row level security;
drop policy if exists "own profile" on public.staff_profiles;
create policy "own profile" on public.staff_profiles for select to authenticated using (user_id = (select auth.uid()));
-- no insert/update policy: roles are changed only here in the SQL editor (service role).

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_profiles p where p.user_id = (select auth.uid()) and p.role = 'admin');
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.staff_profiles p where p.user_id = (select auth.uid());
$$;

-- ============================================================================
-- 2. Make the ADMIN account (CHANGE the email below to the login that should see everything; safe to re-run)
-- ============================================================================
insert into public.staff_profiles (user_id, role)
select id, 'admin' from auth.users where lower(email) = lower('your-admin-login@example.com')
on conflict (user_id) do update set role = 'admin';

-- ============================================================================
-- 3. Audit history (ids and Reg. No. only; never Aadhaar, names or addresses)
-- ============================================================================
create table if not exists public.audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor     uuid,
  action    text not null,
  entity    text not null,
  entity_id uuid,
  reg_no    text,
  detail    jsonb not null default '{}'
);
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;
drop policy if exists "admins read audit" on public.audit_log;
create policy "admins read audit" on public.audit_log for select to authenticated using ((select public.is_admin()));

create or replace function public.audit_roster() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.attended_at is null and new.attended_at is not null then
    insert into public.audit_log (actor, action, entity, entity_id, reg_no)
    values ((select auth.uid()), 'attendance_marked', 'camp_roster', new.id, new.reg_no);
  end if;
  if old.distributed_at is null and new.distributed_at is not null then
    insert into public.audit_log (actor, action, entity, entity_id, reg_no, detail)
    values ((select auth.uid()), 'distribution_completed', 'camp_roster', new.id, new.reg_no,
            jsonb_build_object('submission_id', new.submission_id));
  end if;
  return new;
end $$;
revoke execute on function public.audit_roster() from public, anon, authenticated;

drop trigger if exists camp_roster_audit on public.camp_roster;
create trigger camp_roster_audit after update on public.camp_roster
  for each row execute function public.audit_roster();

-- ============================================================================
-- 4. Aadhaar check without reading the tables (the app calls this instead of selecting Aadhaar columns)
-- ============================================================================
create or replace function public.check_aadhaar(p_aadhaar text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record; b record;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  if p_aadhaar !~ '^[2-9][0-9]{11}$' then raise exception 'invalid aadhaar format'; end if;
  select id, reg_no, name into r from public.camp_roster where aadhaar_no = p_aadhaar;
  select id, name into b from public.beneficiaries where aadhaar_no = p_aadhaar;
  return jsonb_build_object(
    'roster',     case when r.id is null then null else jsonb_build_object('id', r.id, 'reg_no', r.reg_no, 'name', r.name) end,
    'registered', case when b.id is null then null else jsonb_build_object('id', b.id, 'name', b.name) end
  );
end $$;
revoke execute on function public.check_aadhaar(text) from public, anon;
grant execute on function public.check_aadhaar(text) to authenticated;

-- ============================================================================
-- 5. Add a camp-registered person to the camp list under a Reg. No. typed BY HAND
-- ============================================================================
alter table public.camp_roster
  add column if not exists registered_beneficiary_id uuid unique references public.beneficiaries (id);

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
  insert into public.camp_roster (reg_no, name, aadhaar_no, appliances, registered_beneficiary_id, review_note)
  values (trim(p_reg_no), b.name, b.aadhaar_no, p_appliances, b.id, 'Registered at camp; Reg. No. assigned by hand')
  returning * into r;
  insert into public.audit_log (actor, action, entity, entity_id, reg_no)
  values ((select auth.uid()), 'reg_no_assigned', 'camp_roster', r.id, r.reg_no);
  return r;
end $$;
revoke execute on function public.promote_registration(uuid, text, jsonb) from public, anon;
grant execute on function public.promote_registration(uuid, text, jsonb) to authenticated;

-- People registered at the camp who do not have a Reg. No. yet. Staff get ONLY these few fields through this
-- function; they do not need (and after STEP 2 will not have) read access to the registrations table itself.
create or replace function public.unassigned_registrations()
returns table (id uuid, name text, created_at timestamptz, disability_type text, phone text)
language sql stable security definer set search_path = '' as $$
  select b.id, b.name, b.created_at, b.disability_type, b.phone
  from public.beneficiaries b
  where (select auth.uid()) is not null
    and not exists (select 1 from public.camp_roster r where r.registered_beneficiary_id = b.id)
  order by b.created_at;
$$;
revoke execute on function public.unassigned_registrations() from public, anon;
grant execute on function public.unassigned_registrations() to authenticated;

-- ============================================================================
-- 6. Admin full-list access (adds policies only; staff access is unchanged until STEP 2)
-- ============================================================================
drop policy if exists "admin read beneficiaries" on public.beneficiaries;
create policy "admin read beneficiaries" on public.beneficiaries for select to authenticated using ((select public.is_admin()));
drop policy if exists "admin read files" on storage.objects;
create policy "admin read files" on storage.objects for select to authenticated
  using (bucket_id in ('handover-photos', 'documents') and (select public.is_admin()));

-- Check: should return your row with role = admin
select u.email, p.role from public.staff_profiles p join auth.users u on u.id = p.user_id;
