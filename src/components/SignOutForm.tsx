"use client";
import { useEffect, useRef, useState } from "react";
import { useSync } from "@/components/SyncProvider";
import { clearLocalDataset, listDrafts } from "@/lib/local-db";
import { clearStoredScreens } from "@/lib/offline-ready";

/**
 * Sign-out for a possibly shared device. It refuses while unsynced work exists (signing out would strand it),
 * and otherwise removes the cached beneficiary list so the next person on the device does not inherit it.
 */
export function SignOutForm({ email, action }: { email?: string; action: () => void | Promise<void> }) {
  const { pending } = useSync();
  const [msg, setMsg] = useState<string | null>(null);
  const [drafts, setDrafts] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const cleared = useRef(false);

  useEffect(() => {
    let dead = false;
    const load = () => void listDrafts().then((d) => { if (!dead) setDrafts(d.length); });
    load();
    window.addEventListener("focus", load);
    return () => { dead = true; window.removeEventListener("focus", load); };
  }, []);

  return (
    <div className="space-y-1">
      {email && <p className="text-xs text-ink-muted truncate">{email}</p>}
      <form
        action={action}
        onSubmit={async (e) => {
          if (pending > 0) {
            e.preventDefault();
            setMsg(`${pending} item${pending === 1 ? "" : "s"} on this device have not reached the server. Sync them before signing out.`);
            return;
          }
          // Unfinished drafts are not in the queue yet. Never wipe them silently.
          if (drafts > 0 && !confirmed) {
            e.preventDefault();
            setConfirmed(true);
            setMsg("There is an unfinished registration or unsent handover photo on this device. Signing out deletes it. Tap Sign out again to confirm, or go back and finish it.");
            return;
          }
          if (!cleared.current) {
            // Wipe the cached list BEFORE the redirect, then submit again.
            e.preventDefault();
            const form = e.currentTarget;
            await clearLocalDataset().catch(() => undefined);
            await clearStoredScreens(); // stored screens belong to the person who is signing out
            cleared.current = true;
            form.requestSubmit();
          }
        }}
      >
        <button className="text-sm font-semibold text-accent-600 min-h-11 hover:underline">Sign out</button>
      </form>
      {msg && <p role="alert" className="text-xs font-semibold text-bad-fg">{msg}</p>}
    </div>
  );
}
