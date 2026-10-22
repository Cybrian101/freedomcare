import { cn } from "./cn";

/** Pulsing placeholder block. Size it with className (e.g. "h-24 w-full"). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rounded-2xl bg-sage-100 animate-shimmer", className)} />;
}
