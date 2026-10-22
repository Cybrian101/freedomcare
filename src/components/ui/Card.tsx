import { cn } from "./cn";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...p}
      className={cn("rounded-card bg-white border border-line shadow-card p-4 sm:p-5", className)}
    />
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3 mt-6 first:mt-0">
      <h2 className="text-sm font-bold uppercase tracking-wider text-ink-muted">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="text-ink-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
