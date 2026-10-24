"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, PageHeader, SectionTitle, SegmentedControl, Sheet } from "@/components/ui";
import { Photo, useSignedUrl } from "@/components/PhotoLink";
import { SignOutForm } from "@/components/SignOutForm";
import { signOut } from "@/app/(auth)/login/actions";
import { createClient } from "@/lib/supabase/client";
import type { Appliance } from "@/lib/types";

// Only the columns the dashboard shows. Aadhaar numbers are never fetched here.
const ROSTER_COLS = "id,reg_no,serial_no,batch,name,appliances,review_note,attended_at,attended_by,distributed_at,distributed_by,photo_path,profile_photo_path,dob,yob";
const REG_COLS = "id,name,gender,dob,yob,care_of,address,pincode,district,state,phone,udid_no,udid_label,disability_type,disability_pct,profile_photo_path,created_at";
const REFRESH_MS = 60_000;
const PAGE = 40;

interface Person {
  id: string; reg_no: string | null; serial_no: number | null; batch: number | null; name: string; appliances: Appliance[];
  review_note: string | null; attended_at: string | null; attended_by: string | null; distributed_at: string | null;
  distributed_by: string | null; photo_path: string | null; profile_photo_path: string | null; dob: string | null; yob: number | null;
}
interface Registered {
  id: string; name: string; gender: string | null; dob: string | null; yob: number | null; care_of: string | null; address: string | null;
  pincode: string | null; district: string | null; state: string | null; phone: string | null; udid_no: string | null; udid_label: string | null;
  disability_type: string | null; disability_pct: number | null; profile_photo_path: string | null; created_at: string;
}
type Status = "all" | "not_arrived" | "present" | "handed_over";
const STATUS_LABEL: Record<Exclude<Status, "all">, string> = { not_arrived: "Not arrived", present: "Present, waiting", handed_over: "Handed over" };
const statusOf = (p: Person): Exclude<Status, "all"> => (p.distributed_at ? "handed_over" : p.attended_at ? "present" : "not_arrived");
const TONE = { not_arrived: "neutral", present: "warn", handed_over: "ok" } as const;
const aidKey = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();
const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * Read-only camp dashboard (for dashboard logins and admins). Live from the server, refreshed every minute: totals,
 * aids, staff, and every person with search, filters and details. Nothing on this screen can change data.
 */
