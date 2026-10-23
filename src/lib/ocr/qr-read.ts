"use client";
// Finds and reads the QR code in a photo of an Aadhaar card. Uses the phone's built-in detector when it has one (Chrome on
// Android: fast and strong), otherwise ZXing (the reference QR decoder, compiled to WebAssembly and served from this site,
// so it works offline). Nothing leaves the phone.
import { parseAadhaarQr, type AadhaarQr } from "./aadhaar-qr";
import { binarizeBlob, regionCanvas, toCanvas } from "./image-ops";

interface DetectorLike { detect(image: ImageBitmapSource): Promise<{ rawValue?: string }[]> }
type DetectorCtor = new (o: { formats: string[] }) => DetectorLike;

async function viaBarcodeDetector(blob: Blob): Promise<string[]> {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Ctor) return [];
  try {
    const det = new Ctor({ formats: ["qr_code"] });
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
    try {
      return (await det.detect(bmp)).map((r) => r.rawValue ?? "").filter(Boolean);
    } finally {
      bmp.close?.();
    }
  } catch {
    return [];
  }
}

let zxing: Promise<typeof import("zxing-wasm/reader")> | null = null;
function loadZxing() {
  zxing ??= import("zxing-wasm/reader").then((m) => {
    // Served from this site (copied into public/zxing at build time and stored by the service worker): no network needed.
    const g = globalThis as unknown as { __fcZxingWasmBinary?: ArrayBuffer }; // test hook: bytes supplied by the test harness
    m.setZXingModuleOverrides(
      g.__fcZxingWasmBinary
        ? { wasmBinary: g.__fcZxingWasmBinary }
        : { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/zxing/zxing_reader.wasm" : prefix + path) },
    );
    return m;
  });
  return zxing;
}

async function scan(c: HTMLCanvasElement): Promise<string | null> {
  const { readBarcodes } = await loadZxing();
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const res = await readBarcodes(img, { formats: ["QRCode"], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 1 });
  return res.find((r) => r.isValid && r.text)?.text ?? null;
}

/**
 * The card's QR is dense (about 140-160 squares across), so it needs roughly 4+ pixels per square: it is read from the
 * ORIGINAL full-size photo, never from the shrunken copy used for the printed text. Attempts, cheapest first: the photo as
 * taken, then a black-and-white version that survives shadows and glare, then each quarter of the photo enlarged (when
 * the card is small in the photo its QR squares are too few pixels to read; which quarter holds the QR depends on how
 * the card was held, so all four are tried).
 */
async function viaZxing(blob: Blob): Promise<string[]> {
  const quarters = [
    { x0: 0.4, y0: 0, x1: 1, y1: 0.6 }, { x0: 0.4, y0: 0.4, x1: 1, y1: 1 }, // the QR is on the right of an upright card
    { x0: 0, y0: 0, x1: 0.6, y1: 0.6 }, { x0: 0, y0: 0.4, x1: 0.6, y1: 1 },
  ];
  const tries: (() => Promise<HTMLCanvasElement>)[] = [
    () => toCanvas(blob, { maxEdge: 4096 }),
    async () => toCanvas(await binarizeBlob(blob, 3200)),
    ...quarters.map((q) => () => regionCanvas(blob, q, { zoom: 2, maxEdge: 3200 })),
  ];
  for (const make of tries) {
    const text = await scan(await make());
    if (text) return [text];
    await new Promise((r) => setTimeout(r, 0)); // let the screen breathe between the heavy steps
  }
  return [];
}

/** The Aadhaar details printed as a QR on the card, or null when there is no readable QR (the caller then uses OCR). */
export async function readAadhaarQr(blob: Blob): Promise<AadhaarQr | null> {
  for (const text of await viaBarcodeDetector(blob)) {
    const r = await parseAadhaarQr(text);
    if (r) return r;
  }
  try {
    for (const text of await viaZxing(blob)) {
      const r = await parseAadhaarQr(text);
      if (r) return r;
    }
  } catch {
    /* the decoder failed to load: carry on without the QR */
  }
  return null;
}
