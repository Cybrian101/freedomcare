"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "./cn";

type ToastTone = "ok" | "bad" | "info";
type T = { id: number; msg: string; tone: ToastTone };
const Ctx = createContext<(msg: string, tone?: ToastTone) => void>(() => {});

/** const toast = useToast(); toast("Saved", "ok"). Provider is mounted in the root layout. */
export const useToast = () => useContext(Ctx);

const tones: Record<ToastTone, string> = {
  ok: "bg-teal-800 text-white",
  bad: "bg-accent-700 text-white",
  info: "bg-ink text-white",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((msg: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, msg, tone }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed inset-x-0 bottom-24 lg:bottom-6 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none">
        {items.map((t) => (
          <div key={t.id} role="status" className={cn("pointer-events-auto rounded-2xl px-5 py-3 font-semibold shadow-pop animate-fade-up max-w-sm", tones[t.tone])}>
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
