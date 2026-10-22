"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, SegmentedControl, useToast } from "@/components/ui";
import { DocumentScanner } from "@/components/scan/DocumentScanner";
import { AadhaarFixHint } from "@/components/scan/AadhaarFixHint";
import { useDataset } from "@/components/DatasetPanel";
import { Avatar } from "@/components/desk/Avatar";
import { ProfilePhotoAction } from "@/components/desk/ProfilePhotoAction";
import { useSync } from "@/components/SyncProvider";
import { createClient } from "@/lib/supabase/client";
import { allLocal, asRosterStatus, getLocal, searchLocal, type LocalBeneficiary } from "@/lib/local-db";
import { lookupAadhaar, type Candidate } from "@/lib/matching";
import { looksLikeAadhaar, rankByNameDob, type MatchLevel } from "@/lib/attendance-match";
import { kindOf, submitAttendance } from "@/lib/offline-queue";
import { digitsOnly, isValidAadhaar } from "@/lib/ocr/verhoeff";
import { formatAadhaar, maskAadhaar } from "@/lib/aadhaar";
import type { OcrResult } from "@/lib/ocr/types";

type Mode = "find" | "name";
interface Hit {
  row: LocalBeneficiary;
  level?: MatchLevel;
}

const LEVEL_NOTE: Record<MatchLevel, string> = {
  exact: "Name and date of birth match",
  name_only: "Name matches. No date of birth on file to compare",
  dob_differs: "Name matches but the date of birth is different",
};

/** A person we only know from the server (device list out of date): enough to mark attendance by id. */
function stub(c: Candidate): LocalBeneficiary {
  return {
    id: c.id, reg_no: c.reg_no, serial_no: null, batch: null, name: c.name, name_norm: "", aadhaar_last4: null,
    dob: null, yob: null, has_photo: false, appliances: [], review_note: null, attended_at: null, distributed_at: null, server_updated_at: "",
  };
}

/**
 * Attendance desk. Three ways to find the person, all reading the on-device list so they work offline:
 * type (Reg. No. / name / Aadhaar), scan the Aadhaar, or - when there is no Aadhaar - name + date of birth.
 * Marking attendance is saved on the device first and synced like every other action.
 */
