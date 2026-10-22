"use client";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { createStaff, resetStaffPassword, setStaffActive, type StaffResult } from "@/app/(app)/admin/actions";

interface StaffRow {
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

const INPUT = "mt-1.5 h-12 w-full rounded-2xl border border-line bg-white px-4 text-base text-ink focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100";

/** Admin: see everyone who can sign in, add staff (name, email, password), switch a login off or reset a password. */
export function AdminStaff() {
  const toast = useToast();
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const form = useRef<HTMLFormElement>(null);

  const load = useCallback(() => {
    createClient().rpc("admin_list_staff").then(({ data, error }) => {
      if (error) {
        setErr(error.code === "PGRST202" ? "Run supabase/sql/3_staff_attendance_activity.sql in Supabase to turn this page on." : "Could not load staff. Check your connection.");
        return;
      }
      setErr(null);
      setRows((data ?? []) as StaffRow[]);
    }, () => setErr("Could not load staff. Check your connection."));
  }, []);
  useEffect(() => { load(); }, [load]);

  const [state, add, adding] = useActionState<StaffResult | null, FormData>(async (prev, fd) => {
    const r = await createStaff(prev, fd);
    if (r.ok) { form.current?.reset(); load(); }
    return r;
  }, null);

  async function toggle(r: StaffRow) {
    const res = await setStaffActive(r.user_id, !r.active);
    toast(res.message, res.ok ? "ok" : "bad");
    if (res.ok) load();
  }
  async function reset(r: StaffRow) {
    const res = await resetStaffPassword(r.user_id, pw);
    toast(res.message, res.ok ? "ok" : "bad");
    if (res.ok) { setResetFor(null); setPw(""); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <form ref={form} action={add} className="space-y-3" autoComplete="off">
          <h2 className="text-lg font-bold text-ink">Add a staff member</h2>
          <p className="text-sm text-ink-muted">Only people you add here can sign in. They can scan, register, mark attendance and distribute. Only admins see this page and the activity log.</p>
          <label className="block text-sm font-semibold text-ink-soft">Name
            <input name="full_name" required minLength={2} maxLength={60} className={INPUT} />
          </label>
          <label className="block text-sm font-semibold text-ink-soft">Email (their login)
            <input name="email" type="email" required autoCapitalize="none" className={INPUT} />
          </label>
          <label className="block text-sm font-semibold text-ink-soft">Password (at least 8 characters)
            <input name="password" type="text" required minLength={8} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={INPUT} />
          </label>
          <Button type="submit" full loading={adding}>Create login</Button>
          {state && (
            <p role="status" className={`rounded-2xl px-4 py-3 text-sm font-semibold ${state.ok ? "bg-ok-bg text-ok-fg" : "bg-bad-bg text-bad-fg"}`}>{state.message}</p>
          )}
        </form>
      </Card>

      {err && <p role="alert" className="rounded-2xl bg-bad-bg px-4 py-3 text-sm font-semibold text-bad-fg">{err}</p>}
      {rows === null && !err && <p className="text-ink-muted">Loading...</p>}
      {rows?.map((r) => (
        <Card key={r.user_id} className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-ink">{r.full_name || r.email}</p>
              <p className="truncate text-sm text-ink-muted">{r.full_name ? `${r.email} · ` : ""}{r.role === "admin" ? "Admin" : "Staff"}</p>
              <p className="text-xs text-ink-muted">
                {r.last_sign_in_at ? `Last signed in ${new Date(r.last_sign_in_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : "Has not signed in yet"}
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${r.active ? "bg-ok-bg text-ok-fg" : "bg-bad-bg text-bad-fg"}`}>{r.active ? "Active" : "Switched off"}</span>
          </div>
          {r.role !== "admin" && (
            <div className="flex flex-wrap gap-2">
              <Button variant={r.active ? "danger" : "secondary"} onClick={() => void toggle(r)}>{r.active ? "Switch off login" : "Switch on login"}</Button>
              <Button variant="secondary" onClick={() => { setResetFor(resetFor === r.user_id ? null : r.user_id); setPw(""); }}>Reset password</Button>
            </div>
          )}
          {resetFor === r.user_id && (
            <div className="flex gap-2">
              <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (8+ characters)" autoCapitalize="none" autoComplete="off" className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-white px-4" />
              <Button disabled={pw.length < 8} onClick={() => void reset(r)}>Save</Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
