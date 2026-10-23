"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Page, SectionTitle, type Tone } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { getById } from "@/lib/roster";
import { withTimeout } from "@/lib/net";
import { asRosterStatus, deleteDraft, getLocal, loadDraft, putLocalFromServer, saveDraft, syncThumbs, type LocalBeneficiary } from "@/lib/local-db";
import { kindOf, pendingHandover, submitHandover } from "@/lib/offline-queue";
import { useSync } from "@/components/SyncProvider";
import { useIsAdmin } from "@/lib/role";
import { CaptureSheet } from "@/components/camera/CaptureSheet";
import { Avatar, usePersonThumb } from "./Avatar";
import { ProfilePhotoAction } from "./ProfilePhotoAction";
import { STATUS_LABEL, SideChip } from "./status";
import { TokenSlip } from "./TokenSlip";

const STATUS_TONE: Record<ReturnType<typeof asRosterStatus>, Tone> = { not_arrived: "neutral", attended: "info", distributed: "ok" };

/**
 * Distribution record. Opens from the list on THIS phone (so it works with no signal) and refreshes from the server in the
 * background when there is a connection. "Distributed" is shown only when the SERVER says so: a queued handover is shown
 * as "saved on this phone", never as complete.
 */
export function BeneficiaryProfile({ id }: { id: string }) {
  const [row, setRow] = useState<LocalBeneficiary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [draftPhoto, setDraftPhoto] = useState<Blob | null>(null);
  const [photoKey, setPhotoKey] = useState(0);
  const [zoom, setZoom] = useState(false);
  const { items, retryItem, online } = useSync();
  const admin = useIsAdmin();
  const thumbUrl = usePersonThumb(id, photoKey);

  const mine = useMemo(() => items.filter((i) => i.rosterId === id).sort((a, b) => b.createdAt - a.createdAt), [items, id]);
  const openHandover = pendingHandover(items, id); // a single or a wheelchair-group handover
  const openAttend = mine.find((i) => kindOf(i) === "attendance" && i.status !== "synced");
  const lastHandover = mine.find((i) => kindOf(i) === "handover" && i.status === "synced");
  // changes whenever the engine confirms something for this person => re-read the server row
  const syncedKey = mine.reduce((m, i) => Math.max(m, i.status === "synced" ? i.syncedAt ?? 0 : 0), 0);

  useEffect(() => {
    let dead = false;
    (async () => {
      const local = await getLocal(id).catch(() => undefined);
      // Show the copy on this phone at once. The server refresh below can take seconds on a connection that is up but
      // has no internet, and nobody should wait for it.
      if (!dead && local) { setRow(local); setErr(null); setLoading(false); }
      if (navigator.onLine) {
        try {
          const fresh = await withTimeout(getById(createClient(), id), 6000);
          if (fresh) {
            await putLocalFromServer(fresh);
            const again = await getLocal(id);
            if (!dead && again) setRow(again);
          }
        } catch {
          /* server unreachable or slow: keep showing the copy on this phone */
        }
      }
      if (!dead) {
        setLoading(false);
        if (!local) setErr("This person is not on this phone. Connect once and download the list, then search again.");
      }
    })();
    return () => { dead = true; };
  }, [id, syncedKey]);

  // The server has a picture for this person but this phone does not have it yet: fetch just that one now (online only).
  const wantsThumb = !!row?.photo_path && !thumbUrl;
  useEffect(() => {
    if (!wantsThumb || !online) return;
    let dead = false;
    void syncThumbs(createClient(), id).then((n) => { if (!dead && n) setPhotoKey((k) => k + 1); });
    return () => { dead = true; };
  }, [wantsThumb, online, id]);

  // A photo that was taken but never submitted (tab closed, phone locked, page refreshed) is restored from the phone.
  useEffect(() => {
    let dead = false;
    void loadDraft(`photo:${id}`).then((d) => { if (!dead && d?.blobs?.photo) setDraftPhoto(d.blobs.photo); });
    return () => { dead = true; };
  }, [id]);

  const keepPhoto = useCallback(
    (b: Blob | null) => {
      if (b) void saveDraft(`photo:${id}`, { rosterId: id }, { photo: b });
      else void deleteDraft(`photo:${id}`);
    },
    [id],
  );

  if (loading) return <Page><p className="p-4 text-ink-muted">Loading...</p></Page>;
  if (!row) {
    return (
      <Page>
        <a href="/distribution" className="text-sm font-bold text-teal-700">&larr; Back to search</a>
        <p role="alert" className="rounded-2xl bg-bad-bg px-4 py-3 font-semibold text-bad-fg">{err ?? "Not found."}</p>
      </Page>
    );
  }

  const status = asRosterStatus(row);
  const distributed = status === "distributed";
  const attended = status !== "not_arrived" || !!openAttend;

  return (
    <Page width="wide">
      <a href="/distribution" className="inline-flex min-h-11 items-center text-sm font-bold text-teal-700">&larr; Back to search</a>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
        {/* who this is */}
        <Card className="space-y-4">
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={() => thumbUrl && setZoom(true)}
              disabled={!thumbUrl}
              aria-label={thumbUrl ? "Enlarge the profile photo" : "No profile photo on this phone"}
              className="shrink-0 rounded-2xl focus-visible:outline-offset-2"
            >
              <Avatar id={row.id} name={row.name} size={112} refreshKey={photoKey + (mine.length ? 1 : 0)} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-ink-muted">Reg. No. (token)</p>
              <p className="break-all text-5xl font-black leading-none text-ink sm:text-6xl">{row.reg_no ?? "-"}</p>
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-extrabold leading-tight text-ink">{row.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[status]} dot>{STATUS_LABEL[status]}</Badge>
              <span className="text-sm text-ink-muted">
                {admin ? `S.No ${row.serial_no ?? "-"}` : ""}
                {row.attended_at ? `${admin ? " · " : ""}attended ${new Date(row.attended_at).toLocaleTimeString("en-IN", { timeStyle: "short" })}` : ""}
              </span>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-muted">Appliances (handed over together)</p>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {row.appliances.length === 0 && <li className="p-3 text-ink-muted">No appliance listed.</li>}
              {row.appliances.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2 p-3">
                  <span className="text-base font-semibold text-ink">{a.name}</span>
                  <SideChip side={a.side} />
                </li>
              ))}
            </ul>
          </div>
        </Card>

        {/* what to do */}
        <div className="space-y-4">
          {admin && row.review_note && (
            <div role="alert" className="rounded-2xl border-2 border-warn-fg/40 bg-warn-bg p-4 text-warn-fg">
              <p className="font-extrabold">Please verify</p>
              <p className="text-sm">{row.review_note}</p>
            </div>
          )}
          {err && <p className="rounded-2xl bg-bad-bg px-4 py-3 text-sm font-semibold text-bad-fg">{err}</p>}
          {!online && !distributed && (
            <p className="rounded-2xl bg-warn-bg px-4 py-3 text-sm font-semibold text-warn-fg">
              No signal: this shows the last status downloaded to this phone. Another phone may have recorded this person since.
            </p>
          )}

          <Card className="space-y-5">
            <SectionTitle>Steps</SectionTitle>

            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-extrabold text-ink">1. Attendance</p>
                <p className="text-sm text-ink-muted">
                  {attended
                    ? openAttend ? "Saved on this phone, waiting to upload" : "Marked"
                    : "Not marked yet. Handing over also marks it."}
                </p>
              </div>
              {attended ? <Badge tone="ok" dot>Done</Badge> : <Button href="/attendance" variant="secondary">Open Attendance</Button>}
            </div>

            <div className="space-y-2 border-t border-line pt-4">
              <div>
                <p className="font-extrabold text-ink">2. Profile photo</p>
                <p className="text-sm text-ink-muted">A picture of the person, so the right person is matched later.</p>
              </div>
              <ProfilePhotoAction person={row} hasPhoto={row.has_photo} onSaved={() => setPhotoKey((k) => k + 1)} />
            </div>

            <div className="space-y-3 border-t border-line pt-4">
              <div>
                <p className="font-extrabold text-ink">3. Handover photo</p>
                <p className="text-sm text-ink-muted">Photograph the person receiving the aid. This completes the distribution.</p>
              </div>
              <SyncBanner
                detail={admin}
                distributedAt={row.distributed_at}
                open={openHandover}
                dup={lastHandover?.resolution === "duplicate"}
                onRetry={() => openHandover && retryItem(openHandover.id)}
              />
              {!distributed && !openHandover && (
                <Button size="lg" full onClick={() => setCapturing(true)}>
                  {draftPhoto ? "Resume unsent handover photo" : "Photograph handover"}
                </Button>
              )}
            </div>
          </Card>

          <Button variant="ghost" full onClick={() => setShowToken((s) => !s)}>{showToken ? "Hide token" : "Show token"}</Button>
          {showToken && (
            <TokenSlip row={{ ...row, aadhaar_no: null, attended_by: null, distributed_by: null, photo_path: null, submission_id: null, created_at: "", updated_at: row.server_updated_at }} />
          )}
        </div>
      </div>

      {zoom && thumbUrl && (
        <div role="dialog" aria-label="Profile photo" onClick={() => setZoom(false)} className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4">
          <div className="max-h-full space-y-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbUrl} alt={`Profile photo of ${row.name}`} className="mx-auto max-h-[75dvh] w-auto rounded-2xl" />
            <p className="text-lg font-extrabold text-white">{row.name} · Reg. No. {row.reg_no ?? "-"}</p>
            <p className="text-sm text-white/70">Tap anywhere to close</p>
          </div>
        </div>
      )}

      {capturing && (
        <CaptureSheet
          key={row.id}
          kind="handover"
          subject={{ name: row.name, regNo: row.reg_no }}
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
    </Page>
  );
}

