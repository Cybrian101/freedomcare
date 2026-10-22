-- Run in the Supabase SQL Editor AFTER RUN_IN_SQL_EDITOR.sql. Read-only / rolled back.

-- A. Seed counts. Expected: total 461 | with_reg 456 | no_reg 5 | with_aadhaar 442 | no_aadhaar 19
--    appliance_lines 632 | with_review_note 31 | batch1 328 | batch2 46 | batch3 87
select count(*) total, count(reg_no) with_reg, count(*) - count(reg_no) no_reg,
       count(aadhaar_no) with_aadhaar, count(*) - count(aadhaar_no) no_aadhaar,
       (select sum(jsonb_array_length(appliances)) from public.camp_roster) appliance_lines,
       count(review_note) with_review_note,
       count(*) filter (where batch = 1) batch1, count(*) filter (where batch = 2) batch2,
       count(*) filter (where batch = 3) batch3
from public.camp_roster;

-- B. Duplicate checks. All three must return zero rows.
select reg_no, count(*) from public.camp_roster where reg_no is not null group by 1 having count(*) > 1;
select aadhaar_no, count(*) from public.camp_roster where aadhaar_no is not null group by 1 having count(*) > 1;
select batch, serial_no, count(*) from public.camp_roster group by 1, 2 having count(*) > 1;

-- C. Rows staff must fix by hand (expect 5 with no reg_no) and review notes by kind
-- (expected: 16 'No Aadhaar' , 11 'fails checksum', 5 'No Reg. No.', 3 'Invalid Aadhaar', 1 'continuation row'; a row may have several)
select batch, serial_no, name, review_note from public.camp_roster where reg_no is null order by 1, 2;
select review_note, count(*) from public.camp_roster where review_note is not null group by 1 order by 2 desc;

-- D. Workflow columns untouched after seed. Expect 0, 0
select count(*) filter (where attended_at is not null) attended, count(*) filter (where distributed_at is not null) distributed
from public.camp_roster;

-- E. beneficiaries cleaned up by migration 2. Expect 0 rows (columns reg_no, appliances, attended_at... must be gone)
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'beneficiaries'
  and column_name in ('reg_no','appliances','attended_at','attended_by','distributed_at','distributed_by','photo_path','submission_id','serial_no','batch','review_note');

-- F. Grants / RLS. Expect: rls true; anon has no table privileges (0 rows); functions executable only by authenticated/service_role
select relname, relrowsecurity from pg_class where oid = 'public.camp_roster'::regclass;
select grantee, privilege_type from information_schema.role_table_grants where table_name = 'camp_roster' and grantee in ('anon','authenticated');
select grantee, column_name from information_schema.column_privileges
where table_name = 'camp_roster' and grantee = 'authenticated' and privilege_type = 'UPDATE' order by 2;
select p.proname, p.proacl::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('mark_attendance','complete_distribution');

-- G. RPC behaviour, as an authenticated staff user. Everything is rolled back. Each DO block raises on failure;
--    "Success. No rows returned" means the assertions passed.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users limit 1), 'role', 'authenticated')::text, true);
  do $$
  declare r public.camp_roster; r2 public.camp_roster; v_id uuid; v_sub uuid := gen_random_uuid(); err text;
  begin
    select id into v_id from public.camp_roster where reg_no = '488';
    if v_id is null then raise exception 'seed row 488 missing'; end if;

    -- mark_attendance is idempotent: second call keeps the first timestamp
    r  := public.mark_attendance(v_id);
    perform pg_sleep(0.05);
    r2 := public.mark_attendance(v_id);
    if r.attended_at is null then raise exception 'attendance not set'; end if;
    if r2.attended_at <> r.attended_at then raise exception 'mark_attendance not idempotent'; end if;

    -- complete_distribution refuses without a photo (null and empty string)
    begin perform public.complete_distribution(v_id, null, v_sub); raise exception 'FAIL: accepted null photo';
    exception when others then get stacked diagnostics err = message_text; if err <> 'photo required' then raise; end if; end;
    begin perform public.complete_distribution(v_id, '', v_sub); raise exception 'FAIL: accepted empty photo';
    exception when others then get stacked diagnostics err = message_text; if err <> 'photo required' then raise; end if; end;
    if (select distributed_at from public.camp_roster where id = v_id) is not null then raise exception 'distributed without photo'; end if;

    -- success with a photo, then idempotent retry (same or different payload returns the original record)
    r  := public.complete_distribution(v_id, '488/handover.jpg', v_sub);
    r2 := public.complete_distribution(v_id, 'other/path.jpg', gen_random_uuid());
    if r.distributed_at is null or r.photo_path <> '488/handover.jpg' then raise exception 'completion not recorded'; end if;
    if r2.distributed_at <> r.distributed_at or r2.photo_path <> r.photo_path or r2.submission_id <> v_sub then
      raise exception 'complete_distribution not idempotent'; end if;

    -- unknown id
    begin perform public.complete_distribution(gen_random_uuid(), 'x.jpg', gen_random_uuid()); raise exception 'FAIL: unknown id accepted';
    exception when others then get stacked diagnostics err = message_text; if err <> 'beneficiary not found' then raise; end if; end;

    -- identity columns are not writable by staff (column-level grant)
    begin update public.camp_roster set name = 'x' where id = v_id; raise exception 'FAIL: name updatable';
    exception when insufficient_privilege then null; end;

    -- a second row can be distributed only with its own photo, and the DB constraint also blocks photo-less updates
    begin update public.camp_roster set distributed_at = now() where reg_no = '566'; raise exception 'FAIL: photo-less distribution';
    exception when check_violation then null; end;
  end $$;
rollback;

-- H. anon must be locked out. Expect 'permission denied' errors / zero rows; rolled back.
begin;
  set local role anon;
  select count(*) as anon_visible_rows from public.camp_roster;  -- error "permission denied" is the pass
rollback;
