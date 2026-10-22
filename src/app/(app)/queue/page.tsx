"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSync } from "@/components/SyncProvider";
import { OfflineReadiness } from "@/components/OfflineReadiness";
import { kindOf, type QueueItem, type QueueKind } from "@/lib/queue-core";
import { signOut } from "@/app/(auth)/login/actions";
import { SignOutForm } from "@/components/SignOutForm";

/** What each kind of saved action is, in plain words. */
const KIND: Record<QueueKind, { badge: string; tone: string; line: (i: QueueItem) => string; plural: string }> = {
  handover: { badge: "Handover photo", tone: "bg-emerald-100 text-emerald-900", line: () => "Photo of the handover captured", plural: "handover photo" },
  attendance: { badge: "Attendance", tone: "bg-sky-100 text-sky-900", line: () => "Attendance marked", plural: "attendance" },
  registration: {
    badge: "New member", tone: "bg-teal-100 text-teal-900", plural: "new member",
    line: (i) => (i.docs?.aadhaar || i.docs?.udid ? "New member registered, with the scanned card" : "New member registered"),
  },
  link: { badge: "Details added", tone: "bg-amber-100 text-amber-900", line: () => "Aadhaar and date of birth added to the existing record", plural: "details added" },
  profile: { badge: "Profile photo", tone: "bg-violet-100 text-violet-900", line: () => "Profile photo taken for this person", plural: "profile photo" },
};

/** One confirmed action for THIS login, from the server (works across phones). */
interface DoneRow {
  id: number;
  at: string;
  action: string;
  reg_no: string | null;
  subject_name: string | null;
}
const DONE_KIND: Record<string, { badge: string; tone: string; line: string }> = {
  attendance_marked: { badge: "Attendance", tone: KIND.attendance.tone, line: "Attendance marked" },
  distribution_completed: { badge: "Handover photo", tone: KIND.handover.tone, line: "Handover photo saved" },
  registered: { badge: "New member", tone: KIND.registration.tone, line: "New member registered" },
  details_added: { badge: "Details added", tone: KIND.link.tone, line: "Aadhaar and date of birth added" },
  profile_photo_added: { badge: "Profile photo", tone: KIND.profile.tone, line: "Profile photo saved" },
  reg_no_assigned: { badge: "Reg. No.", tone: "bg-slate-100 text-slate-800", line: "Reg. No. assigned" },
};
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Why an unsent item is still here, in words staff can act on. */
function reason(i: QueueItem, online: boolean): string {
  if (i.status === "rejected") return "Needs attention - the server refused it";
  if (i.status === "syncing") return "Uploading...";
  if (!online || i.lastError?.startsWith("Offline")) return "Waiting for internet - saved safely on this phone";
  if (i.status === "failed") return "Upload failed - will retry automatically";
  return "Saved on this phone - uploading shortly";
}

const TONE: Record<QueueItem["status"], string> = {
  queued: "bg-sky-100 text-sky-900",
  syncing: "bg-sky-100 text-sky-900",
  failed: "bg-amber-100 text-amber-900",
  rejected: "bg-red-100 text-red-900",
  synced: "bg-emerald-100 text-emerald-900",
};

/** Photo preview: the handover photo, or the scanned Aadhaar for a new member. Gone once the server has it. */
function Thumb({ item }: { item: QueueItem }) {
  const blob = item.blob ?? item.docs?.aadhaar ?? item.docs?.udid ?? null;
  const u = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => {
    const x = u;
    return () => { if (x) URL.revokeObjectURL(x); };
  }, [u]);
  if (!u) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={u} alt={kindOf(item) === "handover" ? "Handover photo" : "Scanned card"} className="h-16 w-16 shrink-0 rounded-lg object-cover" />;
}

const who = (i: QueueItem) => i.ownerName ?? i.ownerEmail ?? "unknown";
const clock = (t: number) => new Date(t).toLocaleTimeString("en-IN", { timeStyle: "short" });

