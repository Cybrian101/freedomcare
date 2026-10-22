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

/** Downscale + re-encode an image to JPEG, targeting <= maxBytes (default 1.5MB). */
export async function compressImage(
  src: Blob,
  opts: { maxBytes?: number; maxDim?: number } = {},
): Promise<Blob> {
  const maxBytes = opts.maxBytes ?? 1.5 * 1024 * 1024;
  let maxDim = opts.maxDim ?? 1600;
  const bmp = await decode(src);
  try {
    let quality = 0.82;
    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(bmp.draw, 0, 0, w, h);
      const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
      if (!out) throw new Error("Could not encode photo");
      if (out.size <= maxBytes) return out;
      quality = Math.max(0.5, quality - 0.1);
      maxDim = Math.round(maxDim * 0.85);
    }
    // Last resort: smallest settings
    const c = document.createElement("canvas");
    c.width = 1000;
    c.height = Math.round((1000 * bmp.height) / bmp.width);
    c.getContext("2d")!.drawImage(bmp.draw, 0, 0, c.width, c.height);
    const last = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.6));
    if (!last) throw new Error("Could not encode photo");
    return last;
  } finally {
    bmp.close?.();
  }
}
