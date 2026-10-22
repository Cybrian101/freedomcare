type Drawable = { width: number; height: number; draw: CanvasImageSource; close?: () => void };

/**
 * Decode with EXIF rotation applied. iPhones store portrait shots sideways + an orientation tag, and some iOS Safari
 * versions reject createImageBitmap options or very large photos, so fall back to an <img> element (which Safari
 * decodes and orients itself, including HEIC when it was not already converted to JPEG).
 */
async function decode(src: Blob): Promise<Drawable> {
  try {
    const b = await createImageBitmap(src, { imageOrientation: "from-image" } as ImageBitmapOptions);
    return { width: b.width, height: b.height, draw: b, close: () => b.close?.() };
  } catch {
    const url = URL.createObjectURL(src);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight, draw: img };
    } catch {
      throw new Error("This photo format could not be read. Take the photo again with the camera.");
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  }
}

export type PhotoKind = "handover" | "profile" | "document";

export interface CompressOpts {
  /** longest side in pixels */
  maxDim: number;
  /** first JPEG quality tried (0-1) */
  quality: number;
  /** quality is never lowered below this: if the file is still too big, the pixels are reduced instead */
  minQuality: number;
  maxBytes: number;
  /** centre-crop to this width/height ratio first (profile photos) */
  aspect?: number;
}

/**
 * Stored photos are made smaller WITHOUT visible loss: high JPEG quality (never below `minQuality`), gradual
 * down-scaling with a high-quality filter, and a generous size cap. Only when a file is still over the cap are the pixels
 * reduced a little, never the quality. Typical results: handover ~0.6-1.2 MB, profile ~120-250 KB, scanned card ~1-2 MB.
 */
export const PRESETS: Record<PhotoKind, CompressOpts> = {
  handover: { maxDim: 2048, quality: 0.9, minQuality: 0.86, maxBytes: 2.5 * 1024 * 1024 },
  profile: { maxDim: 1280, quality: 0.92, minQuality: 0.88, maxBytes: 700 * 1024, aspect: 3 / 4 },
  document: { maxDim: 2600, quality: 0.9, minQuality: 0.86, maxBytes: 3 * 1024 * 1024 },
};

function newCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { c, ctx };
}

/** Scale in steps of at most 2x: one big jump makes thin lines and text look jagged. */
function scaleTo(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, tw: number, th: number): HTMLCanvasElement {
  let cur: CanvasImageSource = src;
  let cx = sx, cy = sy, cw = sw, ch = sh;
  while (cw / 2 > tw && ch / 2 > th) {
    const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
    const { c, ctx } = newCanvas(nw, nh);
    ctx.drawImage(cur, cx, cy, cw, ch, 0, 0, nw, nh);
    cur = c; cx = 0; cy = 0; cw = nw; ch = nh;
  }
  const { c, ctx } = newCanvas(tw, th);
  ctx.drawImage(cur, cx, cy, cw, ch, 0, 0, tw, th);
  return c;
}

const toJpeg = (c: HTMLCanvasElement, q: number) =>
  new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", q));

/** Re-encode an image as a high-quality JPEG (EXIF orientation applied). Pass a PhotoKind or explicit options. */
export async function compressImage(src: Blob, kindOrOpts: PhotoKind | CompressOpts = "handover"): Promise<Blob> {
  const o = typeof kindOrOpts === "string" ? PRESETS[kindOrOpts] : kindOrOpts;
  const bmp = await decode(src);
  try {
    // optional centre crop (portrait for profile photos; slightly above centre keeps heads in frame)
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
    if (o.aspect) {
      const have = sw / sh;
      if (have > o.aspect) { sw = Math.round(sh * o.aspect); sx = Math.round((bmp.width - sw) / 2); }
      else if (have < o.aspect) { sh = Math.round(sw / o.aspect); sy = Math.round((bmp.height - sh) * 0.35); }
    }
    let maxDim = o.maxDim;
    let best: Blob | null = null;
    for (let size = 0; size < 8; size++) {
      const scale = Math.min(1, maxDim / Math.max(sw, sh));
      const tw = Math.max(1, Math.round(sw * scale));
      const th = Math.max(1, Math.round(sh * scale));
      const canvas = scaleTo(bmp.draw, sx, sy, sw, sh, tw, th);
      for (let q = o.quality; q >= o.minQuality - 1e-6; q -= 0.02) {
        const out = await toJpeg(canvas, q);
        if (!out) throw new Error("Could not encode photo");
        best = out;
        if (out.size <= o.maxBytes) return out;
      }
      maxDim = Math.round(maxDim * 0.9); // still too big at the quality floor: reduce pixels a little, keep quality
    }
    if (!best) throw new Error("Could not encode photo");
    return best;
  } finally {
    bmp.close?.();
  }
}

/** Tiny square-ish JPEG kept on the phone to show a person's picture offline (about 5-10 KB). */
export async function makeThumbnail(src: Blob, size = 192): Promise<Blob> {
  return compressImage(src, { maxDim: size, quality: 0.82, minQuality: 0.7, maxBytes: 30 * 1024 });
}
