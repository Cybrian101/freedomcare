"use client";
// Browser wiring for the handover-photo queue: IndexedDB store + Supabase remote + singleton engine + triggers.
import { openDB, type IDBPDatabase } from "idb";
import { createClient } from "@/lib/supabase/client";
import { completeDistribution, linkAadhaar, markAttendance } from "@/lib/roster";
import {
  QueueError,
  SyncEngine,
  newItem,
  newAttendanceItem,
  newLinkItem,
  newRegistrationItem,
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
const PERM_RE = /beneficiary not found|photo required|different aadhaar|already on another record|invalid aadhaar format|invalid input syntax for type uuid|beneficiaries_aadhaar_no_key|violates (check|not-null)/i;
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
  async link(rosterId, aadhaar, dob, yob) {
    try {
      await linkAadhaar(createClient(), rosterId, aadhaar, dob, yob);
    } catch (e) {
      throw classify(e);
    }
  },
  async register(id, row) {
    const { error } = await createClient().from("beneficiaries").insert({ ...row, id });
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

/** Attendance is saved on the device first and synced like everything else. */
export async function submitAttendance(p: { rosterId: string; regNo: string | null; name?: string; dob?: string | null }): Promise<QueueItem> {
  const item = stamp(newAttendanceItem({ ...p, id: crypto.randomUUID() }));
  const eng = getEngine();
  await eng.enqueue(item);
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
  docs?: { aadhaar?: Blob; udid?: Blob };
}): Promise<QueueItem> {
  const id = p.id ?? crypto.randomUUID();
  const item = stamp(newRegistrationItem({ id, name: p.name, payload: { ...p.payload, id }, docs: p.docs }));
  const eng = getEngine();
  await eng.enqueue(item);
  void eng.runOnce();
  return item;
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
