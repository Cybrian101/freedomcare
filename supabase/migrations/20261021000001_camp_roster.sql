-- Phase 2: camp_roster = the seeded Excel list + attendance + handover. Reg. No. is the token.
-- beneficiaries (phase 1) stays a clean table for Aadhaar/UDID scan registration only.

-- 1. Move workflow out of beneficiaries
drop function if exists public.mark_attendance(uuid);
drop function if exists public.complete_distribution(uuid, text, uuid);
alter table public.beneficiaries
  drop constraint if exists distributed_needs_photo,
  drop column if exists attended_at, drop column if exists attended_by,
  drop column if exists distributed_at, drop column if exists distributed_by,
  drop column if exists photo_path, drop column if exists submission_id,
  drop column if exists appliances, drop column if exists reg_no,
  drop column if exists serial_no, drop column if exists batch,
  drop column if exists review_note;
alter table public.beneficiaries alter column source set default 'registered';

-- 2. Camp roster
create table public.camp_roster (
  id              uuid primary key default gen_random_uuid(),
  reg_no          text unique,                        -- token; null only for rows needing manual assignment
  serial_no       int,
  batch           smallint,
  name            text not null,
  aadhaar_no      text unique check (aadhaar_no ~ '^[2-9][0-9]{11}$'),
  appliances      jsonb not null default '[]',        -- [{"name": "...", "side": "Lt|Rt|Bil|Uni|Adult|Child|null"}]
  review_note     text,                               -- Excel issues staff should verify

  attended_at     timestamptz,
  attended_by     uuid references auth.users,
  distributed_at  timestamptz,
  distributed_by  uuid references auth.users,
  photo_path      text,                               -- private bucket 'handover-photos'
  submission_id   uuid unique,                        -- idempotency key from the device

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint distributed_needs_photo check (distributed_at is null or photo_path is not null),
  constraint camp_roster_batch_serial_key unique (batch, serial_no)   -- natural key; makes the seed re-runnable (null reg_no rows)
);
create index camp_roster_name_idx on public.camp_roster (lower(name));
create index camp_roster_attended_by_idx on public.camp_roster (attended_by);
create index camp_roster_distributed_by_idx on public.camp_roster (distributed_by);
create trigger camp_roster_touch before update on public.camp_roster
  for each row execute function public.touch_updated_at();

alter table public.camp_roster enable row level security;
create policy "staff read"   on public.camp_roster for select to authenticated using (true);
create policy "staff update" on public.camp_roster for update to authenticated using (true) with check (true);
-- Staff may only touch workflow columns; identity columns (reg_no, name, aadhaar_no, appliances) are read-only from the app.
revoke all on public.camp_roster from anon;
revoke update on public.camp_roster from authenticated;
grant update (attended_at, attended_by, distributed_at, distributed_by, photo_path, submission_id)
  on public.camp_roster to authenticated;

-- 3. Attendance (idempotent)
create function public.mark_attendance(p_id uuid) returns public.camp_roster
language sql security invoker set search_path = '' as $$
  update public.camp_roster
     set attended_at = coalesce(attended_at, now()), attended_by = coalesce(attended_by, (select auth.uid()))
   where id = p_id returning *;
$$;

-- 4. Completion: needs a photo; a retry or second device returns the existing record.
create function public.complete_distribution(p_id uuid, p_photo_path text, p_submission_id uuid)
returns public.camp_roster language plpgsql security invoker set search_path = '' as $$
declare r public.camp_roster;
begin
  select * into r from public.camp_roster where id = p_id for update;
  if not found then raise exception 'beneficiary not found'; end if;
  if r.distributed_at is not null then return r; end if;
  if coalesce(p_photo_path, '') = '' then raise exception 'photo required'; end if;
  update public.camp_roster
     set distributed_at = now(), distributed_by = (select auth.uid()), photo_path = p_photo_path,
         submission_id = p_submission_id,
         attended_at = coalesce(attended_at, now()), attended_by = coalesce(attended_by, (select auth.uid()))
   where id = p_id returning * into r;
  return r;
end $$;
revoke execute on function public.mark_attendance(uuid) from public, anon;
revoke execute on function public.complete_distribution(uuid, text, uuid) from public, anon;
revoke execute on function public.touch_updated_at() from public, anon;
