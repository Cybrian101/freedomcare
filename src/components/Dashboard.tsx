import { Suspense } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rosterCounts } from "@/lib/roster";
import { DatasetPanel } from "@/components/DatasetPanel";
import { EndOfDayCard } from "@/components/SyncProvider";
import { Card, Page, PageHeader, ProgressRing, SectionTitle, Skeleton, Stat } from "@/components/ui";
import { OfflineReadiness } from "@/components/OfflineReadiness";
import { InstallPrompt } from "@/components/InstallPrompt";

async function Totals() {
  await connection();
  const supabase = await createClient();
  let c;
  try {
    c = await rosterCounts(supabase);
  } catch {
    return <Card className="text-ink-muted font-semibold">Camp totals need a connection. Registration and Distribution still work from this device.</Card>;
  }
  const target = c.total || 461;
  return (
    <>
      <Card className="flex items-center gap-5">
        <ProgressRing value={c.distributed} max={target} label="distributed" />
        <div className="min-w-0">
          <div className="text-sm font-bold uppercase tracking-wider text-ink-muted">Camp progress</div>
          <div className="text-4xl font-extrabold tabular-nums mt-1">
            {c.distributed}
            <span className="text-xl text-ink-muted font-bold"> / {target}</span>
          </div>
          <div className="text-ink-muted mt-1">aids handed over</div>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Stat label="Total beneficiaries" value={target} />
        <Stat label="Attended" value={c.attended} tone="info" />
        <Stat label="Distributed" value={c.distributed} tone="ok" />
        <Stat label="Pending handover" value={c.pending} tone="warn" hint="attended, not yet received" />
      </div>
    </>
  );
}

export function Dashboard() {
  return (
    <Page width="wide">
      <PageHeader title="Camp dashboard" subtitle="Distribution camp, Santhome, Chennai · 24 Oct 2026" />
      <Suspense
        fallback={
          <>
            <Skeleton className="h-40" />
            <div className="grid grid-cols-2 gap-3 mt-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          </>
        }
      >
        <Totals />
      </Suspense>

      <SectionTitle>Workflows</SectionTitle>
      <div className="grid gap-3 md:grid-cols-3">
        <a href="/registration" className="block rounded-3xl border border-teal-200 bg-teal-50 p-5 active:scale-[0.99] transition-transform">
          <div className="text-2xl font-extrabold text-teal-900">Register</div>
          <p className="mt-1 text-teal-900/80">Scan the Aadhaar, find the record or add a new member, and take a profile photo.</p>
        </a>
        <a href="/attendance" className="block rounded-3xl border border-sky-200 bg-sky-50 p-5 active:scale-[0.99] transition-transform">
          <div className="text-2xl font-extrabold text-sky-700">Attendance</div>
          <p className="mt-1 text-sky-700/80">Mark who has arrived by Reg. No., name, Aadhaar scan, or name and date of birth.</p>
        </a>
        <a href="/distribution" className="block rounded-3xl border border-emerald-200 bg-emerald-50 p-5 active:scale-[0.99] transition-transform">
          <div className="text-2xl font-extrabold text-emerald-900">Distribute</div>
          <p className="mt-1 text-emerald-900/80">Call the token number, find the person and photograph the handover.</p>
        </a>
      </div>

      <SectionTitle>This phone</SectionTitle>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <EndOfDayCard />
          <DatasetPanel />
        </div>
        <div className="space-y-3">
          <OfflineReadiness />
          <InstallPrompt />
        </div>
      </div>
    </Page>
  );
}
