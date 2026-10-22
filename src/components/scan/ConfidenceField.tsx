"use client";

import { Badge, cn } from "@/components/ui";
import type { OcrField } from "@/lib/ocr/types";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** OCR metadata for this field (absent when typed manually) */
  meta?: OcrField;
  needsReview?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
  error?: string;
  required?: boolean;
}

function badge(meta: OcrField | undefined, value: string, review: boolean) {
  if (!meta) return null;
  if (meta.value === null && !value) return <Badge tone="neutral">Not read</Badge>;
  if (review) return <Badge tone="warn" dot>Check this</Badge>;
  if (meta.confidence >= 0.9) return <Badge tone="ok" dot>Clear</Badge>;
  return <Badge tone="info" dot>{Math.round(meta.confidence * 100)}%</Badge>;
}

/** Editable field with OCR confidence badge; highlights fields that need review. */
export function ConfidenceField({ label, value, onChange, meta, needsReview, inputMode, multiline, maxLength, placeholder, error, required }: Props) {
  const review = !!needsReview;
  const cls = cn(
    "w-full rounded-2xl border bg-white px-4 text-base text-ink focus:outline-none focus:ring-4 focus:ring-teal-100 focus:border-teal-500",
    review ? "border-warn-fg bg-warn-bg/40" : "border-line",
    error && "border-accent-500",
    multiline ? "py-3 min-h-24" : "min-h-12",
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <label className="text-sm font-semibold text-ink-soft">
          {label}{required && <span className="text-bad-fg"> *</span>}
        </label>
        {badge(meta, value, review)}
      </div>
      {multiline ? (
        <textarea className={cls} value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} placeholder={placeholder} aria-label={label} />
      ) : (
        <input className={cls} value={value} onChange={(e) => onChange(e.target.value)} inputMode={inputMode} maxLength={maxLength} placeholder={placeholder} aria-label={label} />
      )}
      {error && <p className="text-sm mt-1 text-bad-fg">{error}</p>}
    </div>
  );
}
