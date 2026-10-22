-- FreedomCare: one table for the whole camp. Reg. No. is the token.
create table public.beneficiaries (
  id              uuid primary key default gen_random_uuid(),
  reg_no          text unique,                       -- token number; null only for rows needing manual assignment
  serial_no       int,
  batch           smallint,
  name            text not null,
  appliances      jsonb not null default '[]',       -- [{"name": "...", "side": "Lt|Rt|Bil|Uni|..."}]

  -- Aadhaar card fields
  aadhaar_no      text unique check (aadhaar_no ~ '^[2-9][0-9]{11}$'),
  aadhaar_name    text,
  gender          text,
  dob             date,
  yob             smallint,                          -- some Aadhaar cards print year only
  care_of         text,                              -- S/O, D/O, W/O, C/O
  address         text,
  pincode         text,
  district        text,
  state           text,
  vid             text,
  phone           text,
  email           text,

  -- UDID / disability document (card, enrolment acknowledgement, or other)
  udid_no         text,                              -- UDID number or enrolment/application no.
  udid_label      text,                              -- term printed on the document, e.g. "UD ID", "Enrolment No"
  disability_type text,
  disability_pct  smallint check (disability_pct between 0 and 100),

  -- camp workflow
  attended_at     timestamptz,
  attended_by     uuid references auth.users,
  distributed_at  timestamptz,
  distributed_by  uuid references auth.users,
  photo_path      text,                              -- handover photo in private bucket
  submission_id   uuid unique,                       -- idempotency key from the device

  source          text not null default 'excel' check (source in ('excel', 'registered')),
  review_note     text,                              -- data issues staff should verify
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint distributed_needs_photo check (distributed_at is null or photo_path is not null)
);

create index beneficiaries_name_idx on public.beneficiaries (lower(name));
create index beneficiaries_udid_idx on public.beneficiaries (udid_no) where udid_no is not null;

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger beneficiaries_touch before update on public.beneficiaries
  for each row execute function public.touch_updated_at();

-- Staff = any signed-in user (accounts are created by the trust in Supabase Auth; sign-ups disabled).
alter table public.beneficiaries enable row level security;
create policy "staff read"   on public.beneficiaries for select to authenticated using (true);
create policy "staff insert" on public.beneficiaries for insert to authenticated with check (source = 'registered');
create policy "staff update" on public.beneficiaries for update to authenticated using (true) with check (true);

-- Attendance: idempotent.
create function public.mark_attendance(p_id uuid) returns public.beneficiaries
language sql security invoker as $$
  update public.beneficiaries
     set attended_at = coalesce(attended_at, now()), attended_by = coalesce(attended_by, auth.uid())
   where id = p_id returning *;
$$;

-- Completion: only succeeds with a photo; retrying the same submission is a no-op.
create function public.complete_distribution(p_id uuid, p_photo_path text, p_submission_id uuid)
returns public.beneficiaries language plpgsql security invoker as $$
declare b public.beneficiaries;
begin
  select * into b from public.beneficiaries where id = p_id for update;
  if not found then raise exception 'beneficiary not found'; end if;
  if b.distributed_at is not null then return b; end if;   -- already done (retry or second device)
  if coalesce(p_photo_path, '') = '' then raise exception 'photo required'; end if;
  update public.beneficiaries
     set distributed_at = now(), distributed_by = auth.uid(), photo_path = p_photo_path,
         submission_id = p_submission_id, attended_at = coalesce(attended_at, now()),
         attended_by = coalesce(attended_by, auth.uid())
   where id = p_id returning * into b;
  return b;
end $$;

-- Private storage: handover photos and scanned documents.
insert into storage.buckets (id, name, public) values ('handover-photos', 'handover-photos', false),
                                                      ('documents', 'documents', false)
on conflict (id) do nothing;
create policy "staff read files"   on storage.objects for select to authenticated using (bucket_id in ('handover-photos','documents'));
create policy "staff upload files" on storage.objects for insert to authenticated with check (bucket_id in ('handover-photos','documents'));
