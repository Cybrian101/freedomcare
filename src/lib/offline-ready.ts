"use client";
// Truthful "will this phone work with no signal?" checks, read from the browser's own caches (not from a flag we set).

/** Screens the service worker stores after sign-in. Keep in sync with `pages` in scripts/make-sw.mjs. */
export const SHELL = ["/", "/registration", "/registration/new", "/registration/assign", "/attendance", "/distribution", "/distribution/profile", "/queue", "/admin"];

const PAGES = "fc2-pages";
const STATIC = "fc2-static";

export interface Readiness {
  /** the service worker is installed and controlling this page */
  worker: boolean;
  /** every build file (code, styles, fonts, icons) is stored */
  files: boolean;
  /** how many of this build's files are stored, of how many (shown while it is still storing) */
  filesStored?: number;
  filesTotal?: number;
  /** every screen in SHELL is stored */
  screens: boolean;
  /** the on-device reader (worker + engine + English data) is stored */
  scanner: boolean;
  /** service workers are supported at all (needs HTTPS or localhost) */
  supported: boolean;
}

const NONE: Readiness = { worker: false, files: false, screens: false, scanner: false, supported: false };

export async function checkReadiness(): Promise<Readiness> {
  if (typeof caches === "undefined" || !("serviceWorker" in navigator)) return NONE;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const out: Readiness = { ...NONE, supported: true, worker: !!reg?.active };

    if (await caches.has(STATIC)) {
      const c = await caches.open(STATIC);
      const stored = new Set((await c.keys()).map((r) => new URL(r.url).pathname));
      const mres = await c.match("/precache-manifest.json");
      if (mres) {
        const m = (await mres.json()) as { assets: string[] };
        out.filesTotal = m.assets.length;
        out.filesStored = m.assets.filter((a) => stored.has(a)).length;
        out.files = m.assets.length > 0 && out.filesStored === m.assets.length;
      }
      out.scanner =
        stored.has("/tesseract/worker.min.js") &&
        stored.has("/tesseract/lang/eng.traineddata.gz") &&
        [...stored].some((k) => /^\/tesseract\/tesseract-core.*\.js$/.test(k));
    }
    if (await caches.has(PAGES)) {
      const c = await caches.open(PAGES);
      out.screens = (await Promise.all(SHELL.map((p) => c.match(p)))).every(Boolean);
    }
    return out;
  } catch {
    return { ...NONE, supported: true };
  }
}

/** Ask the worker (if any) to store the screens now. Needs signal and a signed-in session. */
export async function precacheScreens(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  reg?.active?.postMessage({ type: "precache-pages" });
}

/** Sign-out: remove the stored screens so the next person on a shared phone does not see them. */
export async function clearStoredScreens(): Promise<void> {
  try {
    if (typeof caches !== "undefined") await caches.delete(PAGES);
  } catch { /* nothing stored */ }
}
