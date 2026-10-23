"use client";
// Browser-side helpers: image preparation, quality hint, the on-device reader (tesseract.js + QR) and the online fallback.
// Card photos are read here and dropped: they are never stored (not on the phone, not on the server).
import { extractAadhaarFromText, suggestAadhaarFixes, formatAadhaar } from "./verhoeff";
import { extractUdid } from "@/lib/udid";
import { parseUdidText } from "./udid-parse";
import { nameAnchor, parseAadhaarText, strongName } from "./aadhaar-parse";
import { readAadhaarQr } from "./qr-read";
import { binarizeBlob, canvasBlob, cropBlob, transformBlob } from "./image-ops";
import type { AadhaarQr } from "./aadhaar-qr";
import type { OcrKind, OcrResponse, OcrResult } from "./types";

export interface QualityHint {
  blurry: boolean;
  dark: boolean;
  glare: boolean;
  /** human message when the volunteer should retake, else null */
  message: string | null;
}

/**
 * The online reader (/api/ocr, Gemini) sends the card image to Google. Switched OFF: cards are read on the phone only.
 * Turning it on again is a decision for the camp organisers, not a code change to make casually.
 */
export const ONLINE_READER = false;

export interface PreparedImage {
  /** copy for the on-device reader: up to 2600 px with the contrast gently stretched */
  ocrBlob: Blob;
  /** the photo exactly as taken (full size): the QR code is read from this, never from a shrunken copy */
  original: Blob;
  /** about 1600 px: preview on screen and the image sent to the online reader */
  dataUrl: string;
  width: number;
  height: number;
  quality: QualityHint;
}

// The reader needs letters roughly 30 px tall. A phone photo of a card is 3000-4000 px wide, so shrinking it to 1600 px
// (as an earlier version did) left the digits too small to read. Keep the pixels for reading.
const READ_EDGE = 2600;
const SHOW_EDGE = 1600;

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

/** Auto-orient (EXIF), optional extra rotation, then make the reading copy and the preview. Nothing here is kept. */
export async function prepareImage(file: Blob, rotateQuarterTurns = 0): Promise<PreparedImage> {
  const src = await loadBitmap(file);
  const { w, h } = sizeOf(src);
  const turns = ((rotateQuarterTurns % 4) + 4) % 4;
  const scale = Math.min(1, READ_EDGE / Math.max(w, h));
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

  // quality estimate on a small copy
  const q = document.createElement("canvas");
  const qs = Math.min(1, 640 / Math.max(cw, ch));
  q.width = Math.max(8, Math.round(cw * qs)); q.height = Math.max(8, Math.round(ch * qs));
  const qctx = q.getContext("2d", { willReadFrequently: true })!;
  qctx.drawImage(canvas, 0, 0, q.width, q.height);
  const quality = estimateQuality(qctx.getImageData(0, 0, q.width, q.height));

  // 1) the copy for reading: mild contrast stretch between the 1st and 99th luminance percentile (bounded, gentle)
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
  } catch { /* unsupported: read the natural copy */ }
  const ocrBlob = await canvasBlob(canvas, 0.93);

  // 2) preview + online-reader copy
  const ss = Math.min(1, SHOW_EDGE / Math.max(cw, ch));
  const s = document.createElement("canvas");
  s.width = Math.round(cw * ss); s.height = Math.round(ch * ss);
  s.getContext("2d")!.drawImage(canvas, 0, 0, s.width, s.height);
  const dataUrl = s.toDataURL("image/jpeg", 0.85);
  return { ocrBlob, original: file, dataUrl, width: cw, height: ch, quality };
}

export type OcrCallOutcome =
  | { ok: true; result: OcrResult }
  | { ok: false; code: string; message: string; retryable: boolean };

/** Calls /api/ocr. Network failure is reported as an error, never as "not found". */
export async function requestOcr(kind: OcrKind, dataUrl: string): Promise<OcrCallOutcome> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25_000); // a dead connection must not leave the screen waiting
    const res = await fetch("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, image: dataUrl.split(",")[1], mimeType: "image/jpeg" }),
      signal: ctl.signal,
    }).finally(() => clearTimeout(timer));
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

export interface LocalRead {
  raw: Record<string, { value: string | null; confidence: number } | number>;
  /** the key identifier (valid Aadhaar number / UDID or enrolment number) was found */
  found: boolean;
  rotatedTurns: 0 | 1 | 2 | 3;
  /** plain-language notes for the person scanning (what was read from the QR, what was corrected, what to check) */
  notes: string[];
}

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
      await worker.recognize(await canvasBlob(c, 0.9, "image/png"));
      return true;
    } finally {
      await worker.terminate();
    }
  } catch {
    return false;
  }
}

type Worker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;
type Box = { x0: number; y0: number; x1: number; y1: number };
type Line = { text: string; bbox: Box; confidence?: number };
type Page = { data: { text: string; confidence: number; blocks?: { paragraphs?: { lines?: Line[] }[] }[] | null } };

