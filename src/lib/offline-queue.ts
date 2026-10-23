"use client";
// Browser wiring for the handover-photo queue: IndexedDB store + Supabase remote + singleton engine + triggers.
import { openDB, type IDBPDatabase } from "idb";
import { createClient } from "@/lib/supabase/client";
import { completeDistribution, linkAadhaar, markAttendance, setProfilePhoto } from "@/lib/roster";
import { putThumb, setThumbPath, stripDraftImages } from "@/lib/local-db";
import { blobToBase64 } from "@/lib/photo-data";
import { makeThumbnail } from "@/components/camera/compress";
import {
  QueueError,
  SyncEngine,
  newItem,
  newAttendanceItem,
  newGroupHandoverItem,
  newLinkItem,
  newProfileItem,
  newRegistrationItem,
  stripCardImages,
  type CompleteResult,
  type QueueItem,
  type QueueRemote,
  type QueueStore,
} from "@/lib/queue-core";

export * from "@/lib/queue-core";

const DB_NAME = "freedomcare-queue";
const STORE = "items";

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  dbp ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore(STORE, { keyPath: "id" });
    },
  });
  return dbp;
}

export const idbStore: QueueStore = {
  async getAll() {
    return (await (await db()).getAll(STORE)) as QueueItem[];
  },
  async get(id) {
    return (await (await db()).get(STORE, id)) as QueueItem | undefined;
  },
  async put(item) {
    await (await db()).put(STORE, item);
  },
  async delete(id) {
    await (await db()).delete(STORE, id);
  },
};

const NET_RE = /failed to fetch|networkerror|network request failed|load failed|timeout|timed out|aborted|offline/i;
const PERM_RE = /beneficiary not found|photo path does not belong|photo required|different aadhaar|already on another record|invalid aadhaar format|invalid input syntax for type uuid|beneficiaries_aadhaar_no_key|violates (check|not-null)/i;
const DUP_RE = /already exists|duplicate|resource already/i;

function classify(e: unknown): QueueError {
  if (e instanceof QueueError) return e;
  const anyE = e as { message?: string; status?: number; statusCode?: string | number; code?: string };
  const msg = anyE?.message ?? String(e);
  const status = Number(anyE?.status ?? anyE?.statusCode);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return new QueueError("network", msg);
  if (NET_RE.test(msg)) return new QueueError("network", msg);
  if (PERM_RE.test(msg)) return new QueueError("permanent", msg);
  if (status === 401 || /jwt|not authenticated|expired/i.test(msg))
    return new QueueError("auth", "Session expired - sign in again, then Retry");
  return new QueueError("transient", msg);
}

const remote: QueueRemote = {
  async upload(path, blob) {
    const supabase = createClient();
    const { error } = await supabase.storage
      .from("handover-photos")
      // upsert:false on purpose: the bucket has INSERT but no UPDATE policy, so upsert over an
      // existing object would be refused. A repeat of the same submission hits "already exists",
      // which we treat as success (path is the submission uuid => identical content).
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error) {
      const e = error as { message: string; statusCode?: string; status?: number };
      if (DUP_RE.test(e.message) || String(e.statusCode) === "409" || e.status === 409) return;
      throw classify(e);
    }
  },
  async attend(rosterId, dob) {
    try {
      await markAttendance(createClient(), rosterId, dob);
    } catch (e) {
      throw classify(e);
    }
  },
  async setProfile(rosterId, path, thumb) {
    try {
      await setProfilePhoto(createClient(), rosterId, path, thumb);
      await setThumbPath(rosterId, path).catch(() => undefined); // the thumbnail on this phone now matches the server's photo
    } catch (e) {
      throw classify(e);
    }
  },
  async link(rosterId, aadhaar, dob, yob) {
    try {
      await linkAadhaar(createClient(), rosterId, aadhaar, dob, yob);
    } catch (e) {
      throw classify(e);
    }
  },
  async register(id, row) {
    // A database that has not had the profile-photo column added yet must still accept registrations without a photo.
    const { profile_photo_path, profile_thumb, ...rest } = row as { profile_photo_path?: string | null; profile_thumb?: string | null } & Record<string, unknown>;
    const { error } = await createClient().from("beneficiaries").insert({ ...rest, ...(profile_photo_path ? { profile_photo_path } : {}), ...(profile_photo_path && profile_thumb ? { profile_thumb } : {}), id });
    if (!error) return;
    // Same client-generated id already inserted by an earlier attempt whose response was lost: success.
    if (error.code === "23505" && /beneficiaries_pkey/.test(error.message)) return;
    if (error.code === "23505")
      throw new QueueError("permanent", "Aadhaar number is already registered. Open the existing record instead.");
    throw classify(error);
  },
  async uploadDoc(path, blob) {
    const { error } = await createClient().storage.from("documents").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (!error) return;
    const e = error as { message: string; statusCode?: string; status?: number };
    if (DUP_RE.test(e.message) || String(e.statusCode) === "409" || e.status === 409) return;
    throw classify(e);
  },
  async complete(rosterId, path, submissionId): Promise<CompleteResult> {
    try {
      const row = await completeDistribution(createClient(), rosterId, path, submissionId);
      return { serverSubmissionId: row.submission_id, distributedAt: row.distributed_at };
    } catch (e) {
      throw classify(e);
    }
  },
};

/** Who is signed in on this device right now (set by SyncProvider from the local session; no network). */
let currentOwner: { id: string; email?: string; name?: string } | null = null;
export function setOwner(o: { id: string; email?: string; name?: string } | null) {
  currentOwner = o;
}
const stamp = (i: QueueItem): QueueItem =>
  currentOwner ? { ...i, ownerId: currentOwner.id, ownerEmail: currentOwner.email, ownerName: currentOwner.name } : i;

