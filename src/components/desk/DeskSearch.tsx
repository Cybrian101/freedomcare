"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, SegmentedControl, useToast } from "@/components/ui";
import { searchLocal, type LocalBeneficiary, asRosterStatus, saveDraft, loadDraft, deleteDraft } from "@/lib/local-db";
import { pendingHandover, submitGroupHandover, submitHandover } from "@/lib/offline-queue";
import { isWheelchair } from "@/lib/roster";
import { buzz } from "@/lib/haptic";
import { useDataset } from "@/components/DatasetPanel";
import { useSync } from "@/components/SyncProvider";
import { CaptureSheet } from "@/components/camera/CaptureSheet";
import { Avatar } from "./Avatar";
import { DeskPill, type DeskStatus } from "./status";

type Filter = "all" | DeskStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "not_arrived", label: "Not arrived" },
  { key: "attended", label: "Attended" },
  { key: "distributed", label: "Distributed" },
];
type Mode = "one" | "group";
type Member = Pick<LocalBeneficiary, "id" | "reg_no" | "name">;
const GROUP_DRAFT = "group-handover";

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  );
}

/**
 * Distribution. Reads ONLY the list stored on this phone, so it behaves the same online and offline.
 *  - One person: search the token, tap the camera on the row, take the photo, Save. The search is cleared for the next
 *    person; the profile page is not needed (the row text still opens it).
 *  - Wheelchair group: add wheelchair people one by one, take ONE photo, and it is saved for all of them.
 */
