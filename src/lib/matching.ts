"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { byLast4, datasetMeta, isReady } from "@/lib/local-db";
import { listQueue } from "@/lib/offline-queue";
import { decide, type Candidate, type MatchOutcome, type ServerLookup } from "@/lib/matching-core";
import { isValidAadhaar } from "@/lib/ocr/verhoeff";
import { checkAadhaar } from "@/lib/aadhaar-check";
import { withTimeout } from "@/lib/net";

export * from "@/lib/matching-core";

/** Registration's single path for "who is this Aadhaar?". Online and offline both end up in decide(). */
export async function lookupAadhaar(sb: SupabaseClient, digits: string): Promise<MatchOutcome> {
  const valid = digits.length === 12 && isValidAadhaar(digits);
  const meta = await datasetMeta();
  const local: Candidate[] = valid
    ? (await byLast4(digits.slice(-4))).map((r) => ({ id: r.id, reg_no: r.reg_no, name: r.name }))
    : [];

  const pendingLocal: Candidate[] = (await listQueue().catch(() => []))
    .filter((q) => q.kind === "registration" && q.status !== "synced" && (q.payload?.aadhaar_no as string | undefined) === digits)
    .map((q) => ({ id: q.id, reg_no: null, name: q.name ?? "Pending registration" }));

  let server: ServerLookup;
  if (!valid) {
    server = { status: "unavailable", reason: "error" };
  } else if (typeof navigator !== "undefined" && navigator.onLine === false) {
    server = { status: "unavailable", reason: "offline" };
  } else {
    try {
      const r = await withTimeout(checkAadhaar(sb, digits), 6000); // a dead connection must not freeze the screen
      server = {
        status: "ok",
        rosterRow: r.roster ? { id: r.roster.id, reg_no: r.roster.reg_no, name: r.roster.name } : null,
        registered: r.registered ? { id: r.registered.id, reg_no: null, name: r.registered.name } : null,
      };
    } catch {
      server = { status: "unavailable", reason: navigator.onLine ? "error" : "offline" };
    }
  }
  return decide({ aadhaarValid: valid, localCandidates: local, pendingLocal, datasetReady: isReady(meta), server });
}
