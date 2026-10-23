"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compressImage, type PhotoKind } from "./compress";
import { cn } from "@/components/ui/cn";

export interface CaptureSubject {
  name: string;
  regNo?: string | null;
}

/**
 * Photo capture for a specific person. Two kinds:
 *  - "handover": the aid being handed over (rear camera, natural framing);
 *  - "profile":  the person's face (front camera, 3:4 portrait with a face guide).
 * The person's name and Reg. No. are shown the whole time (and again on the preview) so a photo can never be taken for
 * the wrong person unnoticed. The result is a high-quality JPEG (see compress.ts), never a visibly degraded one.
 *
 * Layout: full screen on a phone; a centred panel on a tablet/desktop so the viewfinder is never stretched.
 */
export function CaptureSheet({
  kind,
  subject,
  onCancel,
  onSubmit,
  initialPhoto,
  onPhotoReady,
}: {
  kind: PhotoKind;
  subject: CaptureSubject;
  onCancel: () => void;
  onSubmit: (jpeg: Blob) => void | Promise<void>;
  /** a photo taken earlier but never submitted (restored from the device) */
  initialPhoto?: Blob | null;
  /** called whenever the previewed photo changes (null after retake) so the caller can keep it safe */
  onPhotoReady?: (photo: Blob | null) => void;
}) {
  const profile = kind === "profile";
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<"user" | "environment">(profile ? "user" : "environment");
  const [live, setLive] = useState(false);
  const [ratio, setRatio] = useState(profile ? 3 / 4 : 4 / 3); // width / height of the viewfinder
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(initialPhoto ?? null);
  const [photoRatio, setPhotoRatio] = useState(profile ? 3 / 4 : 4 / 3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLive(false);
  }, []);

  const start = useCallback(
    async (mode: "user" | "environment") => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (!navigator.mediaDevices?.getUserMedia) {
        setLive(false);
        setLiveErr("The live camera needs a secure (https) page. Use the camera app button instead.");
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1920 } },
          audio: false,
        });
        streamRef.current = s;
        setLiveErr(null);
        setLive(true);
      } catch {
        setLive(false);
        setLiveErr("Camera permission is blocked. Allow the camera in the browser, or use the camera app button.");
      }
    },
    [],
  );

  // Start the live preview when the sheet opens (promise callbacks only: no state is set synchronously in the effect).
  useEffect(() => {
    let dead = false;
    if (!photo) {
      void Promise.resolve().then(() => start(facing)).then(() => { if (dead) stop(); });
    }
    return () => { dead = true; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (live && v && streamRef.current) {
      v.srcObject = streamRef.current;
      void v.play().catch(() => undefined);
    }
  }, [live, photo]);

  useEffect(() => { onPhotoReady?.(photo); }, [photo, onPhotoReady]);

  const url = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => {
    const u = url;
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [url]);

  async function accept(raw: Blob) {
    setBusy(true);
    setErr(null);
    try {
      const out = await compressImage(raw, kind);
      const bmp = await createImageBitmap(out).catch(() => null);
      if (bmp) { setPhotoRatio(bmp.width / bmp.height); bmp.close(); }
      setPhoto(out);
      stop();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    // capture exactly what the viewfinder shows (profile = centre 3:4 crop; handover = the whole frame)
    const vw = v.videoWidth, vh = v.videoHeight;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (profile) {
      const want = 3 / 4;
      if (vw / vh > want) { sw = Math.round(vh * want); sx = Math.round((vw - sw) / 2); }
      else { sh = Math.round(vw / want); sy = Math.round((vh - sh) / 2); }
    }
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    c.getContext("2d")!.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh); // not mirrored: the saved photo is the true image
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.95));
    if (blob) await accept(blob);
  }

  async function submit() {
    if (!photo) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(photo);
      stop();
    } catch (e) {
      setErr((e as Error).message || "Could not save the photo.");
      setBusy(false);
    }
  }

  function retake() {
    setPhoto(null);
    setErr(null);
    void start(facing);
  }

  function flip() {
    const next = facing === "user" ? "environment" : "user";
    setFacing(next);
    void start(next);
  }

  const cancel = () => { stop(); onCancel(); };
  const boxRatio = photo ? photoRatio : ratio;
  const mirror = live && !photo && facing === "user";

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/80 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={profile ? "Take profile photo" : "Take handover photo"}>
      <div className="flex h-dvh w-full flex-col overflow-hidden bg-neutral-950 text-white sm:h-[min(92dvh,56rem)] sm:max-w-2xl sm:rounded-3xl sm:shadow-pop">
        {/* who this photo is for: always visible */}
        <header className="flex items-center gap-3 border-b border-white/10 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wider text-teal-300">{profile ? "Profile photo for" : "Handover photo for"}</p>
            <p className="truncate text-lg font-extrabold">{subject.name}</p>
          </div>
          {subject.regNo ? (
            <span className="shrink-0 rounded-xl bg-white px-3 py-1.5 text-lg font-extrabold text-ink" aria-label={`Reg. No. ${subject.regNo}`}>{subject.regNo}</span>
          ) : null}
          <button onClick={cancel} aria-label="Cancel" className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-xl active:bg-white/25">&times;</button>
        </header>

        {/* viewfinder / preview, kept at the true shape of the photo */}
        <div className="min-h-0 flex-1 bg-black" style={{ containerType: "size" }}>
          <div className="grid h-full w-full place-items-center">
            <div
              className="relative overflow-hidden rounded-2xl bg-neutral-900"
              style={{ aspectRatio: String(boxRatio), width: `min(100cqw, calc(100cqh * ${boxRatio}))`, maxWidth: "100%" }}
            >
              {photo && url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={`Photo for ${subject.name}`} className="h-full w-full object-contain" />
              ) : live ? (
                <>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      if (!profile && v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
                    }}
                    className={cn("h-full w-full object-cover", mirror && "-scale-x-100")}
                  />
                  {profile && (
                    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden>
                      <ellipse cx="150" cy="170" rx="100" ry="135" fill="none" stroke="rgba(255,255,255,.85)" strokeWidth="3" strokeDasharray="10 8" />
                    </svg>
                  )}
                  <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm font-semibold text-white drop-shadow">
                    {profile ? "Centre the face inside the oval" : "Show the aid and the person clearly"}
                  </p>
                </>
              ) : (
                <div className="grid h-full w-full place-items-center p-6 text-center text-white/80">
                  {liveErr ?? "Starting the camera..."}
                </div>
              )}
            </div>
          </div>
        </div>

        {err && <p role="alert" className="bg-bad-fg px-4 py-2 text-sm font-semibold">{err}</p>}

        <footer className="border-t border-white/10 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {photo ? (
            <div className="space-y-2">
              <p className="text-center text-sm text-white/80">Is this <b className="text-white">{subject.name}</b>{subject.regNo ? ` (Reg. No. ${subject.regNo})` : ""}? Check the photo is clear.</p>
              <div className="flex gap-3">
                <button disabled={busy} onClick={retake} className="min-h-14 flex-1 rounded-2xl bg-white/15 text-base font-bold active:bg-white/25 disabled:opacity-50">Retake</button>
                <button disabled={busy} onClick={submit} className="min-h-14 flex-[2] rounded-2xl bg-teal-400 text-base font-extrabold text-ink active:bg-teal-300 disabled:opacity-50">
                  {busy ? "Saving..." : "Save photo"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <button disabled={busy} onClick={() => fileRef.current?.click()} className="min-h-14 flex-1 rounded-2xl bg-white/15 px-2 text-sm font-bold active:bg-white/25">
                Camera app
              </button>
              <button
                disabled={busy || !live}
                onClick={() => void shoot()}
                aria-label="Take photo"
                className="size-[4.5rem] shrink-0 rounded-full border-[5px] border-white bg-white/90 shadow-lg active:scale-95 active:bg-white disabled:opacity-40"
              />
              <button disabled={busy} onClick={flip} className="min-h-14 flex-1 rounded-2xl bg-white/15 px-2 text-sm font-bold active:bg-white/25">
                {facing === "user" ? "Rear camera" : "Front camera"}
              </button>
            </div>
          )}
        </footer>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture={profile ? "user" : "environment"}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void accept(f);
          }}
        />
      </div>
    </div>
  );
}
