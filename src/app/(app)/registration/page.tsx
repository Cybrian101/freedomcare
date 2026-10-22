"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, PageHeader, useToast } from "@/components/ui";
import { DocumentScanner } from "@/components/scan/DocumentScanner";
import { AadhaarFixHint } from "@/components/scan/AadhaarFixHint";
import { DatasetPanel, useDataset } from "@/components/DatasetPanel";
import { useSync } from "@/components/SyncProvider";
import { createClient } from "@/lib/supabase/client";
import { formatAadhaar, maskAadhaar } from "@/lib/aadhaar";
import { digitsOnly, isValidAadhaar } from "@/lib/ocr/verhoeff";
import { canStartRegistration, lookupAadhaar, type Candidate, type MatchOutcome } from "@/lib/matching";
import { allLocal, type LocalBeneficiary } from "@/lib/local-db";
import { rankByNameDob, type Ranked } from "@/lib/attendance-match";
import { submitLink, submitRegistration } from "@/lib/offline-queue";
import type { OcrResult } from "@/lib/ocr/types";

type Step =
  | { s: "capture" }
  | { s: "confirm"; warnings: string[]; fromScan: boolean }
  | { s: "looking" }
  | { s: "result"; outcome: MatchOutcome }
  | { s: "saved"; id: string; name: string; kind: "registration" | "link" };

/** Everything the scan read besides the number. All of it is shown and editable before anything is saved. */
interface CardFields {
  name: string;
  dob: string; // yyyy-mm-dd or ""
  yob: string;
  gender: string;
  care_of: string;
  address: string;
  pincode: string;
  district: string;
  state: string;
  vid: string;
  phone: string;
  email: string;
}
const EMPTY: CardFields = { name: "", dob: "", yob: "", gender: "", care_of: "", address: "", pincode: "", district: "", state: "", vid: "", phone: "", email: "" };

