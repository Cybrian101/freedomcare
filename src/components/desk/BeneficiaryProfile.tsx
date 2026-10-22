"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getById } from "@/lib/roster";
import { asRosterStatus, deleteDraft, getLocal, loadDraft, putLocalFromServer, saveDraft, type LocalBeneficiary } from "@/lib/local-db";
import { kindOf, submitHandover } from "@/lib/offline-queue";
import { useSync } from "@/components/SyncProvider";
import { CameraCapture } from "@/components/camera/CameraCapture";
import { DeskPill, SideChip } from "./status";
import { TokenSlip } from "./TokenSlip";

/**
 * Distribution profile. The record comes from the on-device list first (works offline); when online it is
 * refreshed from the server in the background. "Distributed" is shown only when the SERVER row says so:
 * a queued handover is displayed as "saved on this device", never as complete.
 */
export function BeneficiaryProfile({ id }: { id: string }) {
  const [row, setRow] = useState<LocalBeneficiary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [draftPhoto, setDraftPhoto] = useState<Blob | null>(null);
  const { items, retryItem, online } = useSync();

  const mine = useMemo(
    () => items.filter((i) => i.rosterId === id).sort((a, b) => b.createdAt - a.createdAt),
    [items, id],
  );
  const openHandover = mine.find((i) => kindOf(i) === "handover" && i.status !== "synced");
  const openAttend = mine.find((i) => kindOf(i) === "attendance" && i.status !== "synced");
  const lastHandover = mine.find((i) => kindOf(i) === "handover" && i.status === "synced");
  // changes whenever the engine confirms something for this beneficiary => re-read the server row
  const syncedKey = mine.reduce((m, i) => Math.max(m, i.status === "synced" ? i.syncedAt ?? 0 : 0), 0);

  useEffect(() => {
    let dead = false;
    (async () => {
      const local = await getLocal(id).catch(() => undefined);
      if (!dead && local) { setRow(local); setErr(null); }
      if (navigator.onLine) {
        try {
          const fresh = await getById(createClient(), id);
          if (fresh) {
            await putLocalFromServer(fresh);
            const again = await getLocal(id);
            if (!dead && again) setRow(again);
          }
        } catch {
          /* server unreachable: keep showing the on-device copy */
        }
      }
      if (!dead) {
        setLoading(false);
        if (!local) setErr("This beneficiary is not on this device. Connect and download the list, then search again.");
      }
    })();
    return () => { dead = true; };
  }, [id, syncedKey]);

  // A photo that was taken but never submitted (tab closed, phone locked, page refreshed) is restored from the device.
  useEffect(() => {
    let dead = false;
    void loadDraft(`photo:${id}`).then((d) => {
      if (!dead && d?.blobs?.photo) setDraftPhoto(d.blobs.photo);
    });
    return () => { dead = true; };
  }, [id]);

  const keepPhoto = useCallback(
    (b: Blob | null) => {
      if (b) void saveDraft(`photo:${id}`, { rosterId: id }, { photo: b });
      else void deleteDraft(`photo:${id}`);
    },
    [id],
  );

  if (loading) return <p className="p-4 text-slate-500">Loading...</p>;
  if (!row) return <p className="m-4 rounded-lg bg-red-50 p-3 text-red-800">{err ?? "Not found."}</p>;

  const serverStatus = asRosterStatus(row);
  const distributed = serverStatus === "distributed";
  const attended = serverStatus !== "not_arrived" || !!openAttend;

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <Link href="/distribution" className="text-sm font-semibold text-sky-700">
        &larr; Back to search
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reg. No. (token)</p>
            <p className="text-5xl sm:text-6xl break-all font-black leading-none text-slate-900">{row.reg_no ?? "-"}</p>
          </div>
          <DeskPill status={serverStatus} />
        </div>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">{row.name}</h1>
        <p className="text-sm text-slate-500">
          S.No {row.serial_no ?? "-"}
          {row.attended_at ? ` - attended ${new Date(row.attended_at).toLocaleTimeString("en-IN", { timeStyle: "short" })}` : ""}
        </p>

        <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Appliances (handed over together)
        </h2>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {row.appliances.length === 0 && <li className="p-3 text-slate-500">No appliance listed.</li>}
          {row.appliances.map((a, i) => (
            <li key={i} className="flex items-center justify-between gap-2 p-3">
              <span className="text-base text-slate-900">{a.name}</span>
              <SideChip side={a.side} />
            </li>
          ))}
        </ul>
      </div>

      {row.review_note && (
        <div role="alert" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-amber-950">
          <p className="text-sm font-bold">Please verify</p>
          <p className="text-sm">{row.review_note}</p>
        </div>
      )}

      {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{err}</p>}
      {!online && !distributed && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Offline: this shows the last downloaded status. Another device may have recorded this beneficiary since.
        </p>
      )}

      {openAttend && !openHandover && (
        <div className="rounded-xl border-2 border-sky-300 bg-sky-50 p-3 text-sky-950">
          <p className="font-bold">Attendance saved on this device - awaiting sync</p>
          <button onClick={() => retryItem(openAttend.id)} className="mt-2 rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white">
            Retry now
          </button>
        </div>
      )}

      <SyncBanner
        distributedAt={row.distributed_at}
        open={openHandover}
        dup={lastHandover?.resolution === "duplicate"}
        onRetry={() => openHandover && retryItem(openHandover.id)}
      />

      {!attended && !distributed && (
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
          Attendance is not marked yet. Handing over also marks them as attended; you can still mark it on the{" "}
          <Link href="/attendance" className="font-semibold underline">Attendance</Link> page.
        </div>
      )}

      <>
        {!distributed && !openHandover && (
          <button
            onClick={() => setCapturing(true)}
            className="h-16 w-full rounded-2xl bg-emerald-600 text-lg font-bold text-white active:bg-emerald-700"
          >
            {draftPhoto ? "Resume unsent handover photo" : "Photograph handover"}
          </button>
        )}
        <button
          onClick={() => setShowToken((s) => !s)}
          className="h-12 w-full rounded-xl border border-slate-300 bg-white font-semibold text-slate-800 active:bg-slate-50"
        >
          {showToken ? "Hide token" : "Show token"}
        </button>
        {showToken && <TokenSlip row={{ ...row, aadhaar_no: null, attended_by: null, distributed_by: null, photo_path: null, submission_id: null, created_at: "", updated_at: row.server_updated_at }} />}
      </>
      {capturing && (
        <CameraCapture
          key={row.id}
          title={`#${row.reg_no ?? ""} ${row.name}`}
          initialPhoto={draftPhoto}
          onPhotoReady={keepPhoto}
          onCancel={() => setCapturing(false)}
          onSubmit={async (blob) => {
            // The submission id is created at capture time and written to IndexedDB before any network call.
            await submitHandover({ rosterId: row.id, regNo: row.reg_no, name: row.name, blob, submissionId: crypto.randomUUID() });
            await deleteDraft(`photo:${row.id}`); // now safely in the sync queue
            setDraftPhoto(null);
            setCapturing(false);
          }}
        />
      )}
    </div>
  );
}

