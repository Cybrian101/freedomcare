"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import { useRole } from "@/lib/role";
import { useSync } from "@/components/SyncProvider";
import { DatasetPanel } from "@/components/DatasetPanel";
import { InstallPrompt } from "@/components/InstallPrompt";

const TILES = [
  { href: "/attendance", label: "Attendance", hint: "Scan the card, mark present", cls: "border-sky-200 bg-sky-50 text-sky-800" },
  { href: "/distribution", label: "Distribute", hint: "Token number, photo, save", cls: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  { href: "/registration", label: "Register", hint: "New person at the camp", cls: "border-teal-200 bg-teal-50 text-teal-900" },
];

/** One line: is everything sent? If not, one button to send it. */
function SyncLine() {
  const { pending, failed, online, retryNow } = useSync();
  if (pending === 0) return <p role="status" className="rounded-2xl bg-ok-bg px-4 py-3 text-center font-bold text-ok-fg">Everything is sent</p>;
  return (
    <div role="status" className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${failed ? "bg-bad-bg text-bad-fg" : "bg-warn-bg text-warn-fg"}`}>
      <p className="min-w-0 flex-1 font-bold">{pending} waiting to send{online ? "" : " (no signal)"}</p>
      <Button size="md" onClick={() => void retryNow()}>Send now</Button>
    </div>
  );
}

/** Home for staff: three big buttons and whether everything is sent. Nothing else to read. */
function Simple() {
  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <h1 className="text-2xl font-extrabold text-ink">What are you doing?</h1>
      <div className="grid gap-3">
        {TILES.map((t) => (
          <a key={t.href} href={t.href} className={`flex min-h-24 flex-col justify-center rounded-3xl border px-6 py-4 transition-transform active:scale-[0.99] ${t.cls}`}>
            <span className="text-3xl font-extrabold">{t.label}</span>
            <span className="text-base font-semibold opacity-80">{t.hint}</span>
          </a>
        ))}
      </div>
      <SyncLine />
      <DatasetPanel compact />
      <InstallPrompt />
    </div>
  );
}

/** Admins see `children` (the full dashboard); everyone else the simple home. */
export function StaffHome({ children }: { children: ReactNode }) {
  const { role } = useRole();
  return role === "admin" ? <>{children}</> : <Simple />;
}
