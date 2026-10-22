"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { datasetMeta, downloadDataset, isReady, type DatasetMeta } from "@/lib/local-db";

// One shared snapshot so every panel/page sees the same state after a download.
let autoTried = false; // one automatic first download per page load
let snap: { meta: DatasetMeta | null; loaded: boolean; busy: boolean; error: string | null } = {
  meta: null, loaded: false, busy: false, error: null,
};
const subs = new Set<() => void>();
const set = (p: Partial<typeof snap>) => { snap = { ...snap, ...p }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const get = () => snap;
const server = () => snap;

export function useDataset() {
  const s = useSyncExternalStore(subscribe, get, server);
  useEffect(() => {
    if (!snap.loaded) void datasetMeta().then((meta) => set({ meta, loaded: true }));
  }, []);
  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (snap.busy) return;
    set({ busy: true, error: opts?.silent ? snap.error : null });
    const r = await downloadDataset(createClient());
    if (r.ok) set({ meta: r.meta, busy: false, error: null });
    else if (opts?.silent) set({ busy: false }); // keep the list we have; the "last downloaded" time shows its age
    else set({ busy: false, error: navigator.onLine ? `Download failed: ${r.message}` : "You are offline. Connect once to download the list." });
  }, []);
  return { ...s, ready: isReady(s.meta), refresh };
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function DatasetPanel({ compact = false }: { compact?: boolean }) {
  const { meta, loaded, busy, error, ready, refresh } = useDataset();

  // First visit on an online device with no list at all: fetch it without making staff hunt for the button.
  useEffect(() => {
    if (loaded && !meta && !autoTried && navigator.onLine) {
      autoTried = true;
      void refresh();
    }
  }, [loaded, meta, refresh]);

  const partial = !!meta && !ready;
  const tone = ready ? "bg-ok-bg text-ok-fg" : partial ? "bg-warn-bg text-warn-fg" : "bg-bad-bg text-bad-fg";
  const headline = !loaded
    ? "Checking this device..."
    : ready
      ? `Offline-ready: ${meta!.count} beneficiaries on this device`
      : partial
        ? `Incomplete list (${meta!.count} of ${meta!.serverCount ?? "?"}) - not safe to rely on offline`
        : "No beneficiary list on this device yet";

  return (
    <Card className={compact ? "space-y-2" : "space-y-3"}>
      <div className={`rounded-2xl px-4 py-3 text-sm font-bold ${tone}`} role="status">
        {headline}
      </div>
      {meta && (
        <p className="text-xs text-ink-muted">
          Last downloaded {fmt(meta.downloadedAt)}
          {meta.verifiedAt ? " - count matched the server" : ""}.
        </p>
      )}
      {!ready && !compact && (
        <p className="text-xs text-ink-muted">
          Search works offline only for beneficiaries already downloaded to this device. A person missing from this
          list cannot be found without a connection.
        </p>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-bad-fg">{error}</p>}
      <Button variant={ready ? "secondary" : "primary"} full onClick={() => void refresh()} loading={busy}>
        {meta ? "Refresh list" : "Download list for offline use"}
      </Button>
    </Card>
  );
}

const AUTO_MS = 5 * 60 * 1000;

/** Keeps every phone's list fresh (so statuses from the other five desks show up). Renders nothing. */
export function RosterAutoRefresh() {
  const { refresh, loaded, meta } = useDataset();
  useEffect(() => {
    if (!loaded || !meta) return; // first-ever download is handled (and reported) by DatasetPanel
    const tick = () => {
      if (navigator.onLine && document.visibilityState === "visible") void refresh({ silent: true });
    };
    const age = Date.now() - new Date(meta.downloadedAt).getTime();
    const first = setTimeout(tick, Math.max(0, AUTO_MS - age)); // do not re-download on every page open
    const t = setInterval(tick, AUTO_MS);
    window.addEventListener("online", tick);
    return () => { clearTimeout(first); clearInterval(t); window.removeEventListener("online", tick); };
  }, [loaded, meta?.downloadedAt, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
