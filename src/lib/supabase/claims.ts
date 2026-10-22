import type { SupabaseClient } from "@supabase/supabase-js";

// getClaims() verifies the JWT locally when the project uses asymmetric signing keys, but it has to know the public
// keys. Every request builds a fresh Supabase client, and a fresh client downloads the key set from Supabase first
// (~0.6 s+). Caching the (public) key set in this server process makes the check effectively free.
// Safe: it is public data, and the signature, expiry and issuer are still verified on every request.
type Jwks = { keys: Array<Record<string, unknown>> };
const TTL_MS = 10 * 60 * 1000;
let cache: { jwks: Jwks; at: number } | null = null;
let inflight: Promise<Jwks | null> | null = null;

async function loadJwks(): Promise<Jwks | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/auth/v1/.well-known/jwks.json`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!res.ok) return null;
    const jwks = (await res.json()) as Jwks;
    return Array.isArray(jwks.keys) && jwks.keys.length ? jwks : null;
  } catch {
    return null;
  }
}

async function getJwks(): Promise<Jwks | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.jwks;
  inflight ??= loadJwks().finally(() => {
    inflight = null;
  });
  const jwks = await inflight;
  if (jwks) cache = { jwks, at: Date.now() };
  return jwks ?? cache?.jwks ?? null; // on a failed refresh keep using the last good key set
}

/** Drop-in for supabase.auth.getClaims() with the key set cached across requests. Falls back to the default path. */
export async function getClaimsCached(supabase: SupabaseClient) {
  const jwks = await getJwks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase.auth.getClaims(undefined, jwks ? { jwks: jwks as any } : undefined);
}