function SyncBanner({
  detail, distributedAt, open, dup, onRetry,
}: {
  /** admins see the server's own words; staff a plain sentence */
  detail: boolean;
  distributedAt: string | null;
  open?: { status: string; lastError: string | null; attempts: number };
  dup: boolean;
  onRetry: () => void;
}) {
  if (open) {
    if (open.status === "rejected")
      return (
        <div role="alert" className="space-y-1 rounded-2xl bg-bad-bg p-4 text-bad-fg">
          <p className="font-extrabold">Could not save the handover</p>
          <p className="text-sm">{detail ? open.lastError : "The server refused it. Ask an admin to check the Sync page."}</p>
          <a href="/queue" className="text-sm font-bold underline">Open the sync log</a>
        </div>
      );
    return (
      <div className="space-y-2 rounded-2xl bg-info-bg p-4 text-info-fg">
        <p className="font-extrabold">Saved on this phone - waiting to upload</p>
        <p className="text-sm">
          The photo is safe here and uploads by itself{detail && open.lastError ? ` (${open.lastError})` : ""}.
        </p>
        <Button variant="secondary" onClick={onRetry}>Retry now</Button>
      </div>
    );
  }
  if (distributedAt)
    return (
      <div className="rounded-2xl bg-ok-bg p-4 text-ok-fg">
        <p className="font-extrabold">Confirmed by FreedomCare</p>
        <p className="text-sm">
          Distributed {new Date(distributedAt).toLocaleString("en-IN")}
          {dup ? " - already recorded earlier (another device); your photo was not needed." : ""}
        </p>
      </div>
    );
  return null;
}