function Person({ i }: { i: QueueItem }) {
  const label = `${i.name ?? "Beneficiary"}${i.regNo ? ` · Reg. No. ${i.regNo}` : ""}`;
  return kindOf(i) === "registration"
    ? <p className="truncate font-semibold text-slate-900">{label}</p>
    : <Link href={`/distribution/profile?id=${i.rosterId}`} className="block truncate font-semibold text-slate-900">{label}</Link>;
}

export default function QueuePage() {
  const { items, pending, online, storage, retryNow, retryItem, removeItem, adoptItem, me, meName } = useSync();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<DoneRow[] | null>(null);

  // The log belongs to the signed-in staff member. Work saved on this phone under another login is kept apart.
  const isMine = (i: QueueItem) => !i.ownerId || !me || i.ownerId === me || i.adopted === true;
  const mine = items.filter(isMine);
  const held = items.filter((i) => !isMine(i) && i.status !== "synced");
  const unsynced = mine.filter((i) => i.status !== "synced");
  const oldest = unsynced.reduce<number | null>((m, i) => (m === null || i.createdAt < m ? i.createdAt : m), null);
  const lastOk = mine.reduce((m, i) => Math.max(m, i.syncedAt ?? 0), 0);
  const localDone = mine.filter((i) => i.status === "synced").sort((a, b) => (b.syncedAt ?? 0) - (a.syncedAt ?? 0)).slice(0, 30);
  const syncedCount = mine.filter((i) => i.status === "synced").length;

  // What the server has accepted from THIS login (also from other phones). Refreshed whenever something new is confirmed.
  useEffect(() => {
    if (!online || !me) return;
    let dead = false;
    createClient().rpc("my_activity", { p_limit: 50 }).then(
      ({ data, error }) => { if (!dead) setDone(error ? null : ((data ?? []) as DoneRow[])); },
      () => undefined,
    );
    return () => { dead = true; };
  }, [online, me, syncedCount]);

  const waiting = (["handover", "profile", "attendance", "registration", "link"] as QueueKind[])
    .map((k) => ({ k, n: unsynced.filter((i) => kindOf(i) === k).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${KIND[x.k].plural}`)
    .join(", ");

  return (
    <div className="mx-auto w-full max-w-xl space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">
          Sync log{meName ? ` - ${meName}` : ""}{" "}
          <span className="ml-1 rounded-full bg-slate-900 px-2 py-0.5 text-sm text-white">{pending}</span>
        </h1>
        <button
          onClick={() => void retryNow()}
          disabled={pending === 0}
          className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Retry now
        </button>
      </div>

      <p className="text-sm text-slate-600">
        {online ? "Online." : "No internet - everything is safe on this phone and uploads when signal returns."}
        {waiting ? ` Still waiting: ${waiting}.` : " Nothing waiting."}
      </p>
      <OfflineReadiness compact />
      {storage?.persisted === false && (
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          Browser may clear stored photos if space runs low. Keep this device online soon, or install the app to the home screen.
        </p>
      )}
      {storage?.low && (
        <p className="rounded-lg bg-red-50 p-2 text-sm text-red-900">Device storage is low - free some space before capturing more photos.</p>
      )}
      {note && <p className="rounded-lg bg-slate-100 p-2 text-sm">{note}</p>}
      <p className="text-xs text-slate-500">
        Last confirmed by server: {lastOk ? new Date(lastOk).toLocaleTimeString("en-IN") : "nothing yet on this device"}
        {oldest ? ` - oldest waiting item saved ${new Date(oldest).toLocaleTimeString("en-IN")}` : ""}
      </p>

      {unsynced.length === 0 && <p className="py-4 text-center text-slate-500">Nothing waiting. Everything you saved has been confirmed by the server.</p>}
      {unsynced.length > 0 && <h2 className="pt-1 text-sm font-semibold uppercase tracking-wide text-amber-800">Still waiting ({unsynced.length})</h2>}

      <ul className="space-y-2">
        {unsynced.map((i) => {
          const k = KIND[kindOf(i)];
          return (
            <li key={i.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex gap-3">
                <Thumb item={i} />
                <div className="min-w-0 flex-1 space-y-1">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${k.tone}`}>{k.badge}</span>
                  <p className="font-bold text-slate-900">{k.line(i)}</p>
                  <Person i={i} />
                  <p className="text-xs text-slate-500">by {who(i)} · captured {clock(i.createdAt)} · {i.attempts} attempt{i.attempts === 1 ? "" : "s"}</p>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[i.status]}`}>{reason(i, online)}</span>
                  {i.lastError && <p className="break-words text-xs text-red-700">{i.lastError}</p>}
                  {i.ownerId && me && i.ownerId !== me && !i.adopted && (
                    <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-950">
                      Held: captured under a different login. Sign in as {i.ownerEmail ?? "that user"} to send it under their name, or send it under yours.
                      <button onClick={() => void adoptItem(i.id)} className="ml-1 font-bold underline">Send under my login</button>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => void retryItem(i.id)}
                  disabled={i.status === "syncing"}
                  className="h-12 flex-1 rounded-lg bg-sky-700 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Retry
                </button>
                {confirmId === i.id ? (
                  <button
                    onClick={async () => {
                      const ok = await removeItem(i.id);
                      setConfirmId(null);
                      setNote(ok ? "Deleted from this device." : "Could not delete (upload in progress).");
                    }}
                    className="h-12 flex-1 rounded-lg bg-red-700 text-sm font-bold text-white"
                  >
                    Confirm delete
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmId(i.id)}
                    disabled={i.status === "syncing"}
                    className="h-12 flex-1 rounded-lg border border-red-300 text-sm font-semibold text-red-800 disabled:opacity-40"
                  >
                    Delete
                  </button>
                )}
              </div>
              {confirmId === i.id && (
                <p className="mt-1 text-xs text-red-800">
                  This has NOT reached FreedomCare. Deleting it permanently loses it and it must be captured again.{" "}
                  <button className="underline" onClick={() => setConfirmId(null)}>Keep</button>
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {held.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
          <p className="text-sm font-bold">{held.length} item{held.length === 1 ? "" : "s"} on this phone {held.length === 1 ? "belongs" : "belong"} to another login</p>
          <ul className="space-y-1.5 text-sm">
            {held.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{KIND[kindOf(i)].badge}: {i.name ?? "Beneficiary"} (by {who(i)})</span>
                <button onClick={() => void adoptItem(i.id)} className="shrink-0 font-bold underline">Send under my login</button>
              </li>
            ))}
          </ul>
          <p className="text-xs">Sign in as that staff member to send them under their name, or send them under yours.</p>
        </div>
      )}

      <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-emerald-800">
        Done - confirmed by the server{done ? ` (${done.length})` : ""}
      </h2>
      {done !== null ? (
        done.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing confirmed from your login yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {done.map((d) => {
              const k = DONE_KIND[d.action] ?? { badge: d.action.replace(/_/g, " "), tone: "bg-slate-100 text-slate-800", line: d.action.replace(/_/g, " ") };
              return (
                <li key={d.id} className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${k.tone}`}>{k.badge}</span>
                    <span className="text-xs">{when(d.at)}</span>
                  </div>
                  <p className="mt-1 font-semibold">{d.subject_name ?? "Beneficiary"}{d.reg_no ? ` · Reg. No. ${d.reg_no}` : ""}</p>
                  <p className="text-xs">{k.line}</p>
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <>
          <p className="text-xs text-slate-500">
            {online ? "Showing what this phone has confirmed." : "No internet: showing what this phone has confirmed. Connect to see everything from your login."}
          </p>
          <ul className="space-y-1.5">
            {localDone.map((i) => {
              const k = KIND[kindOf(i)];
              return (
                <li key={i.id} className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${k.tone}`}>{k.badge}</span>
                    <span className="text-xs">{i.syncedAt ? clock(i.syncedAt) : ""}</span>
                  </div>
                  <p className="mt-1 font-semibold">{i.name ?? "Beneficiary"}{i.regNo ? ` · Reg. No. ${i.regNo}` : ""}</p>
                  <p className="text-xs">{k.line(i)}{i.resolution === "duplicate" ? " · already recorded earlier by another device" : ""}</p>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="border-t border-slate-200 pt-3">
        <SignOutForm action={signOut} />
      </div>
    </div>
  );
}