export function AttendanceDesk() {
  const toast = useToast();
  const { items, online } = useSync();
  const { meta, ready, loaded } = useDataset();
  const [mode, setMode] = useState<Mode>("find");
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searched, setSearched] = useState(false);
  const [notice, setNotice] = useState<{ text: string; href?: string; hrefLabel?: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const seq = useRef(0);

  // Live search while typing a Reg. No. or name (a full Aadhaar number is looked up explicitly, see onType).
  useEffect(() => {
    if (mode !== "find" || looksLikeAadhaar(q)) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      const rows = q.trim() ? await searchLocal(q, 20).catch(() => []) : [];
      if (my !== seq.current) return;
      setHits(rows.map((row) => ({ row })));
      setSearched(!!q.trim());
    }, 120);
    return () => clearTimeout(t);
  }, [mode, q, meta?.downloadedAt]);

  // Name + date of birth against the whole device list.
  useEffect(() => {
    if (mode !== "name") return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      if (name.trim().length < 2) {
        if (my === seq.current) { setHits([]); setSearched(false); }
        return;
      }
      const rows = await allLocal().catch(() => []);
      if (my !== seq.current) return;
      setHits(rankByNameDob(rows, { name, dob: dob || null }).map((r) => ({ row: r.row, level: r.level })));
      setSearched(true);
    }, 200);
    return () => clearTimeout(t);
  }, [mode, name, dob, meta?.downloadedAt]);

  async function runAadhaar(digits: string, scanned?: { name?: string; dob?: string }) {
    seq.current++; // drop any pending live search so it cannot overwrite this result
    setLooking(true); setNotice(null); setHits([]); setSearched(false);
    const outcome = await lookupAadhaar(createClient(), digits);
    setLooking(false);
    const toHit = async (c: Candidate): Promise<Hit> => ({ row: (await getLocal(c.id)) ?? stub(c) });

    if (outcome.kind === "confirmed_match") {
      setHits([await toHit(outcome.row)]); setSearched(true);
      return;
    }
    if (outcome.kind === "already_registered") {
      setNotice({
        text: `${outcome.row.name} registered at the camp with this Aadhaar but has no Reg. No. yet. Assign a Reg. No. first, then mark attendance.`,
        href: "/registration/assign", hrefLabel: "Assign Reg. No.",
      });
      return;
    }
    if (outcome.kind === "candidates") {
      if (outcome.pendingLocal) {
        setNotice({ text: "A registration with this Aadhaar is saved on this device and still waiting to sync. Wait for it to sync, then assign a Reg. No." });
        return;
      }
      setHits(await Promise.all(outcome.rows.map(toHit))); setSearched(true);
      setNotice({ text: `Only the last 4 digits (${digits.slice(-4)}) matched on this device. Compare the name with the card before marking.` });
      return;
    }
    // Nothing found by Aadhaar: fall back to name + date of birth, using what the scan read when there is one.
    setMode("name");
    setName(scanned?.name ?? ""); setDob(scanned?.dob ?? "");
    setNotice({
      text: outcome.kind === "confirmed_no_match"
        ? `No record has Aadhaar ${maskAadhaar(digits)}. Some people were listed without an Aadhaar, so check by name and date of birth.`
        : outcome.reason === "invalid_number"
          ? "That number does not pass the Aadhaar check. Compare it with the card, or match by name and date of birth."
          : "Could not check this Aadhaar right now. Match by name and date of birth instead.",
    });
  }

  function onType(v: string) {
    const compact = v.replace(/\s/g, "");
    const next = /^\d+$/.test(compact) && compact.length > 6 ? formatAadhaar(v) : v;
    setQ(next);
    setNotice(null);
    // A number that fails the checksum is a typo or a misread, not a person: help fix it instead of searching.
    if (looksLikeAadhaar(next) && isValidAadhaar(next)) void runAadhaar(digitsOnly(next));
  }

  function onScan(r: OcrResult) {
    const num = digitsOnly(r.fields.aadhaar_no?.value ?? "");
    setScanning(false);
    setQ(formatAadhaar(num));
    const scanned = { name: r.fields.name?.value ?? undefined, dob: r.fields.dob?.value ?? undefined };
    if (num.length === 12 && isValidAadhaar(num)) void runAadhaar(num, scanned);
    else if (num.length === 12) {
      // Misread digit: show the correction hint above; the scanned name/DOB are kept for the name + DOB fallback.
      setName(scanned.name ?? ""); setDob(scanned.dob ?? "");
      setNotice({ text: "The scanned number does not pass the Aadhaar check. Fix it below, or match by name and date of birth." });
    } else {
      setMode("name"); setName(scanned.name ?? ""); setDob(scanned.dob ?? "");
      setNotice({ text: "The Aadhaar number could not be read. Check the name and date of birth below, or type the number." });
    }
  }

  async function mark(h: Hit) {
    setBusy(h.row.id);
    try {
      // A date of birth typed here is kept on the record only if it has none yet (so the next visit can match on it).
      await submitAttendance({ rosterId: h.row.id, regNo: h.row.reg_no, name: h.row.name, dob: mode === "name" && dob && !h.row.dob ? dob : null });
      toast(`Attendance saved for ${h.row.name}`, "ok");
      setSure(null);
    } catch {
      toast("Could not save on this device. Storage may be full or blocked.", "bad");
    } finally {
      setBusy(null);
    }
  }

  const attendanceByRoster = useMemo(() => {
    const m = new Map<string, "pending" | "synced">();
    for (const i of items) {
      if (kindOf(i) !== "attendance") continue;
      if (i.status !== "synced") m.set(i.rosterId, "pending");
      else if (!m.has(i.rosterId)) m.set(i.rosterId, "synced");
    }
    return m;
  }, [items]);

  return (
    <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
     <div className="space-y-4 lg:sticky lg:top-4">
      <SegmentedControl<Mode>
        label="How to find the person"
        value={mode}
        onChange={(m) => { seq.current++; setMode(m); setHits([]); setSearched(false); setNotice(null); }}
        options={[{ value: "find", label: "Type or scan" }, { value: "name", label: "No Aadhaar: name + DOB" }]}
      />

      {mode === "find" && (
        <div className="space-y-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => onType(e.target.value)}
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Reg. No. / name / Aadhaar"
            aria-label="Find by Reg. No., name or Aadhaar number"
            className="h-14 w-full rounded-2xl border border-line bg-white px-4 text-xl text-ink focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100"
          />
          {looksLikeAadhaar(q) && !isValidAadhaar(q) && (
            <>
              <AadhaarFixHint digits={digitsOnly(q)} onPick={(d) => { setQ(formatAadhaar(d)); void runAadhaar(d); }} />
              <Button variant="secondary" full onClick={() => { setMode("name"); setHits([]); setSearched(false); }}>No Aadhaar card? Match by name and date of birth</Button>
            </>
          )}
          {!scanning && <Button variant="secondary" full onClick={() => setScanning(true)}>Scan Aadhaar card</Button>}
          {scanning && (
            <div className="space-y-2">
              <DocumentScanner kind="aadhaar" onResult={(r) => onScan(r)} onManual={() => setScanning(false)} />
              <Button variant="ghost" full onClick={() => setScanning(false)}>Cancel scan</Button>
            </div>
          )}
        </div>
      )}

      {mode === "name" && (
        <Card className="space-y-3">
          <label className="block text-sm font-semibold text-ink-soft">
            Name (as the person says it)
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-white px-4 text-base text-ink focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100"
            />
          </label>
          <label className="block text-sm font-semibold text-ink-soft">
            Date of birth
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-white px-4 text-base text-ink focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100"
            />
          </label>
          <p className="text-xs text-ink-muted">A date of birth helps tell two people with the same name apart. It is saved on the record the first time it is entered.</p>
        </Card>
      )}

      {looking && <p role="status" className="text-center text-ink-muted">Checking...</p>}
      {notice && (
        <div role="status" className="rounded-2xl bg-warn-bg px-4 py-3 text-sm font-semibold text-warn-fg">
          {notice.text}
          {notice.href && <Link href={notice.href} className="ml-2 underline">{notice.hrefLabel}</Link>}
        </div>
      )}

     </div>

     <div className="space-y-4">
      {loaded && !meta && (
        <p role="alert" className="rounded-2xl bg-warn-bg px-4 py-3 text-sm text-warn-fg">
          No list on this device. Connect and download the list first (button above).
        </p>
      )}
      {searched && !looking && hits.length === 0 && meta && (
        <Card className="space-y-2 text-center">
          <p className="font-semibold text-ink">
            {mode === "name" ? "Nobody on the list matches this name." : "No match in the list on this device."}
          </p>
          <p className="text-sm text-ink-muted">
            {ready
              ? "Check the spelling or search by Reg. No. If the person is not on the list, register them."
              : "This device's list is incomplete, so a missing match does not mean the person is not on the list. Download the full list when online."}
          </p>
          <Button href="/registration" variant="secondary" full>Go to Register</Button>
        </Card>
      )}
      {!searched && !looking && mode === "find" && !q.trim() && (
        <p className="py-4 text-center text-ink-muted">Type a Reg. No. (token), a name or a 12-digit Aadhaar to begin.</p>
      )}

      <ul className="grid gap-3 xl:grid-cols-1">
        {hits.map((h) => {
          const r = h.row;
          const queued = attendanceByRoster.get(r.id);
          const status = asRosterStatus(r);
          const done = status !== "not_arrived" || queued === "synced";
          const risky = h.level === "dob_differs";
          return (
            <li key={r.id}>
              <Card className="space-y-3">
                <div className="flex items-center gap-3">
                  <Avatar id={r.id} name={r.name} size={64} refreshKey={items.length} />
                  <div className="min-w-0 flex-1">
                    <span className="inline-block rounded-lg bg-ink px-2 py-0.5 text-lg font-extrabold text-white">{r.reg_no ?? "-"}</span>
                    <p className="truncate text-lg font-bold text-ink">{r.name}</p>
                    <p className="truncate text-sm text-ink-muted">
                      {r.appliances.map((a) => a.name).join(", ") || "No appliance listed"}
                      {r.dob ? ` · born ${r.dob}` : r.yob ? ` · born ${r.yob}` : ""}
                    </p>
                  </div>
                </div>
                {h.level && (
                  <p className={`text-sm font-semibold ${risky ? "text-bad-fg" : h.level === "exact" ? "text-ok-fg" : "text-warn-fg"}`}>{LEVEL_NOTE[h.level]}</p>
                )}
                {status === "distributed" ? (
                  <p className="rounded-2xl bg-ok-bg px-4 py-3 font-semibold text-ok-fg">Already received aid</p>
                ) : done ? (
                  <p className="rounded-2xl bg-ok-bg px-4 py-3 font-semibold text-ok-fg">
                    Attendance marked{r.attended_at ? ` at ${new Date(r.attended_at).toLocaleTimeString("en-IN", { timeStyle: "short" })}` : ""}
                  </p>
                ) : queued === "pending" ? (
                  <p className="rounded-2xl bg-info-bg px-4 py-3 font-semibold text-info-fg">
                    Saved on this device{online ? " - sending..." : " - will send when online"}
                  </p>
                ) : risky && sure !== r.id ? (
                  <Button variant="danger" full onClick={() => setSure(r.id)}>Date of birth differs. Check before marking</Button>
                ) : (
                  <Button size="lg" full loading={busy === r.id} onClick={() => void mark(h)}>
                    {risky ? "Yes, same person. Mark attendance" : "Mark attendance"}
                  </Button>
                )}
                <div className="space-y-1">
                  <ProfilePhotoAction person={r} hasPhoto={r.has_photo} variant={done ? "primary" : "secondary"} full />
                </div>
                <a href={`/distribution/profile?id=${r.id}`} className="block py-1 text-center text-sm font-semibold text-teal-700 underline">Open full record</a>
              </Card>
            </li>
          );
        })}
      </ul>
     </div>
    </div>
  );
}
