import { cn } from "./cn";

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";
const tones: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-fg",
  warn: "bg-warn-bg text-warn-fg",
  bad: "bg-bad-bg text-bad-fg",
  info: "bg-info-bg text-info-fg",
  neutral: "bg-sage-100 text-ink-soft",
};
const dots: Record<Tone, string> = {
  ok: "bg-ok-fg",
  warn: "bg-warn-fg",
  bad: "bg-bad-fg",
  info: "bg-info-fg",
  neutral: "bg-ink-muted",
};

/** Small coloured pill. Always includes text so status never relies on colour alone. */
export function Badge({ tone = "neutral", dot, children, className }: { tone?: Tone; dot?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold", tones[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full", dots[tone])} aria-hidden />}
      {children}
    </span>
  );
}

const statusMap: Record<string, { tone: Tone; label: string }> = {
  pending: { tone: "warn", label: "Pending" },
  attended: { tone: "info", label: "Attended" },
  distributed: { tone: "ok", label: "Distributed" },
  not_attended: { tone: "bad", label: "Not attended" },
  synced: { tone: "ok", label: "Synced" },
  offline: { tone: "bad", label: "Offline" },
};

/** Status pill for beneficiary state: pending | attended | distributed | not_attended (any other string renders neutral). */
export function StatusPill({ status }: { status: string }) {
  const s = statusMap[status] ?? { tone: "neutral" as Tone, label: status };
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}
