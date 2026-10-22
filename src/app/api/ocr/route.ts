import { getClaimsCached } from "@/lib/supabase/claims";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { OcrError, runOcr } from "@/lib/ocr/gemini";
import type { OcrErrorCode, OcrKind, OcrResponse } from "@/lib/ocr/types";

const MAX_B64 = 6_000_000; // ~4.5MB of image; client downscales to ~300KB
const MIME_OK = new Set(["image/jpeg", "image/png", "image/webp"]);

function fail(code: OcrErrorCode, message: string, status: number) {
  const body: OcrResponse = { ok: false, error: { code, message } };
  return NextResponse.json(body, { status });
}

/**
 * POST /api/ocr  { kind: "aadhaar"|"udid", image: <base64, no data: prefix>, mimeType?: "image/jpeg" }
 * 200 { ok:true, result: OcrResult } | 4xx/5xx { ok:false, error:{code,message} }
 * Never logs document contents.
 */
export async function POST(req: Request) {
  // Only signed-in staff may spend the OCR quota.
  try {
    const supabase = await createClient();
    const { data } = await getClaimsCached(supabase);
    if (!data?.claims) return fail("unauthorized", "Please sign in again", 401);
  } catch {
    return fail("unauthorized", "Could not verify sign-in", 401);
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return fail("not_configured", "OCR key not configured. Type the details in manually.", 503);
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

  let payload: { kind?: string; image?: string; mimeType?: string };
  try {
    payload = await req.json();
  } catch {
    return fail("bad_request", "Invalid request", 400);
  }
  const kind = payload.kind as OcrKind;
  if (kind !== "aadhaar" && kind !== "udid") return fail("bad_request", "kind must be aadhaar or udid", 400);
  const image = (payload.image ?? "").replace(/^data:[^,]+,/, "");
  const mimeType = payload.mimeType && MIME_OK.has(payload.mimeType) ? payload.mimeType : "image/jpeg";
  if (!image || image.length > MAX_B64) return fail("bad_request", "Image missing or too large", 400);

  try {
    const result = await runOcr({ apiKey, model }, kind, image, mimeType);
    return NextResponse.json({ ok: true, result } satisfies OcrResponse);
  } catch (e) {
    if (e instanceof OcrError) return fail(e.code, e.message, e.status);
    return fail("upstream_error", "OCR failed unexpectedly", 500);
  }
}
