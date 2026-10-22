"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Role = "admin" | "staff" | "registration" | "distribution" | "viewer" | null;

let cached: Role | undefined;
/** Forget the remembered role (called when the signed-in user changes). */
export function resetRole() {
  cached = undefined;
}

/**
 * The signed-in user's role (from public.my_role()). This only decides what the UI SHOWS. The real protection is
 * row-level security in the database: a non-admin gets no rows or photos even if they open /admin by hand.
 * Before the roles SQL has been run, or when offline, role stays null and nothing admin-only is shown.
 */
export function useRole(): { role: Role; loaded: boolean } {
  const [state, setState] = useState<{ role: Role; loaded: boolean }>(
    cached === undefined ? { role: null, loaded: false } : { role: cached, loaded: true },
  );
  useEffect(() => {
    if (cached !== undefined) return;
    let dead = false;
    createClient()
      .rpc("my_role")
      .then(({ data, error }) => {
        const r = error ? null : ((data as Role) ?? null);
        if (!error) cached = r;
        if (!dead) setState({ role: r, loaded: true });
      }, () => { if (!dead) setState({ role: null, loaded: true }); });
    return () => { dead = true; };
  }, []);
  return state;
}
