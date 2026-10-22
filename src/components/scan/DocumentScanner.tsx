"use client";

import { useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { prepareImage, readLocal, requestOcr, type PreparedImage } from "@/lib/ocr/client";
import { normalizeModelOutput } from "@/lib/ocr/normalize";
import type { OcrKind, OcrResult } from "@/lib/ocr/types";

export interface DocumentScannerProps {
  kind: OcrKind;
  /** Called with the validated OCR result and the preprocessed JPEG (for optional upload). */
  onResult: (result: OcrResult, image: Blob) => void;
  /** Optional: let the volunteer skip scanning and type details in. */
  onManual?: (image?: Blob) => void;
  title?: string;
}

type Phase = "idle" | "preparing" | "ready" | "reading" | "error";

const COPY: Record<OcrKind, { title: string; tip: string }> = {
  aadhaar: { title: "Aadhaar card", tip: "Lay the card flat and let it FILL the photo, with the QR code (the square on the card) and the 12-digit number sharp and large. Avoid glare and shadows. The photo only pre-fills the form; you confirm every field." },
  udid: { title: "UDID / disability document", tip: "Photograph the UDID card or enrolment acknowledgement. The photo only pre-fills the form; you confirm every field." },
};

export function DocumentScanner({ kind, onResult, onManual, title }: DocumentScannerProps) {
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [original, setOriginal] = useState<File | null>(null);
  const [turns, setTurns] = useState(0);
  const [img, setImg] = useState<PreparedImage | null>(null);
  const [err, setErr] = useState<{ message: string; retryable: boolean; code: string } | null>(null);
  const [localPct, setLocalPct] = useState<number | null>(null);

  async function prepare(file: File, t: number, autoRead: boolean) {
    setPhase("preparing"); setErr(null);
    try {
      const p = await prepareImage(file, t);
      setImg(p);
      setPhase("ready");
      if (autoRead && !p.quality.message) void read(p);
    } catch {
      setErr({ message: "Could not open that image. Please retake the photo.", retryable: false, code: "image" });
      setPhase("error");
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setOriginal(f); setTurns(0);
    void prepare(f, 0, true);
  }

  function rotate() {
    if (!original) return;
    const t = (turns + 1) % 4;
    setTurns(t);
    void prepare(original, t, false);
  }

  function retake() {
    setImg(null); setOriginal(null); setErr(null); setPhase("idle"); setLocalPct(null);
  }

  /**
   * Read ON THE DEVICE first (both Aadhaar and UDID/enrolment). If the key number was found, the image never leaves the
   * phone. The server reader (/api/ocr) is only a fallback. Every failure is "scan did not finish", never "not found".
   */
  async function read(p: PreparedImage | null = img) {
    if (!p) return;
    setPhase("reading"); setErr(null);
    const local = await runLocal(p);
    if (local.result && local.found) {
      onResult(local.result, p.blob);
      setPhase("ready");
      return;
    }
    const localNote = local.result ? "The on-device reader could not find the number." : "The on-device reader could not run.";
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (local.result) { // partial local text is still useful to pre-fill; staff review everything
        onResult(local.result, p.blob);
        setPhase("ready");
        return;
      }
      setErr({ message: `${localNote} The online reader needs a connection. Retake the photo (try the card flat and well lit) or type the details in.`, retryable: true, code: "network" });
      setPhase("error");
      return;
    }
    const out = await requestOcr(kind, p.dataUrl);
    if (out.ok) {
      onResult(out.result, p.blob);
      setPhase("ready");
      return;
    }
    if (out.code === "not_configured" && local.result) { // no online reader set up: use what the device read
      onResult(local.result, p.blob);
      setPhase("ready");
      return;
    }
    setErr({ message: out.code === "not_configured" ? `${localNote} The online reader is not set up on this server.` : out.message, retryable: out.retryable, code: out.code });
    setPhase("error");
  }

  async function runLocal(p: PreparedImage): Promise<{ result: OcrResult | null; found: boolean }> {
    setLocalPct(0);
    try {
      const r = await readLocal(kind, p.ocrBlob, setLocalPct, p.original); // full-resolution copies, not the stored one
      const result = normalizeModelOutput(r.raw, kind, 1);
      result.warnings.unshift("Read on this device. Check every field against the document.");
      for (const n of r.notes) result.warnings.push(n);
      if (r.rotatedTurns !== 0) result.warnings.push("The card was photographed sideways; it was turned automatically.");
      const key = kind === "aadhaar" ? "aadhaar_no" : "udid_no";
      if (!result.needsReview.includes(key)) result.needsReview.push(key);
      return { result, found: r.found };
    } catch {
      return { result: null, found: false };
    } finally {
      setLocalPct(null);
    }
  }

  async function readLocally() {
    if (!img) return;
    setPhase("reading"); setErr(null);
    const l = await runLocal(img);
    if (l.result) {
      onResult(l.result, img.blob);
      setPhase("ready");
    } else {
      setErr({ message: "The on-device reader could not run. Type the details in instead.", retryable: false, code: "local" });
      setPhase("error");
    }
  }

  const busy = phase === "preparing" || phase === "reading";
  const c = COPY[kind];

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink">{title ?? c.title}</h2>
        <p className="text-sm text-ink-muted mt-1">{c.tip}</p>
      </div>

      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} aria-label="Take photo" />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} aria-label="Upload image" />

      {img ? (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.dataUrl} alt="Document preview" className="w-full max-h-80 object-contain rounded-2xl border border-line bg-sage-100" />
          {img.quality.message && phase !== "reading" && (
            <p role="alert" className="rounded-2xl bg-warn-bg text-warn-fg px-4 py-3 text-sm font-semibold">
              {img.quality.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={rotate} disabled={busy}>Rotate</Button>
            <Button variant="secondary" onClick={retake} disabled={busy}>Retake</Button>
            <Button onClick={() => read()} loading={phase === "reading"} disabled={busy} className="flex-1">
              {phase === "reading"
                ? localPct !== null ? `Reading ${Math.round(localPct * 100)}%` : "Reading..."
                : phase === "error" && err?.retryable ? "Try again" : "Read details"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" onClick={() => camRef.current?.click()} loading={phase === "preparing"}>Take photo</Button>
          <Button size="lg" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>Upload</Button>
        </div>
      )}

      {err && (
        <div role="alert" className="rounded-2xl bg-bad-bg text-bad-fg px-4 py-3 text-sm space-y-2">
          <p className="font-semibold">{err.message}</p>
          <p>The scan did not finish. This does not mean the beneficiary is missing.</p>
          <div className="flex flex-wrap gap-2">
            {img && err.code !== "local" && (
              <Button variant="secondary" onClick={readLocally}>Use on-device reading anyway</Button>
            )}
            {onManual && <Button variant="ghost" onClick={() => onManual(img?.blob)}>Type details instead</Button>}
          </div>
        </div>
      )}

      {!err && onManual && !img && (
        <Button variant="ghost" onClick={() => onManual()} full>Skip and type details</Button>
      )}
    </Card>
  );
}
