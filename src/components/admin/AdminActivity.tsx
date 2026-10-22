"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

interface Entry {
  id: number;
  at: string;
  staff_name: string;
  action: string;
  reg_no: string | null;
  subject_name: string | null;
  detail: { aadhaar?: boolean; dob?: boolean; udid?: boolean } | null;
}

const PAGE = 100;

/** What was saved, in the words an admin would use. */
function what(e: Entry): { label: string; tone: string } {
  const d = e.detail ?? {};
  switch (e.action) {
    case "attendance_marked": return { label: "Attendance", tone: "bg-info-bg text-info-fg" };
    case "distribution_completed": return { label: "Handover photo", tone: "bg-ok-bg text-ok-fg" };
    case "registered": return { label: `New member${d.aadhaar ? " + Aadhaar" : ""}${d.udid ? " + UDID" : ""}`, tone: "bg-teal-50 text-teal-800" };
    case "details_added": return { label: `Details added${d.aadhaar ? " (Aadhaar" : ""}${d.dob ? `${d.aadhaar ? " + " : " ("}DOB` : ""}${d.aadhaar || d.dob ? ")" : ""}`, tone: "bg-warn-bg text-warn-fg" };
    case "reg_no_assigned": return { label: "Reg. No. assigned", tone: "bg-sage-100 text-ink-soft" };
    default: return { label: e.action.replace(/_/g, " "), tone: "bg-sage-100 text-ink-soft" };
  }
}

/** Admin-only activity log: which staff member did what for which beneficiary. */
export function AdminActivity() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback((before?: string) => {
    createClient().rpc("admin_activity", { p_limit: PAGE, ...(before ? { p_before: before } : {}) }).then(({ data, error }) => {
      if (error) {
        setErr(error.code === "PGRST202" ? "Run supabase/sql/3_staff_attendance_activity.sql in Supabase to turn the log on." : "Could not load the log. Check your connection.");
        return;
      }
      setErr(null);
      const got = (data ?? []) as Entry[];
      setMore(got.length === PAGE);
      setRows((prev) => (before && prev ? [...prev, ...got] : got));
    }, () => setErr("Could not load the log. Check your connection."));
  }, []);
  useEffect(() => { load(); }, [load]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => (rows ?? []).filter((e) => !needle || e.staff_name.toLowerCase().includes(needle) || (e.subject_name ?? "").toLowerCase().includes(needle) || (e.reg_no ?? "").startsWith(needle)),
    [rows, needle],
  );

  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search staff name, beneficiary or Reg. No."
        aria-label="Search the activity log"
        className="h-12 w-full rounded-xl border border-line bg-white px-4"
      />
      {err && <p role="alert" className="rounded-2xl bg-bad-bg px-4 py-3 text-sm font-semibold text-bad-fg">{err}</p>}
      {rows === null && !err && <p className="text-ink-muted">Loading...</p>}
      {rows && shown.length === 0 && <p className="py-6 text-center text-ink-muted">{rows.length === 0 ? "Nothing recorded yet. Entries appear once staff actions reach the server." : "Nothing matches."}</p>}
      {shown.map((e) => {
        const w = what(e);
        return (
          <Card key={e.id} className="space-y-1 !p-3">
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${w.tone}`}>{w.label}</span>
              <span className="text-xs text-ink-muted">{new Date(e.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
            </div>
            <p className="font-bold text-ink">
              {e.subject_name ?? "Unknown beneficiary"}
              {e.reg_no ? <span className="font-semibold text-ink-muted"> · Reg. No. {e.reg_no}</span> : null}
            </p>
            <p className="text-sm text-ink-muted">by {e.staff_name}</p>
          </Card>
        );
      })}
      {more && rows && <Button variant="secondary" full onClick={() => load(rows[rows.length - 1].at)}>Load older</Button>}
    </div>
  );
}
