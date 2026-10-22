/* FreedomCare service worker: lets the app shell open with no connection.
 *
 * What it does NOT do: it never caches /api/*, Supabase calls, or redirected/login responses, and it does not
 * replay queued work. Pending registrations, attendance and handover photos live in IndexedDB and are retried by
 * the page itself (see src/lib/offline-queue.ts), so nothing depends on this worker staying alive.
 */
const VERSION = "fc-v1";
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

const isStatic = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname.startsWith("/tesseract/") ||
  /\.(?:png|jpg|jpeg|svg|ico|webp|woff2?|webmanifest)$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase etc. go straight to the network
  if (url.pathname.startsWith("/api/")) return;

  if (isStatic(url)) {
    event.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES);
        try {
          const res = await fetch(req);
          // Only cache real pages: skip redirects (e.g. to /login) and errors.
          if (res.ok && !res.redirected && !url.pathname.startsWith("/login")) {
            cache.put(url.pathname, res.clone()); // key ignores ?query so /distribution/profile?id=X shares one shell
          }
          return res;
        } catch {
          const hit = (await cache.match(url.pathname)) || (await cache.match("/"));
          if (hit) return hit;
          return new Response(
            "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>FreedomCare offline</title>" +
              "<body style='font-family:system-ui;padding:24px'><h1>Offline</h1><p>This page has not been opened on this device yet. " +
              "Open FreedomCare once while online so it can be used without a connection.</p>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
  }
});

// The page asks us to warm the shell for the main screens right after sign-in.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "precache") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGES);
      for (const path of event.data.urls || []) {
        try {
          const res = await fetch(path, { credentials: "same-origin" });
          if (res.ok && !res.redirected) await cache.put(path, res);
        } catch {
          /* offline right now: try again next start */
        }
      }
    })(),
  );
});
