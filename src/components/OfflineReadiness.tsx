"use client";
import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
import { useDataset } from "@/components/DatasetPanel";
import { checkReadiness, precacheScreens, type Readiness } from "@/lib/offline-ready";
import { warmOcrEngine } from "@/lib/ocr/client";

/**
 * Checklist of what this phone can do with no signal. Each tick is read from what is actually stored on the phone.
 * `compact` shows one line (expandable), used on the Sync screen so the log itself stays at the top.
 */
export function OfflineReadiness({ compact = false }: { compact?: boolean }) {
  const { ready: listReady, meta, busy, refresh } = useDataset();
  const [r, setR] = useState<Readiness | null>(null);
  const [working, setWorking] = useState(false);
  const [open, setOpen] = useState(!compact);

  const check = useCallback(() => { void checkReadiness().then(setR); }, []);
  useEffect(() => {
    check();
    window.addEventListener("fc:readiness", check);
    const t = setInterval(check, 10_000);
    return () => { window.removeEventListener("fc:readiness", check); clearInterval(t); };
  }, [check]);

  async function prepare() {
    setWorking(true);
    try {
      await precacheScreens();
      await Promise.all([refresh(), warmOcrEngine()]);
      await new Promise((res) => setTimeout(res, 1500)); // let the worker finish storing the screens
    } finally {
      setWorking(false);
      check();
    }
  }

  const unsupported = r?.supported === false;
  const rows: { ok: boolean; label: string; hint: string }[] = [
    {
      ok: listReady,
      label: "Beneficiary list on this phone",
      hint: meta ? (listReady ? `${meta.count} people downloaded and verified` : "Downloaded but not verified complete. Download again.") : "Not downloaded yet",
    },
    {
      ok: !!r?.files,
      label: "App files stored",
      hint: unsupported ? "Not supported here (needs the https site)" : r?.files ? "All the app's code is on this phone" : r?.worker ? "Still being stored..." : "Not installed yet. Open the app once with signal.",
    },
    {
      ok: !!r?.screens,
      label: "Screens open without signal",
      hint: unsupported ? "Not supported here (needs the https site)" : r?.screens ? "Stored" : "Not stored yet. Sign in with signal and wait a moment.",
    },
    {
      ok: !!r?.scanner,
      label: "Aadhaar / UDID scanner works without signal",
      hint: r?.scanner ? "Stored on this phone" : "Not stored yet. Needs one online load (about 7 MB).",
    },
  ];
  const done = rows.filter((x) => x.ok).length;
  const all = done === rows.length;

  return (
    <Card className={`space-y-3 ${all ? "border-ok-fg/30" : "border-warn-fg/40"}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
      >
        <span className={`text-lg font-bold ${all ? "text-ok-fg" : "text-warn-fg"}`}>
          {all ? "This phone is ready for offline" : `Offline: ${done} of ${rows.length} ready`}
        </span>
        <span aria-hidden className="text-xl text-ink-muted">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <>
          <ul className="space-y-2">
            {rows.map((x) => (
              <li key={x.label} className="flex items-start gap-3">
                <span aria-hidden className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${x.ok ? "bg-ok-bg text-ok-fg" : "bg-bad-bg text-bad-fg"}`}>{x.ok ? "✓" : "!"}</span>
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{x.label}</span>
                  <span className="block text-sm text-ink-muted">{x.hint}</span>
                </span>
              </li>
            ))}
          </ul>
          {!all && (
            <Button full loading={working || busy} disabled={typeof navigator !== "undefined" && !navigator.onLine} onClick={() => void prepare()}>
              Get this phone ready (needs signal)
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
