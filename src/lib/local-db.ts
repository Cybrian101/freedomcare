"use client";
// Local-first beneficiary store (IndexedDB). All roster reads on the device go through this module, so
// pages never carry their own competing online/offline query logic.
//
// Privacy: the full Aadhaar number is NOT kept on the device. Only the last 4 digits are indexed, which is
// enough to shortlist candidates; a shortlist is never treated as a confirmed match (see matching.ts).
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Appliance, RosterRow } from "@/lib/types";
import { base64ToBlob } from "@/lib/photo-data";

export interface LocalBeneficiary {
  id: string; // server uuid (stable)
  reg_no: string | null; // text, leading zeros preserved
  serial_no: number | null;
  batch: number | null;
  name: string;
  name_norm: string; // lowercase, single spaces, no punctuation: indexed for search
  aadhaar_last4: string | null;
  /** yyyy-mm-dd or null (not captured yet) */
  dob: string | null;
  yob: number | null;
  /** the server has a profile photo for this person (the picture itself is kept in the photos store) */
  has_photo: boolean;
  /** path of that photo on the server: tells which version of the thumbnail this phone needs */
  photo_path: string | null;
  appliances: Appliance[];
  review_note: string | null;
  attended_at: string | null;
  distributed_at: string | null;
  server_updated_at: string;
}

export interface DatasetMeta {
  key: "dataset";
  count: number;
  serverCount: number | null; // roster size the server reported when we downloaded
  downloadedAt: string; // ISO, last successful full download
  verifiedAt: string | null; // ISO, when local count was confirmed equal to the server's
  version: number;
}

interface LocalSchema extends DBSchema {
  roster: {
    key: string;
    value: LocalBeneficiary;
    indexes: { by_reg: string; by_name: string; by_last4: string };
  };
  meta: { key: string; value: DatasetMeta };
  drafts: { key: string; value: DraftRecord };
  /** small profile pictures (about 5-10 KB each) so a person's photo shows offline; keyed by person id */
  photos: { key: string; value: { id: string; blob: Blob; savedAt: number; path?: string | null } };
}

/** Unfinished work that is not yet a queued operation (half-filled form, photo not yet submitted). */
export interface DraftRecord {
  key: string;
  savedAt: number;
  data: Record<string, unknown>;
  blobs?: Record<string, Blob>;
}

const DB_NAME = "freedomcare-local";
let dbp: Promise<IDBPDatabase<LocalSchema>> | null = null;
function db() {
  dbp ??= openDB<LocalSchema>(DB_NAME, 3, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        const r = d.createObjectStore("roster", { keyPath: "id" });
        r.createIndex("by_reg", "reg_no");
        r.createIndex("by_name", "name_norm");
        r.createIndex("by_last4", "aadhaar_last4");
        d.createObjectStore("meta", { keyPath: "key" });
      }
      if (oldVersion < 2) d.createObjectStore("drafts", { keyPath: "key" });
      if (oldVersion < 3) d.createObjectStore("photos", { keyPath: "id" });
    },
  });
  return dbp;
}

export const normName = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

export function toLocal(r: RosterRow): LocalBeneficiary {
  return {
    id: r.id,
    reg_no: r.reg_no,
    serial_no: r.serial_no,
    batch: r.batch,
    name: r.name,
    name_norm: normName(r.name),
    aadhaar_last4: r.aadhaar_no ? r.aadhaar_no.slice(-4) : null,
    dob: r.dob ?? null,
    yob: r.yob ?? null,
    has_photo: !!r.profile_photo_path,
    photo_path: r.profile_photo_path ?? null,
    appliances: r.appliances ?? [],
    review_note: r.review_note,
    attended_at: r.attended_at,
    distributed_at: r.distributed_at,
    server_updated_at: r.updated_at,
  };
}

const COLS_BASE = "id,reg_no,serial_no,batch,name,aadhaar_no,appliances,review_note,attended_at,distributed_at,updated_at";
// dob/yob exist only after supabase/sql/3_staff_attendance_activity.sql; before that the download falls back to the base columns.
const COLS_WITH_DOB = `${COLS_BASE},dob,yob,profile_photo_path`;
const PAGE = 500;

export type DownloadResult = { ok: true; meta: DatasetMeta } | { ok: false; message: string };

