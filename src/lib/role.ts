"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Role = "admin" | "staff" | "registration" | "distribution" | "viewer" | null;

let cached: Role | undefined;
/** Forget the remembered role (called when the signed-in user changes). */
export function resetRole() {
  cached = undefined;
}

// The last role the server gave each login on this phone, so an admin who loses signal keeps the admin screens.
const KEY = (uid: string) => `fc.role:${uid}`;
function remembered(uid: string | undefined): Role | undefined {
  if (!uid) return undefined;
  try {
    const v = localStorage.getItem(KEY(uid));
    return v === null ? undefined : v === "none" ? null : (v as Role);
  } catch {
    return undefined;
  }
}
function remember(uid: string | undefined, r: Role) {
  if (!uid) return;
  try { localStorage.setItem(KEY(uid), r ?? "none"); } catch { /* storage blocked: the role is fetched again next time */ }
}

/**
 * The signed-in user's role (from public.my_role()). This only decides what the UI SHOWS. The real protection is
 * row-level security in the database: a non-admin gets no rows or photos even if they open /admin by hand.
 * Before the roles SQL has been run, role stays null and nothing admin-only is shown. Offline, the role last seen on this
 * phone for this login is used.
 */
export function useRole(): { role: Role; loaded: boolean } {
  const [state, setState] = useState<{ role: Role; loaded: boolean }>(
    cached === undefined ? { role: null, loaded: false } : { role: cached, loaded: true },
  );
  useEffect(() => {
    if (cached !== undefined) return;
    let dead = false;
    const sb = createClient();
    void sb.auth.getSession().then(({ data: s }) => { // local session: no network
      const uid = s.session?.user.id;
      const mem = remembered(uid);
      if (mem !== undefined && !dead) setState({ role: mem, loaded: true });
      sb.rpc("my_role").then(({ data, error }) => {
        if (error) { if (!dead && mem === undefined) setState({ role: null, loaded: true }); return; }
        const r = (data as Role) ?? null;
        cached = r;
        remember(uid, r);
        if (!dead) setState({ role: r, loaded: true });
      }, () => { if (!dead && mem === undefined) setState({ role: null, loaded: true }); });
    });
    return () => { dead = true; };
  }, []);
  return state;
}

/** Admins see the detail (camp totals, sync log, review notes); everyone else gets the short, simple screens. */
export function useIsAdmin(): boolean {
  return useRole().role === "admin";
}
