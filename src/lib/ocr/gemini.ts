import { normalizeModelOutput } from "./normalize";
import { STRICT_RETRY_SUFFIX, systemPrompt } from "./prompts";
import { AADHAAR_KEYS, UDID_KEYS, type OcrErrorCode, type OcrKind, type OcrResult } from "./types";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export class OcrError extends Error {
  constructor(public code: OcrErrorCode, message: string, public status = 500) {
    super(message);
  }
}

/** Gemini responseSchema (OpenAPI subset): each field = {value: string|null, confidence: 0..1}. */
export function buildResponseSchema(kind: OcrKind) {
  const keys = kind === "aadhaar" ? AADHAAR_KEYS : UDID_KEYS;
  const fieldSchema = {
    type: "OBJECT",
    properties: {
      value: { type: "STRING", nullable: true },
      confidence: { type: "NUMBER" },
    },
    required: ["value", "confidence"],
  };
  const properties: Record<string, unknown> = { legibility: { type: "NUMBER" } };
  for (const k of keys) properties[k] = fieldSchema;
  return { type: "OBJECT", properties, required: ["legibility", ...keys] };
}

export interface GeminiConfig { apiKey: string; model: string; fetchImpl?: typeof fetch }

async function callOnce(
  cfg: GeminiConfig, kind: OcrKind, imageB64: string, mimeType: string, strict: boolean,
): Promise<unknown> {
  const f = cfg.fetchImpl ?? fetch;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt(kind) + (strict ? STRICT_RETRY_SUFFIX : "") }] },
    contents: [{
      role: "user",
      parts: [
        { text: "Read this document and return the JSON." },
        { inline_data: { mime_type: mimeType, data: imageB64 } },
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: buildResponseSchema(kind),
    },
  };
  let res: Response;
  try {
    res = await f(`${ENDPOINT}/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new OcrError(timeout ? "timeout" : "upstream_error", timeout ? "OCR took too long" : "Could not reach OCR service", 504);
  }
  if (res.status === 429) throw new OcrError("rate_limited", "OCR rate limit reached, try again in a minute", 429);
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new OcrError("upstream_error", "OCR service rejected the request (check API key/model)", 502);
  }
  if (!res.ok) throw new OcrError("upstream_error", `OCR service error (${res.status})`, 502);
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new OcrError("unreadable", "The OCR service returned nothing for this image", 502);
  try {
    return JSON.parse(text);
  } catch {
    throw new OcrError("upstream_error", "OCR service returned malformed data", 502);
  }
}

/** Run OCR. For Aadhaar, retry once with a stricter prompt if the number fails the checksum. */
export async function runOcr(
  cfg: GeminiConfig, kind: OcrKind, imageB64: string, mimeType: string,
): Promise<OcrResult> {
  const first = normalizeModelOutput(await callOnce(cfg, kind, imageB64, mimeType, false), kind, 1);
  if (kind !== "aadhaar" || first.aadhaarValid) return first;
  try {
    const second = normalizeModelOutput(await callOnce(cfg, kind, imageB64, mimeType, true), kind, 2);
    if (second.aadhaarValid) return second;
    const best = second.fields.aadhaar_no.value ? second : first;
    return { ...best, attempts: 2 };
  } catch {
    return { ...first, attempts: 2 };
  }
}