/** Download the whole roster (paged), replace the local copy in one transaction, then verify the count. */
export async function downloadDataset(sb: SupabaseClient): Promise<DownloadResult> {
  try {
    const head = await sb.from("camp_roster").select("id", { count: "exact", head: true });
    if (head.error) throw new Error(head.error.message);
    const serverCount = head.count ?? 0;

    const readAll = async (cols: string) => {
      const out: LocalBeneficiary[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb
          .from("camp_roster")
          .select(cols)
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const r of (data ?? []) as unknown as RosterRow[]) out.push(toLocal(r));
        if (!data || data.length < PAGE) break;
      }
      return out;
    };
    let rows: LocalBeneficiary[];
    try {
      rows = await readAll(COLS_WITH_DOB);
    } catch (e) {
      if ((e as { code?: string }).code !== "42703") throw new Error((e as Error).message);
      rows = await readAll(COLS_BASE); // database does not have the date-of-birth columns yet
    }

    const d = await db();
    const tx = d.transaction(["roster", "meta"], "readwrite");
    await tx.objectStore("roster").clear();
    for (const r of rows) await tx.objectStore("roster").put(r);
    const now = new Date().toISOString();
    const meta: DatasetMeta = {
      key: "dataset",
      count: rows.length,
      serverCount,
      downloadedAt: now,
      verifiedAt: rows.length === serverCount && rows.length > 0 ? now : null,
      version: 1,
    };
    await tx.objectStore("meta").put(meta);
    await tx.done;
    return { ok: true, meta };
  } catch (e) {
    return { ok: false, message: (e as Error).message || "Download failed" };
  }
}

export async function datasetMeta(): Promise<DatasetMeta | null> {
  try {
    return (await (await db()).get("meta", "dataset")) ?? null;
  } catch {
    return null;
  }
}

/** "Ready" = a full download whose row count matched the server's. Anything less is not offline-ready. */
export const isReady = (m: DatasetMeta | null) => !!m?.verifiedAt && m.count > 0;

export async function getLocal(id: string): Promise<LocalBeneficiary | undefined> {
  return (await db()).get("roster", id);
}

/** Refresh one row from a server response (e.g. after a confirmed sync). */
export async function putLocalFromServer(r: RosterRow): Promise<void> {
  await (await db()).put("roster", toLocal(r));
}

/** Every person on the device list (a few hundred rows). Used for name + date-of-birth matching. */
export async function allLocal(): Promise<LocalBeneficiary[]> {
  return (await db()).getAll("roster");
}

/**
 * Download the small profile pictures this phone does not have yet (or has an older version of), so the distribution desk can
 * re-confirm identity from the picture, online or offline. Only missing ones are fetched, in small batches. Quiet on failure.
 */
export async function syncThumbs(sb: SupabaseClient, onlyId?: string): Promise<number> {
  try {
    const d = await db();
    const rows = (await d.getAll("roster")).filter((r) => r.photo_path && (!onlyId || r.id === onlyId));
    const need: LocalBeneficiary[] = [];
    for (const r of rows) {
      const t = await d.get("photos", r.id);
      if (!t || t.path !== r.photo_path) need.push(r);
    }
    let got = 0;
    for (let i = 0; i < need.length; i += 40) {
      const batch = need.slice(i, i + 40);
      const { data, error } = await sb.from("camp_roster").select("id,profile_photo_path,profile_thumb").in("id", batch.map((r) => r.id));
      if (error) break; // offline, or the database does not have the column yet
      for (const row of (data ?? []) as { id: string; profile_photo_path: string | null; profile_thumb: string | null }[]) {
        if (!row.profile_thumb) continue;
        await d.put("photos", { id: row.id, blob: base64ToBlob(row.profile_thumb), savedAt: Date.now(), path: row.profile_photo_path });
        got++;
      }
    }
    if (got && typeof window !== "undefined") window.dispatchEvent(new Event("fc:thumbs")); // avatars on screen pick up the new pictures
    return got;
  } catch {
    return 0;
  }
}

export async function getByRegNo(reg: string): Promise<LocalBeneficiary[]> {
  return (await db()).getAllFromIndex("roster", "by_reg", reg.trim());
}

export async function byLast4(last4: string): Promise<LocalBeneficiary[]> {
  return (await db()).getAllFromIndex("roster", "by_last4", last4);
}

