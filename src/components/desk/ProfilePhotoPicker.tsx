"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { CaptureSheet } from "@/components/camera/CaptureSheet";

/**
 * Optional profile photo while REGISTERING someone (no camp record exists yet, so the photo travels with the registration
 * and is attached to that exact new person when it uploads). The person's name is shown on the camera screen.
 */
export function ProfilePhotoPicker({ name, photo, onChange }: { name: string; photo: Blob | null; onChange: (b: Blob | null) => void }) {
  const [open, setOpen] = useState(false);
  const url = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => {
    const u = url;
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [url]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Profile photo preview" className="h-28 w-[5.25rem] shrink-0 rounded-2xl object-cover ring-2 ring-white shadow-card" />
        ) : (
          <div aria-hidden className="grid h-28 w-[5.25rem] shrink-0 place-items-center rounded-2xl border-2 border-dashed border-line text-xs font-semibold text-ink-muted">No photo</div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <Button variant={photo ? "secondary" : "primary"} full onClick={() => setOpen(true)} disabled={!name.trim()}>
            {photo ? "Retake profile photo" : "Take profile photo"}
          </Button>
          {!name.trim() && <p className="text-xs text-ink-muted">Type the name first so the photo is tied to the right person.</p>}
          {photo && <Button variant="ghost" full onClick={() => onChange(null)}>Remove photo</Button>}
        </div>
      </div>
      {open && (
        <CaptureSheet
          kind="profile"
          subject={{ name: name.trim() || "New member" }}
          initialPhoto={photo}
          onCancel={() => setOpen(false)}
          onSubmit={(blob) => { onChange(blob); setOpen(false); }}
        />
      )}
    </div>
  );
}
