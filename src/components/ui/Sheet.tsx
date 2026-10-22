"use client";
import { useEffect, useRef } from "react";

/**
 * Bottom sheet on mobile, centred modal on desktop.
 * <Sheet open={o} onClose={() => setO(false)} title="Confirm">...</Sheet>
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className="m-0 mt-auto sm:m-auto w-full max-w-none sm:max-w-lg bg-transparent p-0 backdrop:bg-ink/40 backdrop:backdrop-blur-[2px] open:animate-sheet-up"
    >
      <div className="rounded-t-3xl sm:rounded-3xl bg-white shadow-pop p-5 pb-8 max-h-[88dvh] overflow-y-auto">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        {title && <h2 className="text-xl font-extrabold mb-3">{title}</h2>}
        {children}
      </div>
    </dialog>
  );
}
