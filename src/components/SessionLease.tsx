"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Offline staff sessions are bounded. Each successful online check of the Supabase session renews a lease
// (a timestamp only: no password and no token is stored by this component). After LEASE_MS without a successful
// online check, the screen locks until the device is online again and the session is re-verified. Locking hides the
// UI only; unsynced IndexedDB work is untouched and uploads once the session is valid.
const KEY = "fc.sessionLeaseAt";
const LEASE_MS = 12 * 60 * 60 * 1000;

const read = () => {
  try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; }
};
const write = (t: number) => {
  try { localStorage.setItem(KEY, String(t)); } catch { /* private mode: lease cannot persist, treated as expired on next start */ }
};

export function SessionLease() {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const sb = createClient();
    let dead = false;

    async function verify() {
      if (!navigator.onLine) {
        if (!dead) setLocked(Date.now() - read() > LEASE_MS);
        return;
      }
      try {
        const { data, error } = await sb.auth.getUser(); // asks the auth server, not just the cookie
        if (dead) return;
        if (data.user) { write(Date.now()); setLocked(false); }
        else if (error && /session|jwt|token/i.test(error.message)) window.location.replace("/login");
        else setLocked(Date.now() - read() > LEASE_MS); // server unreachable though "online": keep the old lease
      } catch {
        if (!dead) setLocked(Date.now() - read() > LEASE_MS);
      }
    }

    void verify();
    const { data: sub } = sb.auth.onAuthStateChange((ev) => {
      if (ev === "SIGNED_IN" || ev === "TOKEN_REFRESHED") write(Date.now());
      if (ev === "SIGNED_OUT") { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
    });
    const on = () => void verify();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    const t = setInterval(on, 5 * 60 * 1000);
    return () => {
      dead = true;
      sub.subscription.unsubscribe();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      clearInterval(t);
    };
  }, []);

  if (!locked) return null;
  return (
    <div role="alertdialog" aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-white p-6">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-xl font-extrabold text-ink">Sign-in needs refreshing</h1>
        <p className="text-ink-muted">
          This device has been offline for more than 12 hours. Connect to the internet to continue. Anything already saved
          on this device is kept and will upload once you are back online.
        </p>
      </div>
    </div>
  );
}
