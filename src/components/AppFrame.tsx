import { getClaimsCached } from "@/lib/supabase/claims";
import { Suspense } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/login/actions";
import { AppShell } from "./AppShell";
import { SyncProvider, SyncPill, PendingBanner, WhoAmI } from "./SyncProvider";
import { RosterAutoRefresh } from "./DatasetPanel";
import { SignOutForm } from "./SignOutForm";
import { SessionLease } from "./SessionLease";

/** Reads the signed-in user. This is request-time data, so it lives under its own Suspense boundary and the
 *  surrounding shell (nav, header, children) stays deterministic. */
async function Account() {
  await connection(); // signed-in user is request-time data: never evaluate token expiry (Date.now) while prerendering
  const supabase = await createClient();
  const { data } = await getClaimsCached(supabase);
  const email = typeof data?.claims?.email === "string" ? data.claims.email : undefined;
  return <SignOutForm email={email} action={signOut} />;
}

export function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <SyncProvider>
      <SessionLease />
      <RosterAutoRefresh />
      <AppShell
        syncSlot={<SyncPill />}
        accountSlot={
          <Suspense fallback={null}>
            <Account />
          </Suspense>
        }
      >
        <WhoAmI />
        <PendingBanner />
        {children}
      </AppShell>
    </SyncProvider>
  );
}
