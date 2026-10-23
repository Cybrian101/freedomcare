"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/lib/role";
import { DashboardView } from "./DashboardView";

/** The dashboard is for dashboard logins and admins. Staff are sent to their own home screen. */
export function DashboardGate() {
  const { role, loaded } = useRole();
  const router = useRouter();
  const allowed = role === "viewer" || role === "admin";
  useEffect(() => { if (loaded && !allowed) router.replace("/"); }, [loaded, allowed, router]);
  if (!loaded) return <p className="p-4 text-ink-muted">Loading...</p>;
  return allowed ? <DashboardView /> : null;
}
