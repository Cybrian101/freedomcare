"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, PageHeader, SegmentedControl } from "@/components/ui";
import { AdminStaff } from "@/components/admin/AdminStaff";
import { AdminActivity } from "@/components/admin/AdminActivity";
import { Photo, useSignedUrl } from "@/components/PhotoLink";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role";
import { maskAadhaar, formatAadhaar } from "@/lib/aadhaar";
import type { RosterRow, Beneficiary } from "@/lib/types";

type Tab = "camp" | "registered";
const PAGE = 40;

/**
 * Admin-only overview. The UI check below is only for tidiness; the data is protected by database row-level security,
 * so a non-admin who opens this URL receives no rows and no photos.
 */
export default function AdminPage() {
  const { role, loaded } = useRole();
  const router = useRouter();
  const allowed = role === "admin";
  // Anyone else is sent home: staff and dashboard logins never see this page at all.
  useEffect(() => { if (loaded && !allowed) router.replace("/"); }, [loaded, allowed, router]);
  if (!loaded) return <p className="p-4 text-ink-muted">Checking access...</p>;
  if (!allowed) return null;
  return <AdminTabs />;
}

type Section = "people" | "staff" | "activity";

function AdminTabs() {
  const [section, setSection] = useState<Section>("people");
  return (
    <>
      <div className="mx-auto w-full max-w-3xl pb-4">
        <SegmentedControl<Section>
          label="Admin sections"
          value={section}
          onChange={setSection}
          options={[{ value: "people", label: "People" }, { value: "staff", label: "Staff" }, { value: "activity", label: "Activity" }]}
        />
      </div>
      {section === "people" && <AdminList />}
      {section !== "people" && (
        <div className="mx-auto w-full max-w-3xl">
          <PageHeader
            title={section === "staff" ? "Staff logins" : "Activity log"}
            subtitle={section === "staff" ? "Add staff, switch a login off, reset a password" : "Who saved attendance, handover photos and details, and for whom"}
          />
          {section === "staff" ? <AdminStaff /> : <AdminActivity />}
        </div>
      )}
    </>
  );
}

