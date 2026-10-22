"use client";
// Browser-side helpers: image preprocessing, quality hint, /api/ocr call, tesseract fallback.
import { extractAadhaarFromText } from "./verhoeff";
import { extractUdid } from "@/lib/udid";
import { parseUdidText } from "./udid-parse";
import { parseAadhaarText } from "./aadhaar-parse";
import type { OcrKind, OcrResponse, OcrResult } from "./types";

export interface QualityHint {
  blurry: boolean;
  dark: boolean;
  glare: boolean;
  /** human message when the volunteer should retake, else null */
  message: string | null;
}

export interface PreparedImage {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  quality: QualityHint;
}

const MAX_EDGE = 1600;

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image" applies EXIF orientation
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img; // browsers apply EXIF orientation to <img> by default
  } finally {
    // keep URL alive until drawn: revoke after microtask by caller not needed for small usage
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function sizeOf(src: ImageBitmap | HTMLImageElement) {
  return src instanceof HTMLImageElement
    ? { w: src.naturalWidth, h: src.naturalHeight }
    : { w: src.width, h: src.height };
}

/** Blur (Laplacian variance), brightness and glare estimate on a small grayscale copy. */
export function estimateQuality(data: ImageData): QualityHint {
  const { width: w, height: h, data: px } = data;
  const g = new Float32Array(w * h);
  let sum = 0, hot = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    g[j] = y; sum += y;
    if (y > 250) hot++;
  }
  const mean = sum / g.length;
  let acc = 0, accSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      acc += lap; accSq += lap * lap; n++;
    }
  }
  const variance = n ? accSq / n - (acc / n) ** 2 : 0;
  const blurry = variance < 40; // heuristic on a ~640px copy
  const dark = mean < 70;
  const glare = hot / g.length > 0.08;
  let message: string | null = null;
  if (blurry) message = "This photo looks blurry. Hold the phone steady and retake, or continue and check every field carefully.";
  else if (dark) message = "This photo is too dark. Move to better light and retake.";
  else if (glare) message = "There is glare on the card. Tilt it slightly to avoid reflections and retake.";
  return { blurry, dark, glare, message };
}

/** Auto-orient (EXIF), optional extra rotation, downscale to ~1600px, mild contrast stretch, JPEG 0.85. */
export async function prepareImage(file: Blob, rotateQuarterTurns = 0): Promise<PreparedImage> {
  const src = await loadBitmap(file);
  const { w, h } = sizeOf(src);
  const turns = ((rotateQuarterTurns % 4) + 4) % 4;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const dw = Math.round(w * scale), dh = Math.round(h * scale);
  const [cw, ch] = turns % 2 ? [dh, dw] : [dw, dh];

  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch);
  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src as CanvasImageSource, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  if ("close" in src) src.close();

  // quality estimate on a small copy (before contrast tweak)
  const q = document.createElement("canvas");
  const qs = Math.min(1, 640 / Math.max(cw, ch));
  q.width = Math.max(8, Math.round(cw * qs)); q.height = Math.max(8, Math.round(ch * qs));
  const qctx = q.getContext("2d", { willReadFrequently: true })!;
  qctx.drawImage(canvas, 0, 0, q.width, q.height);
  const quality = estimateQuality(qctx.getImageData(0, 0, q.width, q.height));

  // mild contrast: stretch between 1st and 99th luminance percentile (bounded so it stays gentle)
  try {
    const img = ctx.getImageData(0, 0, cw, ch);
    const d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 16) hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
    const total = hist.reduce((a, b) => a + b, 0);
    let lo = 0, hi = 255, c = 0;
    for (let i = 0; i < 256; i++) { c += hist[i]; if (c > total * 0.01) { lo = i; break; } }
    c = 0;
    for (let i = 255; i >= 0; i--) { c += hist[i]; if (c > total * 0.01) { hi = i; break; } }
    lo = Math.min(lo, 60); hi = Math.max(hi, 195);
    const range = hi - lo;
    if (range > 20 && range < 235) {
      const k = 255 / range;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.max(0, Math.min(255, (d[i] - lo) * k));
        d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] - lo) * k));
        d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] - lo) * k));
      }
      ctx.putImageData(img, 0, 0);
    }
  } catch { /* tainted/unsupported: skip */ }

  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.85),
  );
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { blob, dataUrl, width: cw, height: ch, quality };
}

export type OcrCallOutcome =
  | { ok: true; result: OcrResult }
  | { ok: false; code: string; message: string; retryable: boolean };

