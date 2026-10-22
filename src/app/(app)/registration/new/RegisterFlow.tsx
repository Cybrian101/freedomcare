"use client";

import { useEffect, useRef, useState } from "react";
import { deleteDraft, loadDraft, saveDraft } from "@/lib/local-db";
import { useSync } from "@/components/SyncProvider";
import { submitRegistration } from "@/lib/offline-queue";
import { checkAadhaar } from "@/lib/aadhaar-check";
import { useSearchParams } from "next/navigation";
import { Button, Card, PageHeader, Stepper, useToast } from "@/components/ui";
import { DocumentScanner } from "@/components/scan/DocumentScanner";
import { ConfidenceField } from "@/components/scan/ConfidenceField";
import { ProfilePhotoPicker } from "@/components/desk/ProfilePhotoPicker";
import { blobToBase64 } from "@/lib/photo-data";
import { makeThumbnail } from "@/components/camera/compress";
import { createClient } from "@/lib/supabase/client";
import { formatAadhaar } from "@/lib/aadhaar";
import { normalizeUdid } from "@/lib/udid";
import { digitsOnly, isValidAadhaar } from "@/lib/ocr/verhoeff";
import type { OcrField, OcrResult } from "@/lib/ocr/types";

const STEPS = ["Aadhaar", "Disability doc", "Review"];

const FORM_KEYS = [
  "aadhaar_no", "name", "gender", "dob", "yob", "care_of", "address", "pincode", "district", "state",
  "vid", "phone", "email", "udid_no", "udid_label", "disability_type", "disability_pct",
] as const;
type FormKey = (typeof FORM_KEYS)[number];
type Form = Record<FormKey, string>;

const EMPTY: Form = Object.fromEntries(FORM_KEYS.map((k) => [k, ""])) as Form;

const LABELS: Record<FormKey, string> = {
  aadhaar_no: "Aadhaar number", name: "Name", gender: "Gender", dob: "Date of birth (YYYY-MM-DD)",
  yob: "Year of birth", care_of: "Care of (S/O, D/O, W/O, C/O)", address: "Address", pincode: "Pincode",
  district: "District", state: "State", vid: "VID (16 digits)", phone: "Phone", email: "Email",
  udid_no: "UDID / enrolment number", udid_label: "Number is called (as printed)",
  disability_type: "Disability type", disability_pct: "Disability %",
};