const INCONCLUSIVE_COPY = {
  offline: "You are offline and no person on this device matches. This is NOT a confirmed new beneficiary.",
  lookup_failed: "The server check failed. This is NOT a confirmed new beneficiary.",
  dataset_not_ready: "The list on this device is incomplete, so a missing match cannot be trusted. Download the full list first.",
  invalid_number: "That number does not pass the Aadhaar check. Compare it with the card.",
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function RegistrationPage() {
  const toast = useToast();
  const { items } = useSync();
  const [step, setStep] = useState<Step>({ s: "capture" });
  const [num, setNum] = useState("");
  const [card, setCard] = useState<CardFields>(EMPTY);
  const [scanKey, setScanKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const image = useRef<Blob | null>(null);
  const { ready } = useDataset();

  const digits = digitsOnly(num);
  const complete = digits.length === 12;
  const checksumOk = isValidAadhaar(digits);
  const setField = (k: keyof CardFields, v: string) => setCard((c) => ({ ...c, [k]: v }));

  function onResult(r: OcrResult, img: Blob) {
    const v = (k: string) => r.fields[k]?.value ?? "";
    image.current = img;
    setNum(formatAadhaar(v("aadhaar_no")));
    setCard({
      name: v("name"), dob: DATE_RE.test(v("dob")) ? v("dob") : "", yob: v("yob"), gender: v("gender"), care_of: v("care_of"),
      address: v("address"), pincode: v("pincode"), district: v("district"), state: v("state"), vid: v("vid"), phone: v("phone"), email: v("email"),
    });
    setStep({ s: "confirm", warnings: r.warnings, fromScan: true });
  }
  function reset() {
    image.current = null;
    setNum(""); setCard(EMPTY); setScanKey((k) => k + 1); setStep({ s: "capture" });
  }
  async function lookup() {
    setStep({ s: "looking" });
    const outcome = await lookupAadhaar(createClient(), digits);
    setStep({ s: "result", outcome });
  }
  const edit = () => setStep({ s: "confirm", warnings: [], fromScan: false });

  /** Save the scanned person as a new member straight away (the disability document can be added later). */
  async function saveNew() {
    const name = card.name.trim();
    if (!name) { toast("Type the name first", "bad"); return; }
    setSaving(true);
    try {
      const phone = digitsOnly(card.phone);
      const vid = digitsOnly(card.vid);
      const payload = {
        name,
        aadhaar_name: name,
        aadhaar_no: digits,
        gender: card.gender || null,
        dob: DATE_RE.test(card.dob) ? card.dob : null,
        yob: /^(19|20)\d{2}$/.test(card.yob) ? Number(card.yob) : null,
        care_of: card.care_of || null,
        address: card.address || null,
        pincode: /^\d{6}$/.test(card.pincode) ? card.pincode : null,
        district: card.district || null,
        state: card.state || null,
        vid: /^\d{16}$/.test(vid) ? vid : null,
        phone: /^[6-9]\d{9}$/.test(phone) ? phone : null,
        email: card.email || null,
        source: "registered" as const,
      };
      // Saved on this device first; the server's unique Aadhaar rule re-checks it when it syncs.
      const item = await submitRegistration({ name, payload, docs: image.current ? { aadhaar: image.current } : undefined });
      toast("Saved on this device", "ok");
      setStep({ s: "saved", id: item.id, name, kind: "registration" });
    } catch {
      toast("Could not save on this device. Storage may be full or blocked.", "bad");
    } finally {
      setSaving(false);
    }
  }

  /** The person is already on the camp list without an Aadhaar: add the number and date of birth to that record. */
  async function linkTo(row: LocalBeneficiary) {
    setSaving(true);
    try {
      const item = await submitLink({
        rosterId: row.id, regNo: row.reg_no, name: row.name, aadhaar: digits,
        dob: DATE_RE.test(card.dob) ? card.dob : null,
        yob: /^(19|20)\d{2}$/.test(card.yob) ? Number(card.yob) : null,
      });
      toast("Saved on this device", "ok");
      setStep({ s: "saved", id: item.id, name: row.name, kind: "link" });
    } catch {
      toast("Could not save on this device. Storage may be full or blocked.", "bad");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-5 space-y-4">
      <PageHeader title="Registration" subtitle="Scan the Aadhaar to find the existing record, or register someone new" />
      <DatasetPanel compact />

      {step.s === "capture" && (
        <DocumentScanner key={scanKey} kind="aadhaar" onResult={onResult} onManual={edit} />
      )}
      {step.s === "capture" && (
        <Button href="/registration/assign" variant="secondary" full>
          Assign Reg. No. to people registered today
        </Button>
      )}

      {(step.s === "confirm" || step.s === "looking") && (
        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-ink">Confirm the card details</h2>
            <p className="text-sm text-ink-muted mt-1">
              {step.s === "confirm" && step.fromScan
                ? "Read from the photo. Compare with the card and correct anything before searching."
                : "Type the details from the card."}
            </p>
          </div>
          <input
            value={num}
            onChange={(e) => setNum(formatAadhaar(e.target.value))}
            inputMode="numeric"
            autoComplete="off"
            aria-label="Aadhaar number"
            placeholder="0000 0000 0000"
            className="w-full min-h-16 rounded-2xl border border-line bg-white px-2 text-center text-[clamp(1.15rem,6.4vw,1.875rem)] font-mono tracking-wider focus:outline-none focus:ring-4 focus:ring-teal-100 focus:border-teal-500"
          />
          {complete && !checksumOk && <AadhaarFixHint digits={digits} onPick={(d) => setNum(formatAadhaar(d))} />}
          <label className="block text-sm font-semibold text-ink-soft">
            Name {!card.name.trim() && <span className="font-bold text-bad-fg">- not read, type it from the card</span>}
            <input
              value={card.name}
              onChange={(e) => setField("name", e.target.value)}
              autoComplete="off"
              className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-white px-4 text-base text-ink focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100"
            />
          </label>
          <label className="block text-sm font-semibold text-ink-soft">
            Date of birth{!card.dob && card.yob ? ` (card shows year ${card.yob} only)` : ""}
            {!card.dob && !card.yob && <span className="font-bold text-warn-fg"> - not read, type it if the card shows it</span>}
            <input
              type="date"
              value={card.dob}
              onChange={(e) => setField("dob", e.target.value)}
              className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-white px-4 text-base text-ink focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100"
            />
          </label>
          {step.s === "confirm" && step.warnings.length > 0 && (
            <ul className="text-sm text-warn-fg bg-warn-bg rounded-2xl px-4 py-3 list-disc list-inside">
              {step.warnings.slice(0, 3).map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reset} disabled={step.s === "looking"}>Rescan</Button>
            <Button className="flex-1" onClick={lookup} disabled={!complete} loading={step.s === "looking"}>
              Look up
            </Button>
          </div>
        </Card>
      )}

      {step.s === "result" && (
        <Result
          outcome={step.outcome} digits={digits} card={card} ready={ready} saving={saving}
          onEdit={edit} onRetry={lookup} onReset={reset} onSaveNew={saveNew} onLink={linkTo}
        />
      )}

      {step.s === "saved" && <Saved step={step} items={items} onReset={reset} />}
    </div>
  );
}

function Saved({ step, items, onReset }: { step: Extract<Step, { s: "saved" }>; items: ReturnType<typeof useSync>["items"]; onReset: () => void }) {
  const q = items.find((i) => i.id === step.id);
  const confirmed = q?.status === "synced";
  const rejected = q?.status === "rejected";
  return (
    <Card className="space-y-4 text-center">
      <h2 className={`text-2xl font-extrabold ${confirmed ? "text-ok-fg" : rejected ? "text-bad-fg" : "text-info-fg"}`}>
        {confirmed ? (step.kind === "link" ? "Details added" : "Registered") : rejected ? "Needs review" : "Saved on this device - awaiting sync"}
      </h2>
      <p className="text-ink-muted">
        {confirmed
          ? step.kind === "link"
            ? `Aadhaar and date of birth are now on ${step.name}'s record.`
            : `${step.name} is confirmed on the server. Assign a Reg. No. under "Assign Reg. No." when the token is issued.`
          : rejected
            ? q?.lastError ?? "The server refused this. Open the sync queue."
            : "It uploads automatically. It is NOT confirmed until the server accepts it."}
      </p>
      {(rejected || (!confirmed && q)) && <Button href="/queue" variant="secondary" full>Open sync queue</Button>}
      {confirmed && step.kind === "registration" && <Button href="/registration/assign" variant="secondary" full>Assign Reg. No.</Button>}
      <Button full onClick={onReset}>Scan another</Button>
    </Card>
  );
}

function CandidateRow({ c }: { c: Candidate }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl border border-line p-3">
      <div className="min-w-0">
        <p className="font-bold text-ink truncate">{c.name}</p>
        <p className="text-sm text-ink-muted">{c.reg_no ? `Reg. No. ${c.reg_no}` : "Pending registration on this device"}</p>
      </div>
      {c.reg_no && <Button href={`/distribution/profile?id=${c.id}`} variant="secondary">Open</Button>}
    </li>
  );
}

/** People on the camp list who have no Aadhaar yet and whose name (and date of birth) match the card. */
function ListedWithoutAadhaar({ card, saving, onLink }: { card: CardFields; saving: boolean; onLink: (r: LocalBeneficiary) => void }) {
  const [rows, setRows] = useState<Ranked<LocalBeneficiary>[] | null>(null);
  useEffect(() => {
    let dead = false;
    if (card.name.trim().length < 2) { void Promise.resolve().then(() => { if (!dead) setRows([]); }); return; }
    void allLocal().then(
      (all) => { if (!dead) setRows(rankByNameDob(all, { name: card.name, dob: DATE_RE.test(card.dob) ? card.dob : null }, { onlyWithoutAadhaar: true, limit: 5 })); },
      () => { if (!dead) setRows([]); },
    );
    return () => { dead = true; };
  }, [card.name, card.dob]);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="space-y-2 rounded-2xl bg-warn-bg p-3">
      <p className="text-sm font-bold text-warn-fg">Already on the list without an Aadhaar? Check these before registering a new person.</p>
      <ul className="space-y-2">
        {rows.map(({ row, level }) => (
          <li key={row.id} className="space-y-2 rounded-2xl border border-line bg-white p-3">
            <p className="font-bold text-ink">{row.name} <span className="font-semibold text-ink-muted">Reg. No. {row.reg_no ?? "-"}</span></p>
            <p className="text-sm text-ink-muted">
              {row.appliances.map((a) => a.name).join(", ") || "No appliance listed"}
              {level === "dob_differs" ? " · date of birth differs from the card" : ""}
            </p>
            <Button full variant={level === "dob_differs" ? "danger" : "primary"} loading={saving} onClick={() => onLink(row)}>
              This is them: add Aadhaar{card.dob ? " and date of birth" : ""} to this record
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Result({ outcome, digits, card, ready, saving, onEdit, onRetry, onReset, onSaveNew, onLink }: {
  outcome: MatchOutcome; digits: string; card: CardFields; ready: boolean; saving: boolean;
  onEdit: () => void; onRetry: () => void; onReset: () => void; onSaveNew: () => void; onLink: (r: LocalBeneficiary) => void;
}) {
  const start = canStartRegistration(outcome, { datasetReady: ready });
  const regHref = `/registration/new?aadhaar=${digits}${start === "draft_needs_verification" ? "&verify=1" : ""}`;
  const cardLine = `${card.name || "Name not read"}${card.dob ? ` · born ${card.dob}` : ""}`;

  if (outcome.kind === "confirmed_match") {
    return (
      <Card className="space-y-4">
        <p className="text-sm font-semibold text-ok-fg">Existing beneficiary found ({maskAadhaar(digits)})</p>
        <div>
          <p className="text-sm text-ink-muted">Reg. No.</p>
          <p className="text-4xl sm:text-5xl break-words font-extrabold tracking-tight text-teal-800">{outcome.row.reg_no ?? "Not assigned"}</p>
        </div>
        <p className="text-xl font-bold text-ink">{outcome.row.name}</p>
        <p className="text-sm text-ink-muted">On the card: {cardLine}</p>
        <Button href={`/distribution/profile?id=${outcome.row.id}`} size="lg" full>Open record</Button>
        <Button href="/attendance" variant="secondary" full>Go to Attendance</Button>
        <Button variant="ghost" full onClick={onReset}>Scan another</Button>
      </Card>
    );
  }
  if (outcome.kind === "already_registered") {
    return (
      <Card className="space-y-3">
        <h2 className="text-lg font-bold text-ink">Already registered</h2>
        <p className="text-ink-muted">{outcome.row.name} was registered with this Aadhaar. Do not register again.</p>
        <Button variant="ghost" full onClick={onReset}>Scan another</Button>
      </Card>
    );
  }
  if (outcome.kind === "candidates") {
    return (
      <Card className="space-y-4">
        <h2 className="text-lg font-bold text-ink">Verification required</h2>
        <p className="text-sm text-ink-muted">
          {outcome.pendingLocal
            ? "A registration with this Aadhaar is already saved on this device and waiting to sync."
            : "These people have an Aadhaar ending in the same 4 digits. Compare the name and Reg. No. with the card before continuing. Only the last 4 digits are kept on this device."}
        </p>
        <p className="text-sm text-ink-muted">On the card: {cardLine}</p>
        <ul className="space-y-2">{outcome.rows.map((c) => <CandidateRow key={c.id} c={c} />)}</ul>
        <Button variant="secondary" full onClick={onRetry}>Check again</Button>
        <Button variant="ghost" full onClick={onReset}>Scan another</Button>
      </Card>
    );
  }
  if (outcome.kind === "confirmed_no_match") {
    return (
      <Card className="space-y-4">
        <h2 className="text-lg font-bold text-ink">Not found by Aadhaar</h2>
        <p className="text-ink-muted">
          The server was checked and no record has Aadhaar {maskAadhaar(digits)}. On the card: <b>{cardLine}</b>.
        </p>
        <ListedWithoutAadhaar card={card} saving={saving} onLink={onLink} />
        <Button size="lg" full loading={saving} onClick={() => onSaveNew()}>Save as new member</Button>
        <p className="text-xs text-ink-muted">Saves the name, date of birth and other details read from the card. The Reg. No. is assigned later.</p>
        <Button href={regHref} variant="secondary" full>Register with disability document</Button>
        <Button href="/distribution" variant="secondary" full>Search by Reg. No. or name</Button>
        <Button variant="ghost" full onClick={onEdit}>Edit details</Button>
      </Card>
    );
  }
  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-bold text-warn-fg">Could not confirm</h2>
      <p role="alert" className="text-ink-muted">{INCONCLUSIVE_COPY[outcome.reason]}</p>
      <p className="text-sm text-ink-muted">On the card: {cardLine}</p>
      <ListedWithoutAadhaar card={card} saving={saving} onLink={onLink} />
      {start === "draft_needs_verification" && (
        <>
          <Button variant="secondary" full loading={saving} onClick={() => onSaveNew()}>
            Save as new member (will be re-checked for duplicates when online)
          </Button>
          <Button href={regHref} variant="ghost" full>Register with disability document</Button>
        </>
      )}
      <Button full onClick={onRetry}>Try again</Button>
      <Button href="/distribution" variant="secondary" full>Search by Reg. No. or name</Button>
      <Button variant="ghost" full onClick={onEdit}>Edit details</Button>
    </Card>
  );
}
