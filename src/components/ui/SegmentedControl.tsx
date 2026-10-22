"use client";
import { cn } from "./cn";

/** Controlled tab-like switch. <SegmentedControl value={v} onChange={setV} options={[{value:"a",label:"A"}]} /> */
export function SegmentedControl<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex p-1 rounded-2xl bg-sage-100 gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 min-h-11 rounded-xl px-3 text-sm font-bold transition-all",
            o.value === value ? "bg-white text-teal-800 shadow-sm" : "text-ink-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