export function DeskSearch() {
  const [mode, setMode] = useState<Mode>("one");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<LocalBeneficiary[]>([]);
  const [searched, setSearched] = useState(false);
  const [target, setTarget] = useState<LocalBeneficiary | null>(null);
  const [group, setGroup] = useState<Member[]>([]);
  const [groupShot, setGroupShot] = useState(false);
  const { meta, ready, loaded } = useDataset();
  const { items } = useSync();
  const toast = useToast();
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        let res = await searchLocal(q, 40);
        if (mode === "one" && filter !== "all") res = res.filter((r) => asRosterStatus(r) === filter);
        if (my === seq.current) { setRows(res); setSearched(!!q.trim()); }
      } catch {
        if (my === seq.current) { setRows([]); setSearched(false); }
      }
    }, 120);
    return () => clearTimeout(t);
  }, [q, filter, mode, meta?.downloadedAt]);

  // The group being collected survives a refresh or a locked phone.
  useEffect(() => {
    let dead = false;
    void loadDraft(GROUP_DRAFT).then((d) => {
      const m = d?.data?.members as Member[] | undefined;
      if (!dead && m?.length) { setGroup(m); setMode("group"); }
    });
    return () => { dead = true; };
  }, []);
  function keepGroup(next: Member[]) {
    setGroup(next);
    if (next.length) void saveDraft(GROUP_DRAFT, { members: next }).catch(() => undefined);
    else void deleteDraft(GROUP_DRAFT);
  }

  const nextPerson = () => { setQ(""); input.current?.focus(); };
  // the photo is kept on the phone until saved, so a locked phone or refresh loses nothing (the profile page offers it again)
  const keepPhoto = useCallback((b: Blob | null) => {
    if (b && target) void saveDraft(`photo:${target.id}`, { rosterId: target.id }, { photo: b }).catch(() => undefined);
  }, [target]);

  async function saveOne(r: LocalBeneficiary, blob: Blob) {
    await submitHandover({ rosterId: r.id, regNo: r.reg_no, name: r.name, blob });
    await deleteDraft(`photo:${r.id}`);
    buzz();
    toast(`Saved: ${r.reg_no ?? ""} ${r.name}`.trim(), "ok");
    setTarget(null);
    nextPerson();
  }

  async function saveGroup(blob: Blob) {
    const n = group.length;
    await submitGroupHandover({ members: group.map((m) => ({ rosterId: m.id, regNo: m.reg_no, name: m.name })), blob });
    buzz();
    toast(`Saved for all ${n} people`, "ok");
    setGroupShot(false);
    keepGroup([]);
    nextPerson();
  }

  const inGroup = new Set(group.map((m) => m.id));
  const open = (r: LocalBeneficiary) => asRosterStatus(r) !== "distributed" && !pendingHandover(items, r.id);
  const shown = mode === "one" ? rows : rows.filter((r) => isWheelchair(r.appliances) && open(r) && !inGroup.has(r.id));
  const hidden = mode === "group" && q.trim() ? rows.filter((r) => !inGroup.has(r.id)).length - shown.length : 0;

  return (
    <div className="space-y-4">
      <SegmentedControl<Mode>
        label="Hand over to"
        value={mode}
        onChange={(m) => { setMode(m); input.current?.focus(); }}
        options={[{ value: "one", label: "One person" }, { value: "group", label: `Wheelchair group${group.length ? ` (${group.length})` : ""}` }]}
      />

      {mode === "group" && (
        <Card className="space-y-3 !p-4" aria-live="polite">
          <p className="text-lg font-extrabold text-ink">
            {group.length ? `Group: ${group.length} ${group.length === 1 ? "person" : "people"}` : "Add the wheelchair people in this group"}
          </p>
          {group.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {group.map((m) => (
                <li key={m.id} className="flex items-center gap-1 rounded-full bg-sage-100 py-1 pl-3 pr-1 text-sm font-bold text-ink">
                  <span className="max-w-[11rem] truncate">{m.reg_no ?? "-"} {m.name}</span>
                  <button
                    onClick={() => keepGroup(group.filter((x) => x.id !== m.id))}
                    aria-label={`Remove ${m.name} from the group`}
                    className="grid size-9 place-items-center rounded-full text-lg text-ink-muted hover:bg-white active:bg-white"
                  >&times;</button>
                </li>
              ))}
            </ul>
          )}
          <Button size="lg" full disabled={group.length < 2} onClick={() => setGroupShot(true)}>
            <CameraIcon /> {group.length < 2 ? "Add at least 2 people" : `Take group photo (${group.length})`}
          </Button>
          {group.length > 0 && <Button variant="ghost" full onClick={() => keepGroup([])}>Clear group</Button>}
        </Card>
      )}

      <div className="space-y-3">
        <input
          ref={input}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder={mode === "group" ? "Reg. No. to add" : "Reg. No. or name"}
          aria-label={mode === "group" ? "Search a wheelchair person to add by Reg. No. or name" : "Search beneficiary by Reg. No. or name"}
          className="h-16 w-full rounded-2xl border border-line bg-white px-5 text-2xl font-bold text-ink shadow-card outline-none placeholder:font-medium placeholder:text-ink-muted/70 focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
        />
        {mode === "one" && (
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-bold transition-colors ${
                  filter === f.key ? "border-teal-700 bg-teal-700 text-white" : "border-line bg-white text-ink-soft hover:bg-sage-100"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {loaded && !meta && (
        <p role="alert" className="rounded-2xl bg-warn-bg px-4 py-3 text-sm font-semibold text-warn-fg">
          No list on this phone yet. Connect and download the list first.
        </p>
      )}
      {searched && rows.length === 0 && meta && (
        <p role="status" className="rounded-2xl bg-sage-100 px-4 py-4 text-center font-semibold text-ink-soft">
          {ready
            ? "Not in the list. Check the Reg. No. on the token."
            : "Not found in this phone's list, which is incomplete. This does not mean the person is not on the list. Download the full list when online."}
        </p>
      )}
      {hidden > 0 && shown.length === 0 && (
        <p role="status" className="rounded-2xl bg-warn-bg px-4 py-3 text-center text-sm font-semibold text-warn-fg">
          Not for this group: only wheelchair people who have not received their aid yet can be added. Use &quot;One person&quot; for others.
        </p>
      )}
      {!q.trim() && mode === "one" && <p className="py-6 text-center text-ink-muted">Type the Reg. No. (token) or a name.</p>}

      <ul className="grid gap-3 md:grid-cols-2">
        {shown.map((r) => {
          const status = asRosterStatus(r);
          const waiting = !!pendingHandover(items, r.id);
          return (
            <li key={r.id}>
              <Card className="flex items-center gap-3 !p-3">
                <a href={`/distribution/profile?id=${r.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-offset-2">
                  <Avatar id={r.id} name={r.name} size={56} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-ink px-2 py-0.5 text-lg font-extrabold text-white">{r.reg_no ?? "-"}</span>
                      {waiting ? <Badge tone="info" dot>Saved, sending</Badge> : <DeskPill status={status} />}
                    </div>
                    <p className="mt-1 truncate text-base font-bold text-ink">{r.name}</p>
                    <p className="truncate text-sm text-ink-muted">{r.appliances.map((a) => a.name).join(", ") || "No appliance listed"}</p>
                  </div>
                </a>
                {mode === "group" ? (
                  <button
                    onClick={() => { keepGroup([...group, { id: r.id, reg_no: r.reg_no, name: r.name }]); buzz(); nextPerson(); }}
                    aria-label={`Add ${r.name}, Reg. No. ${r.reg_no ?? "none"}, to the group`}
                    className="min-h-16 shrink-0 rounded-2xl bg-teal-700 px-5 text-lg font-extrabold text-white active:bg-teal-900"
                  >Add</button>
                ) : status !== "distributed" && !waiting ? (
                  <button
                    onClick={() => setTarget(r)}
                    aria-label={`Take handover photo for ${r.name}, Reg. No. ${r.reg_no ?? "none"}`}
                    className="grid size-16 shrink-0 place-items-center rounded-2xl bg-teal-700 text-white active:bg-teal-900"
                  >
                    <CameraIcon />
                    <span className="-mt-1 text-xs font-bold">Photo</span>
                  </button>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>

      {target && (
        <CaptureSheet
          kind="handover"
          subject={{ name: target.name, regNo: target.reg_no }}
          saveLabel="Save"
          onPhotoReady={keepPhoto}
          onCancel={() => setTarget(null)}
          onSubmit={(b) => saveOne(target, b)}
        />
      )}
      {groupShot && (
        <CaptureSheet
          kind="handover"
          heading="Group handover photo"
          subject={{ name: `Group of ${group.length}`, detail: `Reg. No. ${group.map((m) => m.reg_no ?? "-").join(", ")}` }}
          saveLabel={`Save for all ${group.length}`}
          onCancel={() => setGroupShot(false)}
          onSubmit={saveGroup}
        />
      )}
    </div>
  );
}
