import { useId } from "react";
import { cn } from "./cn";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

/** Labelled text input with 48px+ height. Pass `error` to show a message. */
export function Input({ label, hint, error, className, id, ...rest }: Props) {
  const gen = useId();
  const iid = id ?? gen;
  return (
    <div className="block">
      <label htmlFor={iid} className="block text-sm font-semibold text-ink-soft mb-1.5">
        {label}
      </label>
      <input
        id={iid}
        aria-invalid={!!error || undefined}
        aria-describedby={error || hint ? `${iid}-d` : undefined}
        {...rest}
        className={cn(
          "w-full min-h-12 rounded-2xl border bg-white px-4 text-base text-ink placeholder:text-ink-muted/70",
          "transition-colors focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100",
          error ? "border-accent-500" : "border-line hover:border-teal-300",
          className,
        )}
      />
      {(error || hint) && (
        <p id={`${iid}-d`} className={cn("text-sm mt-1.5", error ? "text-bad-fg" : "text-ink-muted")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