export function DashboardView() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [registered, setRegistered] = useState<Registered[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"camp" | "registered">("camp");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [aid, setAid] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<Person | null>(null);
  const [openReg, setOpenReg] = useState<Registered | null>(null);
  const [allAids, setAllAids] = useState(false);
  const { urls, show } = useSignedUrl();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sb = createClient();
      const [c, r, s] = await Promise.all([
        sb.from("camp_roster").select(ROSTER_COLS).order("serial_no", { nullsFirst: false }).limit(5000),
        sb.from("beneficiaries").select(REG_COLS).order("created_at", { ascending: false }).limit(5000),
        sb.rpc("staff_names"),
      ]);
      if (c.error) throw c.error;
      setPeople((c.data ?? []) as unknown as Person[]);
      setRegistered(r.error ? [] : ((r.data ?? []) as unknown as Registered[]));
      if (!s.error) setNames(new Map(((s.data ?? []) as { user_id: string; name: string }[]).map((x) => [x.user_id, x.name])));
      setErr(null);
      setAt(Date.now());
    } catch {
      setErr(navigator.onLine ? "Could not load the camp data. Tap Refresh to try again." : "No internet. The dashboard needs a connection to show live data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    const tick = () => { if (document.visibilityState === "visible") void load(); };
    const t = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); window.removeEventListener("online", tick); };
  }, [load]);

  const totals = useMemo(() => {
    const t = { all: 0, not_arrived: 0, present: 0, handed_over: 0 };
    for (const p of people ?? []) { t.all++; t[statusOf(p)]++; }
    return t;
  }, [people]);

  const aids = useMemo(() => {
    const m = new Map<string, { label: string; total: number; done: number }>();
    for (const p of people ?? []) {
      const seen = new Set<string>();
      for (const a of p.appliances) {
        const k = aidKey(a.name);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        const e = m.get(k) ?? { label: a.name.trim(), total: 0, done: 0 };
        e.total++;
        if (p.distributed_at) e.done++;
        m.set(k, e);
      }
    }
    return [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.total - a.total);
  }, [people]);

  const staff = useMemo(() => {
    const m = new Map<string, { present: number; handed: number }>();
    const bump = (id: string | null, f: "present" | "handed") => {
      if (!id) return;
      const e = m.get(id) ?? { present: 0, handed: 0 };
      e[f]++;
      m.set(id, e);
    };
    for (const p of people ?? []) { bump(p.attended_by, "present"); bump(p.distributed_by, "handed"); }
    return [...m.entries()].map(([id, v]) => ({ id, name: names.get(id) ?? "Staff member", ...v })).sort((a, b) => b.handed + b.present - (a.handed + a.present));
  }, [people, names]);

  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => (people ?? []).filter((p) =>
    (status === "all" || statusOf(p) === status) &&
    (!aid || p.appliances.some((a) => aidKey(a.name) === aid)) &&
    (!needle || p.name.toLowerCase().includes(needle) || (p.reg_no ?? "").toLowerCase().startsWith(needle)),
  ), [people, status, aid, needle]);
  const regRows = useMemo(() => (registered ?? []).filter((r) =>
    !needle || r.name.toLowerCase().includes(needle) || (r.phone ?? "").includes(needle) || (r.district ?? "").toLowerCase().includes(needle),
  ), [registered, needle]);

  const who = (id: string | null) => (id ? names.get(id) ?? "a staff member" : null);
  const pick = (s: Status) => { setStatus(s); setTab("camp"); setShown(PAGE); };
  const pct = totals.all ? Math.round((totals.handed_over / totals.all) * 100) : 0;
  const aidLabel = aid ? aids.find((a) => a.key === aid)?.label ?? aid : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <PageHeader
        title="Camp dashboard"
        subtitle={at ? `Updated ${new Date(at).toLocaleTimeString("en-IN", { timeStyle: "short" })} · refreshes every minute` : "Loading..."}
        action={<Button variant="secondary" loading={loading} onClick={() => void load()}>Refresh</Button>}
      />
      {err && <p role="alert" className="rounded-2xl bg-bad-bg px-4 py-3 font-semibold text-bad-fg">{err}</p>}

      {/* totals: tap one to list those people */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ["all", "Everyone", totals.all, "border-line bg-white text-ink"],
          ["handed_over", "Handed over", totals.handed_over, "border-emerald-200 bg-emerald-50 text-emerald-900"],
          ["present", "Present, waiting", totals.present, "border-amber-200 bg-amber-50 text-amber-900"],
          ["not_arrived", "Not arrived", totals.not_arrived, "border-line bg-sage-50 text-ink-soft"],
        ] as [Status, string, number, string][]).map(([k, label, n, cls]) => (
          <button key={k} onClick={() => pick(k)} aria-pressed={status === k}
            className={`rounded-3xl border p-4 text-left transition-transform active:scale-[0.98] ${cls} ${status === k ? "ring-4 ring-teal-200" : ""}`}>
            <span className="block text-4xl font-extrabold tabular-nums">{people ? n : "–"}</span>
            <span className="block text-sm font-bold">{label}</span>
          </button>
        ))}
      </div>
      <div>
        <div className="flex justify-between text-sm font-bold text-ink-soft"><span>Aids handed over</span><span>{pct}%</span></div>
        <div className="mt-1 h-3 overflow-hidden rounded-full bg-sage-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Aids handed over">
          <div className="h-full rounded-full bg-teal-600 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2">
          <SectionTitle>By aid (tap to list)</SectionTitle>
          <ul className="divide-y divide-line">
            {(allAids ? aids : aids.slice(0, 8)).map((a) => (
              <li key={a.key}>
                <button onClick={() => { setAid(a.key); setTab("camp"); setShown(PAGE); }} className="flex min-h-12 w-full items-center gap-3 py-2 text-left">
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{a.label}</span>
                  <span className="shrink-0 text-sm tabular-nums text-ink-muted">{a.done} / {a.total}</span>
                  <span className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-sage-100" aria-hidden>
                    <span className="block h-full bg-teal-600" style={{ width: `${a.total ? (a.done / a.total) * 100 : 0}%` }} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {aids.length > 8 && <Button variant="ghost" full onClick={() => setAllAids((v) => !v)}>{allAids ? "Show fewer" : `Show all ${aids.length} aids`}</Button>}
        </Card>
        <Card className="space-y-2">
          <SectionTitle>By staff member</SectionTitle>
          {staff.length === 0 ? <p className="text-ink-muted">Nothing recorded yet.</p> : (
            <ul className="divide-y divide-line">
              {staff.map((s) => (
                <li key={s.id} className="flex min-h-12 items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{s.name}</span>
                  <span className="shrink-0 text-sm text-ink-muted"><b className="text-ink">{s.present}</b> present · <b className="text-ink">{s.handed}</b> handed over</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section className="space-y-3" aria-label="People">
        <SegmentedControl<"camp" | "registered">
          label="Which list"
          value={tab}
          onChange={(t) => { setTab(t); setShown(PAGE); }}
          options={[{ value: "camp", label: `Camp list (${people?.length ?? "…"})` }, { value: "registered", label: `Registered at camp (${registered?.length ?? "…"})` }]}
        />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
          inputMode="search"
          placeholder={tab === "camp" ? "Search name or Reg. No." : "Search name, phone or district"}
          aria-label="Search people"
          className="h-14 w-full rounded-2xl border border-line bg-white px-4 text-lg text-ink focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100"
        />
        {tab === "camp" && (status !== "all" || aid) && (
          <div className="flex flex-wrap gap-2">
            {status !== "all" && <button onClick={() => setStatus("all")} className="min-h-11 rounded-full bg-teal-700 px-4 text-sm font-bold text-white">{STATUS_LABEL[status]} &times;</button>}
            {aidLabel && <button onClick={() => setAid(null)} className="min-h-11 rounded-full bg-teal-700 px-4 text-sm font-bold text-white">{aidLabel} &times;</button>}
          </div>
        )}

        {tab === "camp" && (
          <>
            <p className="text-sm font-semibold text-ink-muted">{rows.length} {rows.length === 1 ? "person" : "people"}</p>
            <ul className="grid gap-2 md:grid-cols-2">
              {rows.slice(0, shown).map((p) => {
                const s = statusOf(p);
                return (
                  <li key={p.id}>
                    <button onClick={() => setOpen(p)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left active:bg-sage-50">
                      <span className="shrink-0 rounded-lg bg-ink px-2 py-0.5 text-lg font-extrabold text-white">{p.reg_no ?? "-"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold text-ink">{p.name}</span>
                        <span className="block truncate text-sm text-ink-muted">{p.appliances.map((a) => a.name).join(", ") || "No aid listed"}</span>
                      </span>
                      <Badge tone={TONE[s]} dot>{STATUS_LABEL[s]}</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
            {rows.length > shown && <Button variant="secondary" full onClick={() => setShown((n) => n + PAGE)}>Show more ({rows.length - shown} left)</Button>}
          </>
        )}

        {tab === "registered" && (
          <>
            <p className="text-sm font-semibold text-ink-muted">{regRows.length} registered at the camp</p>
            <ul className="grid gap-2 md:grid-cols-2">
              {regRows.slice(0, shown).map((r) => (
                <li key={r.id}>
                  <button onClick={() => setOpenReg(r)} className="flex w-full flex-col rounded-2xl border border-line bg-white p-3 text-left active:bg-sage-50">
                    <span className="truncate font-bold text-ink">{r.name}</span>
                    <span className="truncate text-sm text-ink-muted">{[r.gender, r.district, r.disability_type].filter(Boolean).join(" · ") || "-"}</span>
                  </button>
                </li>
              ))}
            </ul>
            {regRows.length > shown && <Button variant="secondary" full onClick={() => setShown((n) => n + PAGE)}>Show more ({regRows.length - shown} left)</Button>}
          </>
        )}
      </section>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? `${open.reg_no ?? "-"} · ${open.name}` : undefined}>
        {open && (
          <div className="space-y-4">
            <Badge tone={TONE[statusOf(open)]} dot>{STATUS_LABEL[statusOf(open)]}</Badge>
            <ul className="space-y-1 text-ink">
              <li>{open.attended_at ? <>Present <b>{time(open.attended_at)}</b>{who(open.attended_by) ? <> by <b>{who(open.attended_by)}</b></> : null}</> : "Not marked present yet"}</li>
              <li>{open.distributed_at ? <>Handed over <b>{time(open.distributed_at)}</b>{who(open.distributed_by) ? <> by <b>{who(open.distributed_by)}</b></> : null}</> : "Not handed over yet"}</li>
            </ul>
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wider text-ink-muted">Aids</p>
              <ul className="flex flex-wrap gap-2">
                {open.appliances.length === 0 && <li className="text-ink-muted">None listed</li>}
                {open.appliances.map((a, i) => <li key={i} className="rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800">{a.name}{a.side ? ` (${a.side})` : ""}</li>)}
              </ul>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              {([["S.No", open.serial_no], ["Batch", open.batch], ["Born", open.dob ?? open.yob]] as [string, string | number | null][]).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-ink-muted">{k}</dt><dd className="font-semibold text-ink">{v ?? "-"}</dd></div>
              ))}
            </dl>
            {open.review_note && <p className="rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn-fg">{open.review_note}</p>}
            <div className="grid gap-2">
              {open.profile_photo_path ? <Photo bucket="documents" path={open.profile_photo_path} label="profile photo" urls={urls} show={show} /> : <p className="text-sm text-ink-muted">No profile photo yet.</p>}
              {open.photo_path ? <Photo bucket="handover-photos" path={open.photo_path} label="handover photo" urls={urls} show={show} /> : null}
            </div>
            <Button variant="ghost" full onClick={() => setOpen(null)}>Close</Button>
          </div>
        )}
      </Sheet>

      <Sheet open={!!openReg} onClose={() => setOpenReg(null)} title={openReg?.name}>
        {openReg && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              {([
                ["Registered", time(openReg.created_at)], ["Gender", openReg.gender], ["Born", openReg.dob ?? (openReg.yob ? String(openReg.yob) : null)],
                ["Phone", openReg.phone], ["Care of", openReg.care_of], ["District", openReg.district], ["State", openReg.state], ["Pincode", openReg.pincode],
                ["UDID / enrolment", openReg.udid_no ? `${openReg.udid_no}${openReg.udid_label ? ` (${openReg.udid_label})` : ""}` : null],
                ["Disability", [openReg.disability_type, openReg.disability_pct != null ? `${openReg.disability_pct}%` : null].filter(Boolean).join(", ") || null],
              ] as [string, string | null][]).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-ink-muted">{k}</dt><dd className="break-words font-semibold text-ink">{v || "-"}</dd></div>
              ))}
            </dl>
            {openReg.address && <p className="text-sm text-ink-muted">{openReg.address}</p>}
            {openReg.profile_photo_path ? <Photo bucket="documents" path={openReg.profile_photo_path} label="profile photo" urls={urls} show={show} /> : <p className="text-sm text-ink-muted">No profile photo.</p>}
            <Button variant="ghost" full onClick={() => setOpenReg(null)}>Close</Button>
          </div>
        )}
      </Sheet>

      {/* a dashboard login has no Sync screen, so sign-out lives here (phones have no sidebar) */}
      <div className="border-t border-line pt-4">
        <SignOutForm action={signOut} />
      </div>
    </div>
  );
}