const lineBoxes = (page: Page) => {
  const out: Line[] = [];
  for (const b of page.data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) out.push({ text: l.text, bbox: l.bbox, confidence: l.confidence });
  return out;
};

/**
 * Cards are often photographed sideways. Find the right way up on a SMALL copy (fast), so the slow full-resolution read is
 * done once, not three times. Returns the full-size image already turned the right way.
 */
async function turnUpright(worker: Worker, image: Blob, isHit: (text: string) => boolean): Promise<{ img: Blob; turns: 0 | 1 | 2 | 3; hit: boolean }> {
  const small = await transformBlob(image, { maxEdge: 1100 }, 0.85);
  let best: { score: number; turns: 0 | 1 | 2 | 3; hit: boolean } | null = null;
  for (const turns of [0, 1, 3, 2] as const) { // sideways is common; upside down is tried last
    const probe = turns === 0 ? small : await transformBlob(small, { turns }, 0.85);
    const { data } = await worker.recognize(probe);
    const hit = isHit(data.text);
    const score = (hit ? 1000 : 0) + data.confidence;
    if (!best || score > best.score) best = { score, turns, hit };
    if (hit) break;
  }
  const b = best!;
  return { img: b.turns === 0 ? image : await transformBlob(image, { turns: b.turns }, 0.93), turns: b.turns, hit: b.hit };
}

async function digitsOnlyPass(worker: Worker, img: Blob, mode: "7" | "11"): Promise<string> {
  await worker.setParameters({ tessedit_char_whitelist: "0123456789 ", tessedit_pageseg_mode: mode as never });
  try {
    return (await worker.recognize(img)).data.text;
  } finally {
    await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "3" as never });
  }
}

/** One enlarged line read as letters only (names never contain digits or symbols). */
async function lettersOnlyPass(worker: Worker, img: Blob): Promise<{ text: string; confidence: number }> {
  await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .", tessedit_pageseg_mode: "7" as never });
  try {
    const { data } = await worker.recognize(img);
    return { text: data.text.trim(), confidence: data.confidence };
  } finally {
    await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "3" as never });
  }
}

/**
 * On-device reader. The worker, WASM core and English data are served from /tesseract (copied at build time and stored by
 * the service worker), so after the first load no network is needed. Strategy for an Aadhaar card, strongest evidence first:
 *  1. the QR code on the card (name, date of birth, gender, address as data; last 4 digits of the number);
 *  2. the printed text read at full resolution, after finding which way up the card is;
 *  3. if the 12-digit number is still not valid: re-read just the line of digits, enlarged and digits-only, then a
 *     black-and-white version for photos with shadows;
 *  4. cross-checks: the number's last 4 digits must match the QR, and a single misread digit is corrected only when the
 *     QR's last 4 digits confirm it.
 * Everything found is shown to a person to confirm. Text and images are never logged or sent anywhere.
 */
