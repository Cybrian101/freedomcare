import type { SupabaseClient } from "@supabase/supabase-js";
import type { Appliance, RosterRow } from "./types";

const T = "camp_roster";

/** Wheelchair-type aids (Wheel chair, Commode / Hi-back wheel chair, CP chair): the only ones handed over as a group. */
export const isWheelchair = (appliances: Appliance[]) => appliances.some((a) => /wheel\s*chair|cp\s*chair/i.test(a.name));

function must<R>(r: { data: R; error: { message: string } | null }): R {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export async function findByAadhaar(supabase: SupabaseClient, aadhaar: string): Promise<RosterRow | null> {
  const d = aadhaar.replace(/\D/g, "");
  return must(await supabase.from(T).select("*").eq("aadhaar_no", d).maybeSingle<RosterRow>());
}

export async function findByRegNo(supabase: SupabaseClient, reg: string): Promise<RosterRow | null> {
  return must(await supabase.from(T).select("*").eq("reg_no", reg.trim()).maybeSingle<RosterRow>());
}

export async function getById(supabase: SupabaseClient, id: string): Promise<RosterRow | null> {
  return must(await supabase.from(T).select("*").eq("id", id).maybeSingle<RosterRow>());
}

/** Reg. No. exact/prefix, name ilike, or 12-digit Aadhaar. Exact Reg. No. match sorts first. */
export async function searchRoster(supabase: SupabaseClient, q: string, limit = 25): Promise<RosterRow[]> {
  const s = q.trim().replace(/[%,()*]/g, " ").trim();
  if (!s) return [];
  const digits = s.replace(/\D/g, "");
  const parts = [`name.ilike.%${s}%`, `reg_no.ilike.${s}%`];
  if (digits.length === 12) parts.push(`aadhaar_no.eq.${digits}`);
  const rows = must(
    await supabase
      .from(T)
      .select("*")
      .or(parts.join(","))
      .order("serial_no", { nullsFirst: false })
      .limit(limit)
      .returns<RosterRow[]>(),
  );
  return (rows ?? []).sort((a, b) => Number(b.reg_no === s) - Number(a.reg_no === s));
}

/** Idempotent: sets attended_at only the first time. */
export async function markAttendance(supabase: SupabaseClient, id: string, dob?: string | null): Promise<RosterRow> {
  // p_dob is sent only when we have one, so this keeps working against a database that predates the DOB column.
  const args = dob ? { p_id: id, p_dob: dob } : { p_id: id };
  return must(await supabase.rpc("mark_attendance", args).single<RosterRow>())!;
}

/** Add an Aadhaar (and DOB) to a person who is already on the camp list without one. Repeat-safe. */
export async function linkAadhaar(
  supabase: SupabaseClient,
  id: string,
  aadhaar: string,
  dob: string | null,
  yob: number | null,
): Promise<RosterRow> {
  return must(
    await supabase.rpc("link_aadhaar", { p_roster_id: id, p_aadhaar: aadhaar, p_dob: dob, p_yob: yob }).single<RosterRow>(),
  )!;
}

/** Requires a photo path; retrying (same or other device) returns the existing record. */
export async function completeDistribution(
  supabase: SupabaseClient,
  id: string,
  photoPath: string,
  submissionId: string,
): Promise<RosterRow> {
  return must(
    await supabase
      .rpc("complete_distribution", { p_id: id, p_photo_path: photoPath, p_submission_id: submissionId })
      .single<RosterRow>(),
  )!;
}

/** Attach an already-uploaded profile photo (path profile/<id>/<uuid>.jpg) to this person. Repeat-safe. */
export async function setProfilePhoto(supabase: SupabaseClient, id: string, path: string, thumb?: string): Promise<RosterRow> {
  const r = await supabase.rpc("set_profile_photo", { p_roster_id: id, p_path: path, ...(thumb ? { p_thumb: thumb } : {}) }).single<RosterRow>();
  // an older database function without the thumbnail argument: attach the photo without it rather than fail
  if (r.error && thumb && /PGRST202|could not find the function/i.test(`${r.error.code ?? ""} ${r.error.message}`)) {
    return must(await supabase.rpc("set_profile_photo", { p_roster_id: id, p_path: path }).single<RosterRow>())!;
  }
  return must(r)!;
}

export interface RosterCounts {
  total: number;
  attended: number;
  distributed: number;
  pending: number; // attended, not yet distributed
}

export async function rosterCounts(supabase: SupabaseClient): Promise<RosterCounts> {
  const base = () => supabase.from(T).select("id", { count: "exact", head: true });
  const [t, a, d] = await Promise.all([
    base(),
    base().not("attended_at", "is", null),
    base().not("distributed_at", "is", null),
  ]);
  for (const r of [t, a, d]) if (r.error) throw new Error(r.error.message);
  const total = t.count ?? 0;
  const attended = a.count ?? 0;
  const distributed = d.count ?? 0;
  return { total, attended, distributed, pending: Math.max(attended - distributed, 0) };
}
