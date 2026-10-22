"use client";
// Truthful "will this phone work with no signal?" checks, read from the browser's own caches (not from a flag we set).

/** Screens the service worker is asked to keep, so they open offline. */
export const SHELL = ["/", "/registration", "/registration/new", "/attendance", "/distribution", "/distribution/profile", "/queue"];

const PAGES = "fc-v1-pages";
const STATIC = "fc-v1-static";

export interface Readiness {
  /** every screen in SHELL is stored */
  screens: boolean;
  /** the on-device reader (worker + engine + English data) is stored */
  scanner: boolean;
  /** service workers are supported at all (needs HTTPS or localhost) */
  supported: boolean;
}

export async function checkReadiness(): Promise<Readiness> {
  if (typeof caches === "undefined" || !("serviceWorker" in navigator)) return { screens: false, scanner: false, supported: false };
  try {
    let screens = false;
    let scanner = false;
    if (await caches.has(PAGES)) {
      const c = await caches.open(PAGES);
      const hits = await Promise.all(SHELL.map((p) => c.match(p)));
      screens = hits.every(Boolean);
    }
    if (await caches.has(STATIC)) {
      const c = await caches.open(STATIC);
      const keys = (await c.keys()).map((r) => new URL(r.url).pathname);
      scanner =
        keys.includes("/tesseract/worker.min.js") &&
        keys.includes("/tesseract/lang/eng.traineddata.gz") &&
        keys.some((k) => /^\/tesseract\/tesseract-core.*\.js$/.test(k));
    }
    return { screens, scanner, supported: true };
  } catch {
    return { screens: false, scanner: false, supported: true };
  }
}
