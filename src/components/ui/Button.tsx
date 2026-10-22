import Link from "next/link";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-teal-700 text-white hover:bg-teal-800 active:bg-teal-900 shadow-sm",
  secondary: "bg-white text-teal-800 border border-teal-200 hover:bg-teal-50 active:bg-teal-100",
  ghost: "bg-transparent text-ink-soft hover:bg-sage-100 active:bg-sage-200",
  danger: "bg-bad-bg text-bad-fg border border-accent-100 hover:bg-accent-100",
  accent: "bg-accent-600 text-white hover:bg-accent-700 shadow-sm",
};
const sizes: Record<Size, string> = {
  md: "min-h-12 px-5 text-base",
  lg: "min-h-14 px-6 text-lg",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", full = false) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-2xl font-semibold select-none",
    "transition-[background-color,transform,opacity] duration-150 active:scale-[0.98]",
    "disabled:opacity-50 disabled:pointer-events-none",
    variants[variant],
    sizes[size],
    full && "w-full",
  );
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  loading?: boolean;
  /** Render as a Next <Link> instead of a button */
  href?: string;
};

export function Button({ variant, size, full, loading, href, className, children, disabled, ...rest }: ButtonProps) {
  const cls = cn(buttonClasses(variant, size, full), className);
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button {...rest} disabled={disabled || loading} aria-busy={loading || undefined} className={cls}>
      {loading && (
        <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
      )}
      {children}
    </button>
  );
}