export function RegisterFlow() {
  const params = useSearchParams();
  const toast = useToast();
  const { items, retryItem } = useSync();
  const verify = params.get("verify") === "1";
  const [carried, setCarried] = useState(false);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(() => ({ ...EMPTY }));
  const [meta, setMeta] = useState<Partial<Record<FormKey, OcrField>>>({});
  const [review, setReview] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<Partial<Record<FormKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [dupMsg, setDupMsg] = useState<{ text: string; href?: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const blobs = useRef<{ aadhaar?: Blob; udid?: Blob; profile?: Blob }>({});
  const [profilePhoto, setProfilePhoto] = useState<Blob | null>(null);
  const DRAFT = "registration";
  // null = still checking the device; "none" = nothing to resume / decision made
  const [resume, setResume] = useState<{ name: string; at: number } | "none" | null>(null);
  const restored = useRef<{ form: Form; step: number; blobs?: { aadhaar?: Blob; udid?: Blob } } | null>(null);

  // Details carried over from the scan screen. They travel in this tab's session storage, NOT in the address: a URL with an
  // Aadhaar number in it would end up in browser history and in server logs.
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const raw = sessionStorage.getItem("fc.prefill");
        if (!raw) return;
        sessionStorage.removeItem("fc.prefill");
        const p = JSON.parse(raw) as { aadhaar?: string; name?: string; dob?: string };
        const a = digitsOnly(p.aadhaar);
        setForm((f) => ({ ...f, aadhaar_no: a.length === 12 ? formatAadhaar(a) : f.aadhaar_no, name: f.name || p.name || "", dob: f.dob || p.dob || "" }));
        if (a.length === 12) setCarried(true);
      } catch { /* nothing carried over */ }
    });
  }, []);

  // Offer to continue an unfinished registration found on this device.
  useEffect(() => {
    let dead = false;
    void loadDraft(DRAFT).then((d) => {
      if (dead) return;
      const f = d?.data?.form as Form | undefined;
      if (d && f && (f.name || f.aadhaar_no)) {
        restored.current = { form: f, step: Number(d.data.step) || 0, blobs: d.blobs as { aadhaar?: Blob; udid?: Blob } | undefined };
        setResume({ name: f.name || "unnamed", at: d.savedAt });
      } else setResume("none");
    });
    return () => { dead = true; };
  }, []);

  // Autosave every change (debounced) so a refresh, crash or locked phone loses nothing.
  useEffect(() => {
    if (resume !== "none" || savedId) return;
    if (!form.name && !form.aadhaar_no && step === 0 && !blobs.current.aadhaar && !blobs.current.udid) return;
    const t = setTimeout(() => {
      void saveDraft(DRAFT, { form, step }, blobs.current as Record<string, Blob>).catch(() => undefined);
    }, 600);
    return () => clearTimeout(t);
  }, [form, step, resume, savedId]);

  function applyResult(r: OcrResult) {
    const set = (k: FormKey, v: string, overwrite: boolean) =>
      setForm((f) => (overwrite || !f[k] ? { ...f, [k]: v } : f));
    const m: Partial<Record<FormKey, OcrField>> = {};
    for (const [k, f] of Object.entries(r.fields)) {
      if (!(FORM_KEYS as readonly string[]).includes(k)) continue;
      const key = k as FormKey;
      if (f.value !== null) set(key, key === "aadhaar_no" ? formatAadhaar(f.value) : f.value, r.kind === "aadhaar" || key.startsWith("udid") || key.startsWith("disability"));
      m[key] = f;
    }
    setMeta((p) => ({ ...p, ...m }));
    setReview((p) => new Set([...p, ...r.needsReview.filter((k) => (FORM_KEYS as readonly string[]).includes(k))]));
    setWarnings((p) => [...p, ...r.warnings]);
  }

  function edit(k: FormKey, v: string) {
    setForm((f) => ({ ...f, [k]: k === "aadhaar_no" ? formatAadhaar(v) : v }));
    setReview((p) => { const n = new Set(p); n.delete(k); return n; });
    setErrors((e) => ({ ...e, [k]: undefined }));
    setDupMsg(null);
  }

  function validate(): boolean {
    const e: Partial<Record<FormKey, string>> = {};
    const a = digitsOnly(form.aadhaar_no);
    if (!form.name.trim()) e.name = "Name is required";
    if (a && !isValidAadhaar(a)) e.aadhaar_no = "Not a valid Aadhaar number (12 digits, passes the check). Compare with the card.";
    if (form.pincode && !/^\d{6}$/.test(form.pincode)) e.pincode = "6 digits";
    if (form.phone && !/^[6-9]\d{9}$/.test(digitsOnly(form.phone))) e.phone = "10-digit mobile number";
    if (form.vid && !/^\d{16}$/.test(digitsOnly(form.vid))) e.vid = "16 digits";
    if (form.yob && !/^(19|20)\d{2}$/.test(form.yob)) e.yob = "4-digit year";
    if (form.dob && !/^\d{4}-\d{2}-\d{2}$/.test(form.dob)) e.dob = "Use YYYY-MM-DD";
    if (form.disability_pct && !(Number(form.disability_pct) >= 0 && Number(form.disability_pct) <= 100)) e.disability_pct = "0 to 100";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    setSaveErr(null); setDupMsg(null);
    if (!validate()) return;
    setSaving(true);
    try {
      const aadhaar = digitsOnly(form.aadhaar_no) || null;
      const udid = form.udid_no.trim() ? normalizeUdid(form.udid_no) : null;

      // Best-effort duplicate check while online. If it cannot run (offline / server error) we still save the
      // registration on the device; the server's unique constraints re-check it on sync and park a conflict
      // for review instead of creating a second person.
      if (navigator.onLine && aadhaar) {
        try {
          const d = await checkAadhaar(createClient(), aadhaar);
          if (d.roster) {
            setDupMsg({ text: `This Aadhaar is already in the camp list: ${d.roster.name} (Reg. No. ${d.roster.reg_no ?? "n/a"}). Use the camp record instead of registering again.`, href: `/distribution/profile?id=${d.roster.id}` });
            return;
          }
          if (d.registered) { setDupMsg({ text: `This Aadhaar is already registered (${d.registered.name}).` }); return; }
        } catch { /* fall through to verify-on-sync */ }
      }

      const payload = {
        name: form.name.trim(),
        aadhaar_name: aadhaar ? form.name.trim() : null,
        aadhaar_no: aadhaar,
        gender: form.gender || null,
        dob: form.dob || null,
        yob: form.yob ? Number(form.yob) : null,
        care_of: form.care_of || null,
        address: form.address || null,
        pincode: form.pincode || null,
        district: form.district || null,
        state: form.state || null,
        vid: digitsOnly(form.vid) || null,
        phone: digitsOnly(form.phone) || null,
        email: form.email || null,
        udid_no: udid,
        udid_label: form.udid_label || null,
        disability_type: form.disability_type || null,
        disability_pct: form.disability_pct ? Number(form.disability_pct) : null,
        source: "registered" as const,
      };
      // Persist to IndexedDB FIRST. "Saved" below means "safe on this device", not "on the server".
      // The id is fixed now, so the photo's storage path is tied to THIS new person.
      const newId = crypto.randomUUID();
      const docs = { ...blobs.current, ...(profilePhoto ? { profile: profilePhoto } : {}) };
      const thumb = profilePhoto ? await blobToBase64(await makeThumbnail(profilePhoto)).catch(() => null) : null;
      const item = await submitRegistration({ id: newId, name: payload.name, payload: { ...payload, profile_photo_path: profilePhoto ? `${newId}/profile.jpg` : null, profile_thumb: thumb }, docs });
      setSavedId(item.id);
      await deleteDraft(DRAFT); // now in the sync queue
      toast("Saved on this device", "ok");
    } catch {
      setSaveErr("Could not save on this device (storage may be full or blocked). Nothing was submitted; free up space and try again.");
    } finally {
      setSaving(false);
    }
  }

  function again() {
    void deleteDraft(DRAFT);
    setForm({ ...EMPTY }); setMeta({}); setReview(new Set()); setWarnings([]); setErrors({});
    setSavedId(null); setDupMsg(null); blobs.current = {}; setProfilePhoto(null); setStep(0);
  }

  const field = (k: FormKey, extra: Partial<React.ComponentProps<typeof ConfidenceField>> = {}) => (
    <ConfidenceField key={k} label={LABELS[k]} value={form[k]} onChange={(v) => edit(k, v)}
      meta={meta[k]} needsReview={review.has(k)} error={errors[k]} {...extra} />
  );

  if (savedId) {
    const q = items.find((i) => i.id === savedId);
    const confirmed = q?.status === "synced";
    const rejected = q?.status === "rejected";
    return (
      <div className="mx-auto w-full max-w-xl space-y-4">
        <Card className="space-y-4 text-center">
          <h1 className={`text-2xl font-extrabold ${confirmed ? "text-ok-fg" : rejected ? "text-bad-fg" : "text-info-fg"}`}>
            {confirmed ? "Registered" : rejected ? "Needs review" : "Saved on this device - awaiting sync"}
          </h1>
          <p className="text-ink-muted">
            {confirmed
              ? `${form.name} is confirmed on the server.`
              : rejected
                ? q?.lastError ?? "The server refused this registration."
                : `${form.name} will be sent automatically when the connection allows. It is not confirmed until then.`}
          </p>
          {!confirmed && !rejected && q && (
            <Button variant="secondary" full onClick={() => retryItem(q.id)}>Retry now</Button>
          )}
          <Button full size="lg" onClick={again}>Register another</Button>
        </Card>
      </div>
    );
  }

  if (resume && resume !== "none") {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4">
        <Card className="space-y-3">
          <h1 className="text-lg font-extrabold text-ink">Unfinished registration found</h1>
          <p className="text-ink-muted">
            {resume.name} - saved on this device at {new Date(resume.at).toLocaleTimeString("en-IN", { timeStyle: "short" })}.
          </p>
          <Button full size="lg" onClick={() => {
            const r = restored.current!;
            setForm(r.form); setStep(r.step); blobs.current = r.blobs ?? {};
            setResume("none");
          }}>Continue where I left off</Button>
          <Button full variant="secondary" onClick={() => { void deleteDraft(DRAFT); setResume("none"); }}>Discard and start new</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <PageHeader title="Register beneficiary" subtitle="Scanning pre-fills the form. You confirm every field." />
      {verify && (
        <p role="status" className="rounded-2xl bg-warn-bg text-warn-fg px-4 py-3 text-sm font-semibold">
          Draft: this person could not be checked against the server. It will be re-checked for duplicates when synced and held for review if it matches someone.
        </p>
      )}
      <Stepper steps={STEPS} current={step} />

      {step === 0 && (
        <>
          <DocumentScanner kind="aadhaar"
            onResult={(r, blob) => { blobs.current.aadhaar = blob; applyResult(r); setStep(1); }}
            onManual={() => setStep(1)} />
          {carried && <p className="text-sm text-ink-muted">Aadhaar number carried over from the scan screen.</p>}
        </>
      )}

      {step === 1 && (
        <>
          <DocumentScanner kind="udid"
            onResult={(r, blob) => { blobs.current.udid = blob; applyResult(r); setStep(2); }}
            onManual={() => setStep(2)} />
          <Button variant="ghost" full onClick={() => setStep(2)}>No disability document - skip</Button>
          <Button variant="ghost" full onClick={() => setStep(0)}>Back</Button>
        </>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {review.size > 0 && (
            <p role="status" className="rounded-2xl bg-warn-bg text-warn-fg px-4 py-3 text-sm font-semibold">
              Highlighted fields could not be read reliably. Check them against the documents before saving.
            </p>
          )}
          {warnings.length > 0 && (
            <ul className="text-sm text-warn-fg bg-warn-bg rounded-2xl px-4 py-3 list-disc list-inside">
              {[...new Set(warnings)].slice(0, 5).map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <Card className="space-y-3">
            <h2 className="font-bold text-ink">Profile photo</h2>
            <ProfilePhotoPicker name={form.name} photo={profilePhoto} onChange={setProfilePhoto} />
          </Card>
          <Card className="space-y-4">
            <h2 className="font-bold text-ink">Identity</h2>
            {field("aadhaar_no", { inputMode: "numeric", placeholder: "0000 0000 0000" })}
            {field("name", { required: true })}
            {field("gender")}
            {field("dob", { placeholder: "YYYY-MM-DD" })}
            {field("yob", { inputMode: "numeric", maxLength: 4 })}
            {field("care_of")}
            {field("phone", { inputMode: "tel" })}
            {field("email")}
          </Card>
          <Card className="space-y-4">
            <h2 className="font-bold text-ink">Address</h2>
            {field("address", { multiline: true })}
            {field("pincode", { inputMode: "numeric", maxLength: 6 })}
            {field("district")}
            {field("state")}
            {field("vid", { inputMode: "numeric" })}
          </Card>
          <Card className="space-y-4">
            <h2 className="font-bold text-ink">Disability document</h2>
            {field("udid_no")}
            {field("udid_label")}
            {field("disability_type")}
            {field("disability_pct", { inputMode: "numeric", maxLength: 3 })}
          </Card>

          {dupMsg && (
            <div role="alert" className="rounded-2xl bg-bad-bg text-bad-fg px-4 py-3 space-y-2">
              <p className="font-semibold">{dupMsg.text}</p>
              {dupMsg.href && <Button href={dupMsg.href} variant="secondary">Open camp record</Button>}
            </div>
          )}
          {saveErr && <p role="alert" className="rounded-2xl bg-bad-bg text-bad-fg px-4 py-3 font-semibold">{saveErr}</p>}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(0)} disabled={saving}>Rescan</Button>
            <Button className="flex-1" size="lg" onClick={save} loading={saving}>{verify ? "Save draft on this device" : "Save registration"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
