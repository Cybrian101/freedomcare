"use client";
import { useEffect, useState } from "react";
import { getThumb } from "@/lib/local-db";
import { cn } from "@/components/ui/cn";

const initials = (name: string) =>
  name.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** A person's picture from this phone's own storage (works offline). Shows initials until a profile photo exists. */
export function usePersonThumb(personId: string, refreshKey?: unknown): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    let made: string | null = null;
    void getThumb(personId).then((b) => {
      if (dead) return;
      made = b ? URL.createObjectURL(b) : null;
      setUrl(made);
    });
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [personId, refreshKey]);
  return url;
}

export function Avatar({
  id, name, size = 56, refreshKey, className,
}: { id: string; name: string; size?: number; refreshKey?: unknown; className?: string }) {
  const url = usePersonThumb(id, refreshKey);
  const style = { width: size, height: size };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={`${name}`} style={style} className={cn("shrink-0 rounded-2xl object-cover ring-2 ring-white shadow-card", className)} />;
  }
  return (
    <div
      aria-hidden
      style={{ ...style, fontSize: size * 0.36 }}
      className={cn("grid shrink-0 place-items-center rounded-2xl bg-teal-100 font-extrabold text-teal-800", className)}
    >
      {initials(name)}
    </div>
  );
}