/**
 * Indexed search: exact Reg. No. first, then Reg. No. prefix (index range), then name tokens (index range for
 * the first token, remaining tokens filtered). Never loads the whole table into memory per keystroke.
 */
export async function searchLocal(q: string, limit = 40): Promise<LocalBeneficiary[]> {
  const raw = q.trim();
  if (!raw) return [];
  const d = await db();
  const out = new Map<string, LocalBeneficiary>();
  const add = (rows: LocalBeneficiary[]) => {
    for (const r of rows) if (out.size < limit && !out.has(r.id)) out.set(r.id, r);
  };

  add(await d.getAllFromIndex("roster", "by_reg", raw));
  add(await d.getAllFromIndex("roster", "by_reg", IDBKeyRange.bound(raw, raw + "￿"), limit));

  const tokens = normName(raw).split(" ").filter(Boolean);
  if (tokens.length) {
    // names are indexed whole, so a prefix range on the first token covers "ram" -> "ramesh kumar ..."; a token that
    // is not at the start of the name (e.g. surname first) is found by the contains-scan below, bounded by roster size.
    add(await d.getAllFromIndex("roster", "by_name", IDBKeyRange.bound(tokens[0], tokens[0] + "￿"), limit * 2));
    if (out.size < limit) {
      let cur = await d.transaction("roster").store.index("by_name").openCursor();
      while (cur && out.size < limit) {
        const n = cur.value.name_norm;
        if (tokens.every((t) => n.includes(t))) add([cur.value]);
        cur = await cur.continue();
      }
    }
  }
  const rows = [...out.values()].filter(
    (r) => r.reg_no === raw || (r.reg_no ?? "").startsWith(raw) || tokens.every((t) => r.name_norm.includes(t)),
  );
  return rows.sort((a, b) => Number(b.reg_no === raw) - Number(a.reg_no === raw) || (a.serial_no ?? 1e9) - (b.serial_no ?? 1e9));
}

export async function saveDraft(key: string, data: Record<string, unknown>, blobs?: Record<string, Blob>): Promise<void> {
  await (await db()).put("drafts", { key, savedAt: Date.now(), data, blobs });
}
export async function loadDraft(key: string): Promise<DraftRecord | undefined> {
  try { return await (await db()).get("drafts", key); } catch { return undefined; }
}
export async function deleteDraft(key: string): Promise<void> {
  try { await (await db()).delete("drafts", key); } catch { /* nothing to delete */ }
}
export async function listDrafts(): Promise<DraftRecord[]> {
  try { return await (await db()).getAll("drafts"); } catch { return []; }
}

export async function putThumb(personId: string, blob: Blob, path: string | null = null): Promise<void> {
  await (await db()).put("photos", { id: personId, blob, savedAt: Date.now(), path });
}
/** After a photo taken on this phone reaches the server, remember which server photo this thumbnail belongs to. */
export async function setThumbPath(personId: string, path: string): Promise<void> {
  const d = await db();
  const t = await d.get("photos", personId);
  if (t) await d.put("photos", { ...t, path });
}
export async function getThumb(personId: string): Promise<Blob | undefined> {
  try { return (await (await db()).get("photos", personId))?.blob; } catch { return undefined; }
}

/** Removes cached beneficiary data (used on sign-out of a shared device). Does not touch the sync queue. */
export async function clearLocalDataset(): Promise<void> {
  const d = await db();
  const tx = d.transaction(["roster", "meta", "drafts", "photos"], "readwrite");
  await tx.objectStore("roster").clear();
  await tx.objectStore("meta").clear();
  await tx.objectStore("drafts").clear();
  await tx.objectStore("photos").clear();
  await tx.done;
}

/** Distinct appliance names already used in the camp list (for the Reg. No. assignment picker). */
export async function applianceNames(): Promise<string[]> {
  try {
    const all = await (await db()).getAll("roster");
    const set = new Set<string>();
    for (const r of all) for (const a of r.appliances) if (a.name) set.add(a.name);
    return [...set].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export const asRosterStatus = (r: Pick<LocalBeneficiary, "attended_at" | "distributed_at">) =>
  r.distributed_at ? ("distributed" as const) : r.attended_at ? ("attended" as const) : ("not_arrived" as const);