function SyncBanner({
  distributedAt,
  open,
  dup,
  onRetry,
}: {
  distributedAt: string | null;
  open?: { status: string; lastError: string | null; attempts: number };
  dup: boolean;
  onRetry: () => void;
}) {
  if (open) {
    if (open.status === "rejected")
      return (
        <div role="alert" className="rounded-xl border-2 border-red-400 bg-red-50 p-3 text-red-900">
          <p className="font-bold">Could not save handover</p>
          <p className="text-sm">{open.lastError}</p>
          <Link href="/queue" className="text-sm font-semibold underline">
            Open sync queue
          </Link>
        </div>
      );
    return (
      <div className="rounded-xl border-2 border-sky-300 bg-sky-50 p-3 text-sky-950">
        <p className="font-bold">Saved on this device - awaiting sync</p>
        <p className="text-sm">
          The photo is safe here and uploads automatically
          {open.lastError ? ` (${open.lastError})` : ""}. It is NOT recorded as distributed until the server confirms.
        </p>
        <button onClick={onRetry} className="mt-2 rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white">
          Retry now
        </button>
      </div>
    );
  }
  if (distributedAt)
    return (
      <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50 p-3 text-emerald-950">
        <p className="font-bold">Confirmed by FreedomCare</p>
        <p className="text-sm">
          Distributed {new Date(distributedAt).toLocaleString("en-IN")}
          {dup ? " - already recorded earlier (another device); your photo was not needed." : ""}
        </p>
      </div>
    );
  return null;
}