export async function readLocal(
  kind: OcrKind,
  image: Blob,
  onProgress?: (p: number) => void,
  /** the photo as taken, for the QR code (see prepareImage); falls back to `image` */
  original?: Blob,
): Promise<LocalRead> {
  const { createWorker } = await import("tesseract.js");
  let base = 0, span = 0.25;
  const worker = await createWorker("eng", 1, workerOptions((m) => {
    if (m.status === "recognizing text") onProgress?.(Math.min(0.99, base + m.progress * span));
  }));
  const notes: string[] = [];
  try {
    if (kind === "udid") {
      const up = await turnUpright(worker, image, (t) => !!extractUdid(t));
      base = 0.3; span = 0.7;
      const full = (await worker.recognize(up.img)) as Page;
      return { ...parseUdidText(full.data.text), rotatedTurns: up.turns, notes };
    }

    // 1) QR: starts now and runs alongside the text reading (the reader works in its own thread), so it adds no waiting
    const qrPromise: Promise<AadhaarQr | null> = readAadhaarQr(original ?? image).catch(() => null);
    base = 0; span = 0.05;

    // 2) printed text at full resolution
    base = 0.08; span = 0.17;
    const up = await turnUpright(worker, image, (t) => parseAadhaarText(t).found);
    base = 0.25; span = 0.45;
    const full = (await worker.recognize(up.img, {}, { blocks: true })) as Page;
    const parsed = parseAadhaarText(full.data.text);
    let number = parsed.number;

    // 3) rescue the number
    if (!number.valid) {
      base = 0.7; span = 0.12;
      const candidates: string[] = [];
      const digitLines = lineBoxes(full).filter((l) => l.text.replace(/\D/g, "").length >= 8);
      for (const l of digitLines.slice(0, 3)) {
        const crop = await cropBlob(up.img, l.bbox, { pad: 14, targetH: 110 });
        candidates.push(await digitsOnlyPass(worker, crop, "7"));
      }
      candidates.push(await digitsOnlyPass(worker, up.img, "11"));
      let alt = extractAadhaarFromText(candidates.join("\n"));
      if (!alt.valid) {
        base = 0.85; span = 0.14;
        const bw = await binarizeBlob(up.img);
        const bwPage = (await worker.recognize(bw, {}, { blocks: true })) as Page;
        const bwParsed = parseAadhaarText(bwPage.data.text);
        alt = bwParsed.number.valid ? bwParsed.number : alt;
        if (!alt.valid) {
          for (const l of lineBoxes(bwPage).filter((x) => x.text.replace(/\D/g, "").length >= 8).slice(0, 2)) {
            const t = await digitsOnlyPass(worker, await cropBlob(bw, l.bbox, { pad: 14, targetH: 110 }), "7");
            const e = extractAadhaarFromText(t);
            if (e.valid) { alt = e; break; }
          }
        }
      }
      if (alt.valid || !number.value) number = alt;
    }

    // 4) cross-checks with the QR
    const qr = await qrPromise;
    if (qr?.aadhaar_no && !number.valid) {
      number = { value: qr.aadhaar_no, valid: true }; // old XML QR carries the whole number
      notes.push("Aadhaar number taken from the QR code on the card.");
    }
    let numberConf = number.valid ? 0.7 : number.value ? 0.2 : 0;
    if (qr?.last4 && number.value) {
      if (number.valid && number.value.endsWith(qr.last4)) {
        numberConf = 0.95;
        notes.push("The number matches the last 4 digits in the card's QR code.");
      } else if (number.valid) {
        numberConf = 0.3;
        notes.push(`The number read does NOT end in ${qr.last4}, the last 4 digits in the card's QR code. Compare every digit with the card.`);
      } else {
        const fixes = suggestAadhaarFixes(number.value).filter((f) => f.digits.endsWith(qr.last4!));
        if (fixes.length === 1) {
          number = { value: fixes[0].digits, valid: true };
          numberConf = 0.6;
          notes.push(`Digit ${fixes[0].position} was corrected (${fixes[0].from} to ${fixes[0].to}) because the result passes the Aadhaar check and matches the QR code. Please confirm it against the card.`);
        }
      }
    }

    const raw: LocalRead["raw"] = { ...parsed.raw, aadhaar_no: { value: number.value, confidence: numberConf } };

    // 5) no name from the QR: re-read the lines just above the date of birth one at a time, enlarged and letters only.
    // The English name is the nearest one that reads cleanly; the regional-language name above it does not.
    if (!qr?.name) {
      base = 0.9; span = 0.09;
      const boxes = lineBoxes(full).filter((b) => b.text.trim());
      const anchor = nameAnchor(boxes.map((b) => b.text.trim()));
      const textName = (raw.name as { value: string | null }).value;
      for (let i = anchor - 1; i >= Math.max(0, anchor - 3); i--) {
        const line = boxes[i]!;
        const read = await lettersOnlyPass(worker, await cropBlob(up.img, line.bbox, { pad: 10, targetH: 90 }));
        // the whole-page reading of this line wins when it is already a clean name and was read at least as surely
        const whole = strongName(line.text);
        const n = whole && (line.confidence ?? 0) >= read.confidence ? whole : strongName(read.text) ?? whole;
        const conf = n === whole ? line.confidence ?? 0 : read.confidence;
        if (n && (n === whole || conf >= (textName ? 60 : 45))) {
          raw.name = { value: n, confidence: conf >= 80 ? 0.6 : 0.45 };
          break;
        }
      }
    }

    if (qr) {
      const set = (k: string, v: string | null, c = 0.95) => { if (v) raw[k] = { value: v, confidence: c }; };
      set("name", qr.name);
      set("dob", qr.dob ? qr.dob.split("-").reverse().join("/") : null);
      if (qr.dob) raw.yob = { value: null, confidence: 0 };
      else set("yob", qr.yob, 0.9);
      set("gender", qr.gender);
      set("care_of", qr.care_of, 0.9);
      set("address", qr.address, 0.9);
      set("pincode", qr.pincode);
      set("district", qr.district, 0.9);
      set("state", qr.state, 0.9);
      notes.unshift("Name, date of birth and address were read from the QR code on the card (more reliable than the printed text).");
    } else {
      notes.unshift("No QR code could be read, so the details come from the printed text. Check the name and date of birth carefully.");
    }
    if (!number.valid) notes.push(`The 12-digit number could not be read reliably${number.value ? ` (best guess ${formatAadhaar(number.value)})` : ""}. Type it from the card.`);

    return { raw, found: number.valid || (!number.value && parsed.found), rotatedTurns: up.turns, notes };
  } finally {
    await worker.terminate();
  }
}

