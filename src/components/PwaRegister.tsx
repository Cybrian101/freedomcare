"use client";
import { useEffect } from "react";
import { SHELL, checkReadiness } from "@/lib/offline-ready";
import { warmOcrEngine } from "@/lib/ocr/client";

let warming = false;

/** Registers the service worker, then (while online) stores the main screens and the on-device scanner so they work offline. */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let dead = false;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(async () => {
        const reg = await navigator.serviceWorker.ready;
        if (dead || !navigator.onLine) return;
        reg.active?.postMessage({ type: "precache", urls: SHELL });
        // Give the screens a moment, then load the scanner once so its files are cached for offline use.
        setTimeout(async () => {
          if (dead || warming || !navigator.onLine) return;
          if ((await checkReadiness()).scanner) return;
          warming = true;
          await warmOcrEngine();
          warming = false;
          window.dispatchEvent(new Event("fc:readiness"));
        }, 4000);
      })
      .catch(() => undefined); // no service worker => the app still works online; offline start is unavailable
    return () => { dead = true; };
  }, []);
  return null;
}