let engine: SyncEngine | null = null;
export function getEngine(): SyncEngine {
  engine ??= new SyncEngine(idbStore, remote, Date.now, () => currentOwner?.id ?? null);
  return engine;
}

/** Called from the capture flow: persist first, kick the sync without awaiting. */
export async function submitHandover(p: {
  rosterId: string;
  regNo: string | null;
  name?: string;
  blob: Blob;
  submissionId?: string;
}): Promise<QueueItem> {
  const item = stamp(newItem({ ...p, submissionId: p.submissionId ?? crypto.randomUUID() }));
  const eng = getEngine();
  await eng.enqueue(item); // "Saved on this device"
  void eng.runOnce();
  return item;
}

/** Wheelchair group: one photo saved for every member. Persist first, sync without awaiting. */
export async function submitGroupHandover(p: {
  members: { rosterId: string; regNo: string | null; name?: string }[];
  blob: Blob;
}): Promise<QueueItem> {
  const id = crypto.randomUUID();
  const members = p.members.map((m) => ({ ...m, submissionId: crypto.randomUUID() }));
  const item = stamp(newGroupHandoverItem({ id, members, blob: p.blob }));
  const eng = getEngine();
  await eng.enqueue(item);
  void eng.runOnce();
  return item;
}

/** Attendance is saved on the device first and synced like everything else. */
export async function submitAttendance(p: { rosterId: string; regNo: string | null; name?: string; dob?: string | null }): Promise<QueueItem> {
  const item = stamp(newAttendanceItem({ ...p, id: crypto.randomUUID() }));
  const eng = getEngine();
  await eng.enqueue(item);
  void eng.runOnce();
  return item;
}

/**
 * Profile photo for a camp-list person. The photo is kept on the phone first (and a small copy is stored so the picture
 * shows next to the person straight away, even offline), then uploaded and attached by the sync engine.
 */
export async function submitProfilePhoto(p: { rosterId: string; regNo: string | null; name?: string; blob: Blob }): Promise<QueueItem> {
  // The small thumbnail is made first: it shows next to the person at once on this phone, and travels with the photo so the
  // other phones can show it too. If it cannot be made, the full photo is still saved and uploaded.
  let thumb: string | undefined;
  let thumbBlob: Blob | undefined;
  try { thumbBlob = await makeThumbnail(p.blob); thumb = await blobToBase64(thumbBlob); } catch { /* preview missing only */ }
  const item = stamp(newProfileItem({ ...p, id: crypto.randomUUID(), thumb }));
  const eng = getEngine();
  await eng.enqueue(item);
  if (thumbBlob) { try { await putThumb(p.rosterId, thumbBlob); } catch { /* shows after the next list refresh */ } }
  void eng.runOnce();
  return item;
}

/** Add an Aadhaar (and DOB) to a listed person who had none. Saved on the device first, like everything else. */
export async function submitLink(p: {
  rosterId: string;
  regNo: string | null;
  name?: string;
  aadhaar: string;
  dob?: string | null;
  yob?: number | null;
}): Promise<QueueItem> {
  const item = stamp(newLinkItem({ ...p, id: crypto.randomUUID() }));
  const eng = getEngine();
  await eng.enqueue(item);
  void eng.runOnce();
  return item;
}

/** New registration: persisted locally with a client-generated beneficiary id, so a retry can never insert twice. */
export async function submitRegistration(p: {
  id?: string;
  name: string;
  payload: Record<string, unknown>;
  docs?: { profile?: Blob };
}): Promise<QueueItem> {
  const id = p.id ?? crypto.randomUUID();
  const item = stamp(newRegistrationItem({ id, name: p.name, payload: { ...p.payload, id }, docs: p.docs }));
  const eng = getEngine();
  await eng.enqueue(item);
  void eng.runOnce();
  return item;
}

/**
 * Older app versions kept the photo of the Aadhaar / UDID card on the phone (sync queue and unfinished-registration
 * drafts). Card images must not be stored anywhere: remove them. Typed details and profile photos are kept.
 */
export async function removeStoredCardImages(): Promise<void> {
  try {
    for (const i of await idbStore.getAll()) {
      const clean = stripCardImages(i);
      if (clean) await idbStore.put(clean);
    }
  } catch { /* IndexedDB unavailable: nothing stored */ }
  await stripDraftImages().catch(() => undefined);
}

export async function listQueue(): Promise<QueueItem[]> {
  return (await idbStore.getAll()).sort((a, b) => b.createdAt - a.createdAt);
}

export async function pendingForRoster(rosterId: string): Promise<QueueItem | undefined> {
  const all = await idbStore.getAll();
  return all.filter((i) => i.rosterId === rosterId && i.status !== "synced").sort((a, b) => b.createdAt - a.createdAt)[0];
}

export interface StorageHealth {
  persisted: boolean | null;
  usage?: number;
  quota?: number;
  low: boolean;
}

export async function requestPersistence(): Promise<StorageHealth> {
  const out: StorageHealth = { persisted: null, low: false };
  try {
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
    if (!out.persisted && navigator.storage?.persist) out.persisted = await navigator.storage.persist();
    if (navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      out.usage = usage;
      out.quota = quota;
      // low = less than 100 MB (~60 photos) headroom
      if (quota != null && usage != null) out.low = quota - usage < 100 * 1024 * 1024;
    }
  } catch {
    /* storage API unavailable; queue still works */
  }
  return out;
}