/** Calls /api/ocr. Network failure is reported as an error, never as "not found". */
export async function requestOcr(kind: OcrKind, dataUrl: string): Promise<OcrCallOutcome> {
  try {
    const res = await fetch("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, image: dataUrl.split(",")[1], mimeType: "image/jpeg" }),
    });
    let body: OcrResponse | null = null;
    try { body = (await res.json()) as OcrResponse; } catch { /* not json (e.g. redirect to login) */ }
    if (body?.ok) return { ok: true, result: body.result };
    if (body && !body.ok) {
      return { ok: false, code: body.error.code, message: body.error.message,
        retryable: !["not_configured", "unauthorized", "bad_request"].includes(body.error.code) };
    }
    return { ok: false, code: "upstream_error", message: "The scan service did not respond properly.", retryable: true };
  } catch {
    return { ok: false, code: "network", message: "No connection. Check the network and retry, or type the details in.", retryable: true };
  }
}

async function rotateBlob(src: Blob, quarterTurns: 1 | 3): Promise<Blob> {
  const bmp = await createImageBitmap(src);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.height;
  canvas.height = bmp.width;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((quarterTurns * Math.PI) / 2);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  bmp.close?.();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("rotate failed"))), "image/jpeg", 0.9));
}

export interface LocalRead {
  raw: Record<string, { value: string | null; confidence: number } | number>;
  /** the key identifier (valid Aadhaar number / UDID or enrolment number) was found */
  found: boolean;
  rotatedTurns: 0 | 1 | 3;
}

/**
 * On-device OCR (tesseract.js). The worker, WASM core and English data are served from /tesseract (copied at build
 * time), so after the first load no network is needed. Cards are often photographed sideways, so it tries 0, 90 and
 * 270 degrees and stops as soon as the key number is found. Text is never logged or sent anywhere.
 */
const workerOptions = (logger?: (m: { status: string; progress: number }) => void) => ({
  workerPath: "/tesseract/worker.min.js",
  corePath: "/tesseract",
  langPath: "/tesseract/lang",
  gzip: true,
  ...(logger ? { logger } : {}),
});

/**
 * Load the on-device reader once while online and run it on a blank image. That makes the service worker store the exact
 * engine files this phone needs (the right WASM build is chosen by the phone), so scanning also works the first time the
 * phone is offline. Resolves true when the engine ran.
 */
export async function warmOcrEngine(): Promise<boolean> {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, workerOptions());
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 64, 64);
      const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/png"));
      await worker.recognize(blob);
      return true;
    } finally {
      await worker.terminate();
    }
  } catch {
    return false;
  }
}

export async function readLocal(
  kind: OcrKind,
  image: Blob,
  onProgress?: (p: number) => void,
): Promise<LocalRead> {
  const { createWorker } = await import("tesseract.js");
  let step = 0;
  const worker = await createWorker("eng", 1, workerOptions((m) => {
    if (m.status === "recognizing text") onProgress?.((step + m.progress) / 3);
  }));
  try {
    let best: { score: number; text: string; turns: 0 | 1 | 3; img: Blob } | null = null;
    for (const turns of [0, 1, 3] as const) {
      step = turns === 0 ? 0 : turns === 1 ? 1 : 2;
      const img = turns === 0 ? image : await rotateBlob(image, turns);
      const { data } = await worker.recognize(img);
      const hit = kind === "aadhaar" ? parseAadhaarText(data.text).found : !!extractUdid(data.text);
      const score = (hit ? 1000 : 0) + data.confidence;
      if (!best || score > best.score) best = { score, text: data.text, turns, img };
      if (hit) break;
    }
    const b = best!;
    if (kind === "aadhaar") {
      const parsed = parseAadhaarText(b.text);
      let { found } = parsed;
      if (!parsed.number.valid) {
        // second pass over digits only, to rescue the number; the other fields keep coming from the full-text pass
        await worker.setParameters({ tessedit_char_whitelist: "0123456789 ", tessedit_pageseg_mode: "11" as never });
        const alt = extractAadhaarFromText((await worker.recognize(b.img)).data.text);
        if (alt.valid || !parsed.number.value) {
          parsed.raw.aadhaar_no = { value: alt.value, confidence: alt.valid ? 0.7 : alt.value ? 0.2 : 0 };
          found = found || alt.valid;
        }
      }
      return { found, rotatedTurns: b.turns, raw: parsed.raw };
    }
    return { ...parseUdidText(b.text), rotatedTurns: b.turns };
  } finally {
    await worker.terminate();
  }
}
