import { cn } from "./cn";
import type { Tone } from "./Badge";

const bg: Record<Tone, string> = {
  ok: "bg-sage-50 border-sage-200",
  warn: "bg-warn-bg/50 border-warn-bg",
  bad: "bg-accent-50 border-accent-100",
  info: "bg-sky-50 border-sky-100",
  neutral: "bg-white border-line",
};

/** Number tile: <Stat label="Attended" value={120} tone="info" hint="of 461" /> */
export function Stat({ label, value, tone = "neutral", hint, className }: { label: string; value: React.ReactNode; tone?: Tone; hint?: string; className?: string }) {
  return (
    <div className={cn("rounded-2xl border p-4", bg[tone], className)}>
      <div className="text-3xl font-extrabold tabular-nums tracking-tight text-ink">{value}</div>
      <div className="text-sm font-semibold text-ink-soft mt-0.5">{label}</div>
      {hint && <div className="text-xs text-ink-muted mt-0.5">{hint}</div>}
    </div>
  );
}

/** SVG progress ring. value/max. Shows percentage in the centre. */
export function ProgressRing({ value, max, size = 132, stroke = 12, label }: { value: number; max: number; size?: number; stroke?: number; label?: string }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(pct * 100)} percent ${label ?? ""}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-teal-100)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-teal-600)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.2,0.8,0.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-extrabold tabular-nums text-ink">{Math.round(pct * 100)}%</span>
        {label && <span className="text-xs font-semibold text-ink-muted">{label}</span>}
      </div>
    </div>
  );
}