function AdminList() {
  const [tab, setTab] = useState<Tab>("camp");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [camp, setCamp] = useState<RosterRow[] | null>(null);
  const [reg, setReg] = useState<Beneficiary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { urls, show } = useSignedUrl();
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let dead = false;
    const sb = createClient();
    Promise.all([
      sb.from("camp_roster").select("*").order("serial_no", { nullsFirst: false }).limit(2000),
      sb.from("beneficiaries").select("*").order("created_at", { ascending: false }).limit(2000),
    ]).then(([c, r]) => {
      if (dead) return;
      if (c.error || r.error) setErr("Could not load. Check your connection and that the admin SQL (step 1) has been run.");
      setCamp((c.data ?? []) as RosterRow[]);
      setReg((r.data ?? []) as Beneficiary[]);
    }, () => { if (!dead) setErr("Could not load. Check your connection."); });
    return () => { dead = true; };
  }, []);

  const needle = q.trim().toLowerCase();
  const campRows = useMemo(
    () => (camp ?? []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.reg_no ?? "").startsWith(needle)),
    [camp, needle],
  );
  const regRows = useMemo(
    () => (reg ?? []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.phone ?? "").includes(needle)),
    [reg, needle],
  );

  const reveal = (id: string) => setRevealed((s) => new Set(s).add(id));
  const rows = tab === "camp" ? campRows : regRows;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <PageHeader title="All beneficiaries" subtitle="Admin view: details and photos. Photos load only when you tap them." />
      <div className="grid grid-cols-2 gap-2">
        <Button variant={tab === "camp" ? "primary" : "secondary"} onClick={() => { setTab("camp"); setShown(PAGE); }}>
          Camp list ({camp?.length ?? "..."})
        </Button>
        <Button variant={tab === "registered" ? "primary" : "secondary"} onClick={() => { setTab("registered"); setShown(PAGE); }}>
          Registered at camp ({reg?.length ?? "..."})
        </Button>
      </div>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
        placeholder="Search name, Reg. No. or phone"
        aria-label="Search"
        className="h-12 w-full rounded-xl border border-line bg-white px-4"
      />
      {err && <p role="alert" className="rounded-2xl bg-bad-bg px-4 py-3 text-sm font-semibold text-bad-fg">{err}</p>}
      {camp === null && !err && <p className="text-ink-muted">Loading...</p>}

      {tab === "camp" &&
        campRows.slice(0, shown).map((r) => (
          <Card key={r.id} className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-ink-muted">Reg. No. {r.reg_no ?? "not assigned"} · S.No {r.serial_no ?? "-"} · Batch {r.batch ?? "-"}</p>
                <p className="text-lg font-bold text-ink">{r.name}</p>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${r.distributed_at ? "bg-ok-bg text-ok-fg" : r.attended_at ? "bg-warn-bg text-warn-fg" : "bg-sage-100 text-ink-soft"}`}>
                {r.distributed_at ? "Distributed" : r.attended_at ? "Attended" : "Not arrived"}
              </span>
            </div>
            <ul className="flex flex-wrap gap-2">
              {r.appliances.map((a, i) => (
                <li key={i} className="rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800">{a.name}{a.side ? ` (${a.side})` : ""}</li>
              ))}
            </ul>
            {r.aadhaar_no && (
              <p className="text-sm text-ink-muted">
                Aadhaar {revealed.has(r.id) ? formatAadhaar(r.aadhaar_no) : maskAadhaar(r.aadhaar_no)}{" "}
                {!revealed.has(r.id) && <button className="font-semibold underline" onClick={() => reveal(r.id)}>show</button>}
              </p>
            )}
            {r.review_note && <p className="rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn-fg">{r.review_note}</p>}
            {r.distributed_at && (
              <p className="text-sm text-ink-muted">Handed over {new Date(r.distributed_at).toLocaleString("en-IN")}</p>
            )}
            {r.profile_photo_path && <Photo bucket="documents" path={r.profile_photo_path} label="profile photo" urls={urls} show={show} />}
            {r.photo_path && <Photo bucket="handover-photos" path={r.photo_path} label="handover photo" urls={urls} show={show} />}
          </Card>
        ))}

      {tab === "registered" &&
        regRows.slice(0, shown).map((b) => (
          <Card key={b.id} className="space-y-2">
            <p className="text-lg font-bold text-ink">{b.name}</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              {([
                ["Aadhaar", b.aadhaar_no ? (revealed.has(b.id) ? formatAadhaar(b.aadhaar_no) : maskAadhaar(b.aadhaar_no)) : "-"],
                ["Gender", b.gender], ["Date of birth", b.dob ?? (b.yob ? String(b.yob) : null)],
                ["Phone", b.phone], ["Care of", b.care_of], ["District", b.district],
                ["UDID / enrolment", b.udid_no ? `${b.udid_no}${b.udid_label ? ` (${b.udid_label})` : ""}` : null],
                ["Disability", [b.disability_type, b.disability_pct != null ? `${b.disability_pct}%` : null].filter(Boolean).join(", ") || null],
              ] as [string, string | null][]).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-ink-muted">{k}</dt><dd className="font-semibold text-ink break-words">{v || "-"}</dd></div>
              ))}
            </dl>
            {b.address && <p className="text-sm text-ink-muted">{b.address}</p>}
            {b.aadhaar_no && !revealed.has(b.id) && <button className="text-sm font-semibold underline" onClick={() => reveal(b.id)}>Show full Aadhaar</button>}
            <div className="grid gap-2">
              {b.profile_photo_path && <Photo bucket="documents" path={b.profile_photo_path} label="profile photo" urls={urls} show={show} />}
            </div>
          </Card>
        ))}

      {camp !== null && rows.length === 0 && <p className="py-6 text-center text-ink-muted">Nothing matches.</p>}
      {rows.length > shown && <Button variant="secondary" full onClick={() => setShown((n) => n + PAGE)}>Show more ({rows.length - shown} left)</Button>}
    </div>
  );
}
