import type { SupabaseClient } from "@supabase/supabase-js";

export interface AadhaarCheck {
  roster: { id: string; reg_no: string | null; name: string } | null;
  registered: { id: string; name: string } | null;
}

/**
 * Is this Aadhaar already known? Uses the server function public.check_aadhaar so the app never has to read Aadhaar
 * columns. If that function has not been installed yet (error PGRST202), fall back to the old direct reads so the
 * app keeps working during the rollout. Any other error is thrown: callers must treat it as "could not check",
 * never as "not found".
 */
export async function checkAadhaar(sb: SupabaseClient, digits: string): Promise<AadhaarCheck> {
  const { data, error } = await sb.rpc("check_aadhaar", { p_aadhaar: digits });
  if (!error) return (data as AadhaarCheck) ?? { roster: null, registered: null };
  if (error.code !== "PGRST202") throw new Error("lookup failed");

  const [r, b] = await Promise.all([
    sb.from("camp_roster").select("id,reg_no,name").eq("aadhaar_no", digits).maybeSingle(),
    sb.from("beneficiaries").select("id,name").eq("aadhaar_no", digits).maybeSingle(),
  ]);
  if (r.error || b.error) throw new Error("lookup failed");
  return { roster: r.data ?? null, registered: b.data ?? null };
}
