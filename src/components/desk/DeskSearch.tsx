"use client";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";
import { searchLocal, type LocalBeneficiary, asRosterStatus } from "@/lib/local-db";
import { useDataset } from "@/components/DatasetPanel";
import { Avatar } from "./Avatar";
import { DeskPill, type DeskStatus } from "./status";

type Filter = "all" | DeskStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "not_arrived", label: "Not arrived" },
  { key: "attended", label: "Attended" },
  { key: "distributed", label: "Distributed" },
];

/**
 * Distribution search. Reads ONLY the list stored on this phone, so it behaves the same online and offline.
 * Results open with a plain link (a full page load answered from the phone's storage): instant and reliable with no signal.
 */
export function DeskSearch() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<LocalBeneficiary[]>([]);
  const [searched, setSearched] = useState(false);
  const { meta, ready, loaded } = useDataset();
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        let res = await searchLocal(q, 40);
        if (filter !== "all") res = res.filter((r) => asRosterStatus(r) === filter);
        if (my === seq.current) { setRows(res); setSearched(!!q.trim()); }
      } catch {
        if (my === seq.current) { setRows([]); setSearched(false); }
      }
    }, 120);
    return () => clearTimeout(t);
  }, [q, filter, meta?.downloadedAt]);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Reg. No. or name"
          aria-label="Search beneficiary by Reg. No. or name"
          className="h-16 w-full rounded-2xl border border-line bg-white px-5 text-2xl font-bold text-ink shadow-card outline-none placeholder:font-medium placeholder:text-ink-muted/70 focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
        />
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
      </div>

      {loaded && !meta && (
        <p role="alert" className="rounded-2xl bg-warn-bg px-4 py-3 text-sm font-semibold text-warn-fg">
          No list on this phone yet. Connect and download the list first (button above).
        </p>
      )}
      {searched && rows.length === 0 && meta && (
        <p role="status" className="rounded-2xl bg-sage-100 px-4 py-4 text-center font-semibold text-ink-soft">
          {ready
            ? "Not in the downloaded list. Check the Reg. No. on the token."
            : "Not found in this phone's list, which is incomplete. This does not mean the person is not on the list. Download the full list when online."}
        </p>
      )}
      {!q.trim() && <p className="py-6 text-center text-ink-muted">Type a Reg. No. (token) or a name to begin.</p>}

      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <li key={r.id}>
            <a href={`/distribution/profile?id=${r.id}`} className="block rounded-card focus-visible:outline-offset-2">
              <Card className="flex items-center gap-3 !p-3 transition-colors hover:border-teal-300 active:bg-sage-50">
                <Avatar id={r.id} name={r.name} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-ink px-2 py-0.5 text-lg font-extrabold text-white">{r.reg_no ?? "-"}</span>
                    <DeskPill status={asRosterStatus(r)} />
                  </div>
                  <p className="mt-1 truncate text-base font-bold text-ink">{r.name}</p>
                  <p className="truncate text-sm text-ink-muted">{r.appliances.map((a) => a.name).join(", ") || "No appliance listed"}</p>
                </div>
              </Card>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
