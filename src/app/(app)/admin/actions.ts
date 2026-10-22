"use server";
// Staff management. These run on the server with the Supabase service-role key, which can create and ban logins, so
// every action first proves the CALLER is an admin (public.is_admin(), checked with the caller's own session).
// The key is read from SUPABASE_SERVICE_ROLE_KEY (never NEXT_PUBLIC_) and is never sent to the browser.
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type StaffResult = { ok: boolean; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FOREVER = "876000h"; // about 100 years: Supabase has no "disabled" flag, a very long ban is how a login is switched off

async function callerIsAdmin(): Promise<{ id: string } | null> {
  const sb = await createClient();
  const { data } = await sb.auth.getUser(); // asks the auth server, so a forged cookie is not enough
  if (!data.user) return null;
  const { data: isAdmin, error } = await sb.rpc("is_admin");
  return !error && isAdmin === true ? { id: data.user.id } : null;
}

function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const NOT_ADMIN: StaffResult = { ok: false, message: "Only an administrator can do this." };
const NO_KEY: StaffResult = {
  ok: false,
  message: "SUPABASE_SERVICE_ROLE_KEY is not set on the server. Add it in Vercel (Environment Variables) and redeploy.",
};

export async function createStaff(_prev: StaffResult | null, formData: FormData): Promise<StaffResult> {
  if (!(await callerIsAdmin())) return NOT_ADMIN;
  const svc = service();
  if (!svc) return NO_KEY;

  const fullName = String(formData.get("full_name") ?? "").trim().replace(/\s+/g, " ");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (fullName.length < 2 || fullName.length > 60) return { ok: false, message: "Enter the staff member's name (2 to 60 letters)." };
  if (!EMAIL_RE.test(email)) return { ok: false, message: "Enter a valid email address." };
  if (password.length < 8) return { ok: false, message: "The password needs at least 8 characters." };

  const { data, error } = await svc.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (error || !data.user) {
    return { ok: false, message: /already|registered|exists/i.test(error?.message ?? "") ? "That email already has a login." : "Could not create the login. Try again." };
  }

  const { error: profileErr } = await svc
    .from("staff_profiles")
    .upsert({ user_id: data.user.id, role: "staff", full_name: fullName }, { onConflict: "user_id" });
  if (profileErr) {
    await svc.auth.admin.deleteUser(data.user.id); // do not leave a login without a name/role behind
    return { ok: false, message: "Could not save the staff profile. Run supabase/sql/3_staff_attendance_activity.sql in Supabase, then try again." };
  }
  return { ok: true, message: `${fullName} can now sign in with ${email}.` };
}

export async function setStaffActive(userId: string, active: boolean): Promise<StaffResult> {
  const admin = await callerIsAdmin();
  if (!admin) return NOT_ADMIN;
  if (admin.id === userId) return { ok: false, message: "You cannot switch off your own login." };
  const svc = service();
  if (!svc) return NO_KEY;
  const { error } = await svc.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : FOREVER });
  if (error) return { ok: false, message: "Could not change this login. Try again." };
  return { ok: true, message: active ? "Login switched back on." : "Login switched off. They can no longer sign in." };
}

export async function resetStaffPassword(userId: string, password: string): Promise<StaffResult> {
  if (!(await callerIsAdmin())) return NOT_ADMIN;
  if (password.length < 8) return { ok: false, message: "The password needs at least 8 characters." };
  const svc = service();
  if (!svc) return NO_KEY;
  const { error } = await svc.auth.admin.updateUserById(userId, { password });
  if (error) return { ok: false, message: "Could not change the password. Try again." };
  return { ok: true, message: "Password changed. Tell the staff member the new password." };
}
