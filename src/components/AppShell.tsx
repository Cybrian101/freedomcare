"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { cn } from "@/components/ui/cn";
import { useRole } from "@/lib/role";

const nav = [
  { href: "/", label: "Home", d: "M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/registration", label: "Register", d: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" },
  { href: "/attendance", label: "Attendance", d: "M9 11l3 3 8-8M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11" },
  { href: "/distribution", label: "Distribute", d: "M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" },
  { href: "/queue", label: "Sync", d: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
];

const adminItem = { href: "/admin", label: "Admin", d: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" };

function Icon({ d, active }: { d: string; active?: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

/**
 * App chrome. Props: `syncSlot` (node shown in header, e.g. a pending-sync pill),
 * `userEmail`, `signOutAction` (server action for the sign-out form).
 */
export function AppShell({
  children,
  syncSlot,
  accountSlot,
}: {
  children: React.ReactNode;
  syncSlot?: React.ReactNode;
  /** signed-in user + sign-out, streamed in separately so the shell itself never waits on auth */
  accountSlot?: React.ReactNode;
}) {
  const path = usePathname();
  const { role } = useRole();
  const items = role === "admin" ? [...nav, adminItem] : nav;
  const online = useOnline();
  const isActive = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));

  const status = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold",
        online ? "bg-ok-bg text-ok-fg" : "bg-bad-bg text-bad-fg",
      )}
      role="status"
    >
      <span className={cn("size-2 rounded-full", online ? "bg-ok-fg" : "bg-bad-fg animate-pulse")} aria-hidden />
      <span className="max-[359px]:sr-only">{online ? "Online" : "Offline"}</span>
    </span>
  );

  return (
    <div className="flex-1 flex flex-col lg:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-line bg-white p-5 sticky top-0 h-dvh">
        <Link href="/" aria-label="FreedomCare home">
          <Image src="/logo.png" alt="Freedom Trust" width={385} height={182} className="h-16 w-auto" priority />
        </Link>
        <nav className="mt-8 flex flex-col gap-1" aria-label="Main">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-4 min-h-12 font-semibold transition-colors",
                isActive(n.href) ? "bg-teal-50 text-teal-800" : "text-ink-soft hover:bg-sage-100",
              )}
            >
              <Icon d={n.d} active={isActive(n.href)} />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="flex flex-wrap gap-2">
            {status}
            {syncSlot}
          </div>
          {accountSlot}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-2 bg-white/95 backdrop-blur border-b border-line px-3 sm:px-4 h-16">
          <Link href="/" aria-label="FreedomCare home">
            <Image src="/logo.png" alt="Freedom Trust" width={385} height={182} className="h-9 sm:h-10 w-auto shrink-0" priority />
          </Link>
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            {syncSlot}
            {status}
          </div>
        </header>

        <main className="flex-1 w-full min-w-0 px-4 py-5 pb-28 sm:px-6 lg:px-10 lg:py-8 lg:pb-10 animate-fade-up">{children}</main>

        {/* Mobile bottom nav */}
        <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-line pb-safe">
          <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
            {items.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center justify-center gap-0.5 min-h-16 min-w-0 px-0.5 text-xs leading-tight min-[360px]:text-[13px] font-bold transition-colors",
                    isActive(n.href) ? "text-teal-700" : "text-ink-muted",
                  )}
                >
                  <span className={cn("rounded-full px-3 sm:px-5 py-1 transition-colors", isActive(n.href) && "bg-teal-100")}>
                    <Icon d={n.d} active={isActive(n.href)} />
                  </span>
                  <span className="max-w-full truncate">{n.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
