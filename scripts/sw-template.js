/* FreedomCare service worker (generated into public/sw.js by scripts/make-sw.mjs after every build).
 *
 * Goal: the whole app opens and works with NO signal, including screens that were never opened online.
 *  1. INSTALL stores EVERY build file (JS, CSS, fonts, icons). The list is generated at build time, so a screen's code is
 *     on the phone even if nobody has opened that screen yet. (The old worker only stored files as they were requested.)
 *  2. Screens (HTML) are stored after sign-in (they need the login cookie) and served INSTANTLY from the phone, then
 *     refreshed in the background. A dead or slow connection can never make the app hang: network calls give up after
 *     a few seconds.
 *  3. Next.js client-side navigation (RSC requests) fails fast when there is no network, which makes Next fall back to a
 *     normal page load, and that is answered from the stored screens.
 * It never stores /api/*, Supabase calls or redirects. Queued work lives in IndexedDB and is sent by the page itself.
 */
const BUILD = "__BUILD_ID__";
const ASSETS = __ASSETS__;
const PAGES = __PAGES__;

const STATIC_CACHE = "fc2-static";
const PAGE_CACHE = "fc2-pages";

const sameOrigin = (u) => u.origin === self.location.origin;
const withTimeout = (p, ms) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

async function putStatic(cache, url) {
  const res = await fetch(url, { cache: "reload" });
  if (!res.ok) throw new Error(url + " " + res.status);
  await cache.put(url, res);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
      const todo = ASSETS.filter((a) => !have.has(a));
      // A few at a time so a slow connection is not flooded; one retry each. Any file that still fails aborts the install,
      // so the previous worker (and its files) keeps running and the install is attempted again on the next visit.
      for (let i = 0; i < todo.length; i += 6) {
        await Promise.all(
          todo.slice(i, i + 6).map(async (u) => {
            try { await putStatic(cache, u); } catch { await putStatic(cache, u); }
          }),
        );
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (!k.startsWith("fc2-")) await caches.delete(k); // old versions
      await self.clients.claim();
    })(),
  );
});

const isStaticAsset = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname.startsWith("/tesseract/") ||
  url.pathname.startsWith("/zxing/") ||
  /\.(?:png|jpg|jpeg|svg|ico|webp|woff2?|webmanifest)$/.test(url.pathname);

const isRsc = (req, url) => req.headers.get("RSC") === "1" || url.searchParams.has("_rsc");

const OFFLINE_HTML =
  "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>FreedomCare offline</title>" +
  "<body style='font-family:system-ui;padding:24px;max-width:32rem;margin:auto'><h1>No signal</h1>" +
  "<p>This screen is not stored on this phone yet. Open FreedomCare once with signal and wait until the Sync screen " +
  "shows everything ready for offline.</p><p><a href='/'>Try the home screen</a></p></body>";

async function revalidatePage(cache, req, key) {
  try {
    const res = await withTimeout(fetch(req), 15000);
    if (res.ok && !res.redirected) await cache.put(key, res.clone());
    else if (res.redirected && /\/login/.test(res.url)) await cache.delete(key); // session ended: do not keep showing the app
    return res;
  } catch {
    return null;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!sameOrigin(url) || url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url)) {
    // Cache first. ignoreSearch: the host may append ?dpl=<deployment> to asset URLs.
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  if (url.pathname === "/_next/image") {
    // next/image output (the logo): cache first, keyed by the full URL because the size is part of the query
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  if (isRsc(req, url)) {
    // Fail fast so Next.js falls back to a full page load (answered from the stored screens below).
    event.respondWith(withTimeout(fetch(req), 3000).catch(() => Response.error()));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGE_CACHE);
        const key = url.pathname; // ignores ?id=... so /distribution/profile?id=X shares one stored screen
        const isLogin = key.startsWith("/login");

        if (!isLogin) {
          const hit = await cache.match(key);
          if (hit) {
            event.waitUntil(revalidatePage(cache, req, key)); // refresh for next time, never block this load
            return hit;
          }
        }
        try {
          const res = await withTimeout(fetch(req), isLogin ? 5000 : 8000);
          if (res.ok && !res.redirected) cache.put(key, res.clone());
          return res;
        } catch {
          const hit = (await cache.match(key)) || (!isLogin && (await cache.match("/")));
          return hit || new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
      })(),
    );
  }
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  const reply = (m) => event.source && event.source.postMessage(m);

  if (type === "precache-pages") {
    // Screens need the login cookie, so the page asks for this after sign-in.
    event.waitUntil(
      (async () => {
        const cache = await caches.open(PAGE_CACHE);
        let failed = 0;
        for (const path of PAGES) {
          try {
            const res = await withTimeout(fetch(path, { credentials: "same-origin" }), 20000);
            if (res.ok && !res.redirected) await cache.put(path, res);
            else failed++;
          } catch {
            failed++;
          }
        }
        if (!failed) {
          // Everything current is stored: drop files of older builds (keep the scanner engine under /tesseract/).
          const keep = new Set(ASSETS);
          const sc = await caches.open(STATIC_CACHE);
          for (const r of await sc.keys()) {
            const p = new URL(r.url).pathname;
            if (p.startsWith("/_next/static/") && !keep.has(p)) await sc.delete(r);
          }
        }
        reply({ type: "pages-ready", ok: failed === 0, failed, build: BUILD });
      })(),
    );
  }

  if (type === "clear-pages") {
    // Sign-out on a shared phone: the next person must not see the previous person's stored screens.
    event.waitUntil(caches.delete(PAGE_CACHE).then(() => reply({ type: "pages-cleared" })));
  }

  if (type === "version") reply({ type: "version", build: BUILD });
});
