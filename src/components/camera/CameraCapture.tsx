"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compressImage } from "./compress";

/**
 * Full-screen handover photo capture.
 * 1) tries a live rear-camera preview via getUserMedia (needs HTTPS + permission);
 * 2) always offers the native camera app via <input type=file capture=environment>.
 * Preview step: Retake / Cancel / Submit. onSubmit receives a compressed JPEG (<= ~1.5MB).
 */
export function CameraCapture({
  title,
  onCancel,
  onSubmit,
  initialPhoto,
  onPhotoReady,
}: {
  title: string;
  onCancel: () => void;
  onSubmit: (jpeg: Blob) => void | Promise<void>;
  /** a photo taken earlier but never submitted (restored from the device) */
  initialPhoto?: Blob | null;
  /** called whenever the previewed photo changes (null after retake) so the caller can keep it safe */
  onPhotoReady?: (photo: Blob | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState(false);
  const [liveErr, setLiveErr] = useState<string | null>(() =>
    typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia
      ? "Live camera not available here - use the camera app button."
      : null,
  );
  const [photo, setPhoto] = useState<Blob | null>(initialPhoto ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLive(false);
  }, []);

  const startStream = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return; // message comes from the initial state
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      streamRef.current = s;
      setLiveErr(null);
      setLive(true);
    } catch {
      setLiveErr("Camera permission blocked - use the camera app button.");
    }
  }, []);

  // Initial start is inlined with promise callbacks (state is only set when the camera answers). Retry buttons use startStream.
  useEffect(() => {
    let dead = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((s) => {
        if (dead) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        setLive(true);
      })
      .catch(() => { if (!dead) setLiveErr("Camera permission blocked - use the camera app button."); });
    return () => { dead = true; stopStream(); };
  }, [stopStream]);

  useEffect(() => {
    if (live && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {});
    }
  }, [live, photo]);

  useEffect(() => {
    onPhotoReady?.(photo);
  }, [photo, onPhotoReady]);

  const url = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => {
    const u = url;
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [url]);

  async function accept(raw: Blob) {
    setBusy(true);
    setErr(null);
    try {
      setPhoto(await compressImage(raw));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.92));
    if (blob) await accept(blob);
  }

  async function submit() {
    if (!photo) return;
    setBusy(true);
    try {
      await onSubmit(photo);
      stopStream();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const cancel = () => {
    stopStream();
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="truncate text-sm font-semibold">{title}</p>
        <button onClick={cancel} className="rounded-lg px-3 py-2 text-sm font-semibold active:bg-white/20">
          Cancel
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {photo && url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Handover photo preview" className="h-full w-full object-contain" />
        ) : live ? (
          <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-white/80">
            {liveErr ?? "Starting camera..."}
          </div>
        )}
      </div>

      {err && <p className="bg-red-700 px-4 py-2 text-sm">{err}</p>}

      <div className="flex items-center justify-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        {photo ? (
          <>
            <button
              disabled={busy}
              onClick={() => {
                setPhoto(null);
                if (!live) void startStream();
              }}
              className="h-14 flex-1 rounded-xl bg-white/15 text-base font-semibold active:bg-white/25 disabled:opacity-50"
            >
              Retake
            </button>
            <button
              disabled={busy}
              onClick={submit}
              className="h-14 flex-[2] rounded-xl bg-emerald-500 text-base font-bold text-black active:bg-emerald-400 disabled:opacity-50"
            >
              {busy ? "Saving..." : "Submit"}
            </button>
          </>
        ) : (
          <>
            <button
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="h-14 flex-1 rounded-xl bg-white/15 text-sm font-semibold active:bg-white/25"
            >
              Camera app
            </button>
            {live && (
              <button
                disabled={busy}
                onClick={shoot}
                aria-label="Take photo"
                className="h-16 w-16 shrink-0 rounded-full border-4 border-white bg-white/90 active:bg-white disabled:opacity-50"
              />
            )}
            <button
              disabled={busy}
              onClick={() => (live ? stopStream() : void startStream())}
              className="h-14 flex-1 rounded-xl bg-white/15 text-sm font-semibold active:bg-white/25"
            >
              {live ? "Stop live" : "Live view"}
            </button>
          </>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void accept(f);
        }}
      />
    </div>
  );
}
