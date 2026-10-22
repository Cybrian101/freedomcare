import { cn } from "./cn";

/** Step indicator: <Stepper steps={["Scan","Details","Confirm"]} current={1} /> (0-based) */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 mb-5" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className="flex-1 min-w-0" aria-current={i === current ? "step" : undefined}>
          <div className={cn("h-1.5 rounded-full transition-colors", i <= current ? "bg-teal-600" : "bg-teal-100")} />
          <div className={cn("text-xs mt-1.5 truncate font-semibold", i === current ? "text-teal-800" : "text-ink-muted")}>
            {i + 1}. {s}
          </div>
        </li>
      ))}
    </ol>
  );
}
