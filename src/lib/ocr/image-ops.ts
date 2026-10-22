"use client";
// Small canvas helpers for the on-device reader. All of them keep working in the browser only (no network).

export const canvasBlob = (c: HTMLCanvasElement, quality = 0.92, type = "image/jpeg") =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), type, quality));

async function decode(blob: Blob): Promise<{ w: number; h: number; draw: CanvasImageSource; close: () => void }> {
  try {
    const b = await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
    return { w: b.width, h: b.height, draw: b, close: () => b.close?.() };
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return { w: img.naturalWidth, h: img.naturalHeight, draw: img, close: () => undefined };
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  }
}

/**
 * Draw an image into a canvas, optionally rotated by quarter turns and limited to `maxEdge` pixels on its longest side
 * (omit maxEdge to keep every pixel). White background so transparent areas never turn black.
 */
export async function toCanvas(blob: Blob, opts: { maxEdge?: number; turns?: number } = {}): Promise<HTMLCanvasElement> {
  const src = await decode(blob);
  try {
    const turns = (((opts.turns ?? 0) % 4) + 4) % 4;
    const scale = opts.maxEdge ? Math.min(1, opts.maxEdge / Math.max(src.w, src.h)) : 1;
    const dw = Math.max(1, Math.round(src.w * scale));
    const dh = Math.max(1, Math.round(src.h * scale));
    const [cw, ch] = turns % 2 ? [dh, dw] : [dw, dh];
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingQuality = "high";
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((turns * Math.PI) / 2);
    ctx.drawImage(src.draw, -dw / 2, -dh / 2, dw, dh);
    return c;
  } finally {
    src.close();
  }
}

export async function transformBlob(blob: Blob, opts: { maxEdge?: number; turns?: number } = {}, quality = 0.92): Promise<Blob> {
  return canvasBlob(await toCanvas(blob, opts), quality);
}

/** Cut out one line of text (given by its bounding box), with padding, enlarged so the letters are about `targetH` px tall. */
export async function cropBlob(
  blob: Blob,
  box: { x0: number; y0: number; x1: number; y1: number },
  opts: { pad?: number; targetH?: number } = {},
): Promise<Blob> {
  const src = await toCanvas(blob);
  const pad = opts.pad ?? 14;
  const x0 = Math.max(0, Math.floor(box.x0 - pad));
  const y0 = Math.max(0, Math.floor(box.y0 - pad));
  const x1 = Math.min(src.width, Math.ceil(box.x1 + pad));
  const y1 = Math.min(src.height, Math.ceil(box.y1 + pad));
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const k = Math.max(1, (opts.targetH ?? 110) / h); // enlarge small text, never shrink
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, x0, y0, w, h, 0, 0, c.width, c.height);
  return canvasBlob(c, 0.95);
}

/**
 * Black-and-white version for hard photos (uneven light, shadows, glare). Each pixel is compared with the average of its
 * neighbourhood (integral image), so a shadow across half the card does not wipe out the letters the way one global
 * threshold would.
 */
export async function binarizeBlob(blob: Blob, maxEdge = 2200): Promise<Blob> {
  const c = await toCanvas(blob, { maxEdge });
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const { width: w, height: h } = c;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  const integral = new Uint32Array((w + 1) * (h + 1)); // sums stay below 2^32 up to ~16 MP
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += gray[(y - 1) * w + (x - 1)];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(w, h) / 24));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = gray[y * w + x] < mean * 0.9 ? 0 : 255;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasBlob(c, 0.95, "image/png");
}
