import { cn } from "./cn";

/**
 * Page container. The app shell provides the side padding; a page only chooses how wide its content may grow:
 * "narrow" for single-column forms (centred, comfortable on a phone and on a large monitor),
 * "wide" for screens that use two columns on desktop.
 */
export function Page({ width = "narrow", className, children }: { width?: "narrow" | "wide"; className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full space-y-4", width === "narrow" ? "max-w-xl" : "max-w-5xl", className)}>{children}</div>;
}
