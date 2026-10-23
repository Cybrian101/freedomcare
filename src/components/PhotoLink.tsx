"use client";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export type PhotoBucket = "handover-photos" | "documents";

/** Short-lived links to private photos, made only when someone taps to see one. */
export function useSignedUrl() {
  const [urls, setUrls] = useState<Record<string, string | "error">>({});
  const show = useCallback(async (bucket: PhotoBucket, path: string) => {
    const key = `${bucket}/${path}`;
    const { data, error } = await createClient().storage.from(bucket).createSignedUrl(path, 120); // 2-minute link
    setUrls((u) => ({ ...u, [key]: error || !data ? "error" : data.signedUrl }));
  }, []);
  return { urls, show };
}

/** "Show <label>" button that turns into the photo. Nothing is downloaded until it is tapped. */
export function Photo({ bucket, path, label, urls, show }: { bucket: PhotoBucket; path: string; label: string; urls: Record<string, string>; show: (b: PhotoBucket, p: string) => void }) {
  const u = urls[`${bucket}/${path}`];
  if (u === "error") return <p className="text-xs text-bad-fg">{label}: not available (not uploaded yet, or no permission).</p>;
  if (u) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={u} alt={label} loading="lazy" className="mt-2 max-h-72 w-full rounded-2xl border border-line object-contain bg-sage-100" />;
  }
  return <Button variant="secondary" onClick={() => show(bucket, path)}>Show {label}</Button>;
}
