"use client";
import { useEffect } from "react";
import { checkReadiness, precacheScreens } from "@/lib/offline-ready";
import { warmOcrEngine } from "@/lib/ocr/client";
import { createClient } from "@/lib/supabase/client";

let warming = false;
let lastPrecache = 0;

/**
 * Registers the service worker and keeps this phone ready for offline: after sign-in (and whenever the phone comes back
 * online) it asks the worker to store the screens, and it loads the on-device scanner once so its files are stored too.
 * Runs in production builds only (a dev server has no service worker, so offline cannot be tested there).
 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let dead = false;

    const sb = createClient();
    const prepare = async () => {
      if (dead || !navigator.onLine) return;
      // Screens and the scanner are stored only for a signed-in phone (the worker itself installs on every visit).
      const { data } = await sb.auth.getSession();
      if (!data.session) return;
      if (Date.now() - lastPrecache > 5 * 60_000) {
        lastPrecache = Date.now();
        await precacheScreens();
      }
      if (warming || (await checkReadiness()).scanner) return;
      warming = true;
      await warmOcrEngine();
      warming = false;
      window.dispatchEvent(new Event("fc:readiness"));
    };

    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "pages-ready") window.dispatchEvent(new Event("fc:readiness"));
    };
    navigator.serviceWorker.addEventListener("message", onMsg);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(async () => {
        await navigator.serviceWorker.ready;
        setTimeout(() => void prepare(), 1500);
      })
      .catch(() => undefined); // no service worker => the app still works online; offline start is unavailable

    const { data: auth } = sb.auth.onAuthStateChange((ev) => {
      if (ev === "SIGNED_IN") { lastPrecache = 0; setTimeout(() => void prepare(), 800); }
    });
    // The browser offers "install" only once and early: keep the event so the Install button can use it later.
    const onInstall = (e: Event) => {
      e.preventDefault();
      (window as unknown as { __fcInstall?: Event }).__fcInstall = e;
      window.dispatchEvent(new Event("fc:install"));
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    const onOnline = () => void prepare();
    window.addEventListener("online", onOnline);
    const onVis = () => { if (document.visibilityState === "visible") void prepare(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      dead = true;
      auth.subscription.unsubscribe();
      window.removeEventListener("beforeinstallprompt", onInstall);
      navigator.serviceWorker.removeEventListener("message", onMsg);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return null;
}
