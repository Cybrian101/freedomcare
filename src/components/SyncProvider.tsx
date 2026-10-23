"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { resetRole } from "@/lib/role";
import { getEngine, listQueue, removeStoredCardImages, requestPersistence, setOwner, type QueueItem, type StorageHealth } from "@/lib/offline-queue";

interface SyncCtx {
  items: QueueItem[];
  pending: number; // not yet on the server
  failed: number; // failed or rejected
  syncing: boolean;
  online: boolean;
  storage: StorageHealth | null;
  retryNow: () => Promise<void>;
  retryItem: (id: string) => Promise<void>;
  removeItem: (id: string) => Promise<boolean>;
  adoptItem: (id: string) => Promise<void>;
  /** signed-in user id on this device (null until known) */
  me: string | null;
  meEmail: string | null;
  /** the staff member's name (falls back to the email before the @) */
  meName: string | null;
}

const Ctx = createContext<SyncCtx | null>(null);

export function useSync(): SyncCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSync must be used inside <SyncProvider>");
  return c;
}

const TICK_MS = 15_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);
  const [storage, setStorage] = useState<StorageHealth | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [meName, setMeName] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const all = await listQueue();
      if (alive.current) setItems(all);
    } catch {
      /* IndexedDB unavailable */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const eng = getEngine();
    const unsub = eng.subscribe(() => void refresh());
    const run = () => void eng.runOnce();
    const upd = () => setOnline(navigator.onLine);
    const onOnline = () => {
      upd();
      void eng.runOnce({ force: true });
    };
    const onVis = () => {
      if (document.visibilityState === "visible") run();
    };
    upd();
    // Who is signed in is read from the local session (no network) so every queued item is stamped with it.
    const sb = createClient();
    const applyUser = (u: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null) => {
      // The name the admin typed when creating this login travels in the session, so it is known offline too.
      const meta = u?.user_metadata?.full_name;
      const name = u ? (typeof meta === "string" && meta.trim() ? meta.trim() : u.email?.split("@")[0]) : undefined;
      setOwner(u ? { id: u.id, email: u.email, name } : null);
      resetRole();
      setMe(u?.id ?? null);
      setMeEmail(u?.email ?? null);
      setMeName(name ?? null);
      if (u) void eng.runOnce();
    };
    void sb.auth.getSession().then(({ data }) => applyUser(data.session?.user ?? null));
    const { data: authSub } = sb.auth.onAuthStateChange((_e, session) => applyUser(session?.user ?? null));
    (async () => {
      await removeStoredCardImages();
      await eng.recover();
      await refresh();
      run();
      setStorage(await requestPersistence());
    })();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", upd);
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(run, TICK_MS); // runOnce honours per-item backoff
    return () => {
      alive.current = false;
      unsub();
      authSub.subscription.unsubscribe();
      clearInterval(t);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", upd);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const value = useMemo<SyncCtx>(() => {
    const eng = getEngine;
    return {
      items,
      pending: items.filter((i) => i.status !== "synced").length,
      failed: items.filter((i) => i.status === "failed" || i.status === "rejected").length,
      syncing: items.some((i) => i.status === "syncing"),
      online,
      storage,
      retryNow: async () => {
        await eng().retryAll();
        await eng().runOnce({ force: true });
      },
      retryItem: async (id) => {
        await eng().retry(id);
        void eng().runOnce({ force: true });
      },
      removeItem: (id) => eng().remove(id),
      adoptItem: async (id) => {
        await eng().adopt(id);
        void eng().runOnce({ force: true });
      },
      me,
      meEmail,
      meName,
    };
  }, [items, online, storage, me, meEmail, meName]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Header pill: online dot + pending count; links to /queue. */
export function SyncPill({ className = "" }: { className?: string }) {
  const { pending, failed, syncing, online } = useSync();
  const tone = !online
    ? "bg-amber-100 text-amber-900 border-amber-300"
    : failed > 0
      ? "bg-red-100 text-red-900 border-red-300"
      : pending > 0
        ? "bg-sky-100 text-sky-900 border-sky-300"
        : "bg-emerald-100 text-emerald-900 border-emerald-300";
  const label = !online
    ? pending > 0 ? `Offline - ${pending} waiting` : "Offline"
    : syncing ? `Syncing ${pending}` : pending > 0 ? `${pending} to sync` : "Synced";
  return (
    <Link
      href="/queue"
      aria-label={`Sync status: ${label}`}
      className={`inline-flex min-w-0 max-w-[10.5rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone} ${className}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${online ? "bg-emerald-600" : "bg-amber-600"} ${syncing ? "animate-pulse" : ""}`} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** Strip above every screen while anything on this device has not been confirmed by the server. */
export function PendingBanner() {
  const { pending, failed, online, items, me } = useSync();

  // Desktop browsers show a leave-page warning; phones ignore it, which is why the banner itself matters.
  useEffect(() => {
    if (pending === 0) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [pending]);

  if (pending === 0) return null;
  const foreign = items.filter((i) => i.status !== "synced" && i.ownerId && me && i.ownerId !== me && !i.adopted).length;
  const bad = failed > 0 || foreign > 0;
  return (
    <Link
      href="/queue"
      role="status"
      className={`mx-auto mb-3 block w-full max-w-xl rounded-2xl px-4 py-3 text-sm font-bold ${bad ? "bg-bad-bg text-bad-fg" : "bg-warn-bg text-warn-fg"}`}
    >
      {pending} item{pending === 1 ? "" : "s"} not yet confirmed by the server
      {foreign > 0 ? ` - ${foreign} captured under another login` : failed > 0 ? ` - ${failed} need attention` : online ? " - sending..." : " - waiting for signal"}.
      Keep this app open and do not clear browser data. Tap to review.
    </Link>
  );
}

/** Home-screen check for the end of the day. */
export function EndOfDayCard() {
  const { pending, failed, online, retryNow } = useSync();
  const clear = pending === 0;
  return (
    <div className={`rounded-3xl border p-5 ${clear ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
      <div className={`text-lg font-extrabold ${clear ? "text-emerald-900" : "text-amber-900"}`}>
        {clear ? "All clear: everything on this device is confirmed" : `${pending} item${pending === 1 ? "" : "s"} still on this device only`}
      </div>
      {!clear && (
        <>
          <p className="mt-1 text-sm text-amber-900">
            {online ? "Connected. Uploads run automatically." : "No signal. Do not leave the camp until this reaches zero."}
            {failed > 0 ? ` ${failed} need attention.` : ""}
          </p>
          <button onClick={() => void retryNow()} className="mt-3 min-h-12 w-full rounded-2xl bg-amber-700 font-bold text-white">
            Sync now
          </button>
        </>
      )}
    </div>
  );
}

/** One login per phone: make it obvious whose login this phone is using. */
export function WhoAmI() {
  const { meEmail, meName } = useSync();
  if (!meEmail) return null;
  return <p className="mb-2 truncate text-xs text-ink-muted">Signed in as <span className="font-semibold">{meName ?? meEmail}</span></p>;
}
