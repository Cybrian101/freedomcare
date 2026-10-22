"use client";
import { useState } from "react";
import { Button, useToast } from "@/components/ui";
import { CaptureSheet } from "@/components/camera/CaptureSheet";
import { useSync } from "@/components/SyncProvider";
import { kindOf, submitProfilePhoto } from "@/lib/offline-queue";

/**
 * "Take profile photo" for a person on the camp list. The photo is tied to that person's id at the moment it is taken and
 * saved on the phone first; it uploads when there is signal. Shows whether a photo is waiting to upload.
 */
export function ProfilePhotoAction({
  person,
  hasPhoto,
  variant = "secondary",
  size,
  full,
  onSaved,
}: {
  person: { id: string; name: string; reg_no: string | null };
  hasPhoto: boolean;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  full?: boolean;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const { items, online } = useSync();
  const [open, setOpen] = useState(false);
  const waiting = items.some((i) => i.rosterId === person.id && kindOf(i) === "profile" && i.status !== "synced");

  return (
    <>
      <Button variant={variant} size={size} full={full} onClick={() => setOpen(true)}>
        {hasPhoto || waiting ? "Retake profile photo" : "Take profile photo"}
      </Button>
      {waiting && (
        <p className="text-sm font-semibold text-info-fg" role="status">
          Profile photo saved on this phone{online ? " - uploading..." : " - will upload when online"}
        </p>
      )}
      {open && (
        <CaptureSheet
          kind="profile"
          subject={{ name: person.name, regNo: person.reg_no }}
          onCancel={() => setOpen(false)}
          onSubmit={async (blob) => {
            await submitProfilePhoto({ rosterId: person.id, regNo: person.reg_no, name: person.name, blob });
            toast(`Profile photo saved for ${person.name}`, "ok");
            setOpen(false);
            onSaved?.();
          }}
        />
      )}
    </>
  );
}
