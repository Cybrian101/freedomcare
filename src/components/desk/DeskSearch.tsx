"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { searchLocal, type LocalBeneficiary, asRosterStatus } from "@/lib/local-db";
import { useDataset } from "@/components/DatasetPanel";
import { DeskPill, type DeskStatus } from "./status";

type Filter = "all" | DeskStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "not_arrived", label: "Not arrived" },
  { key: "attended", label: "Attended" },
  { key: "distributed", label: "Distributed" },
];

/** Distribution search. Reads ONLY the on-device list, so it behaves the same online and offline. */
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
    <div className="space-y-3">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        inputMode="search"
        enterKeyHint="search"
        placeholder="Reg. No. or name"
        aria-label="Search beneficiary by Reg. No. or name"
        className="h-14 w-full rounded-xl border-2 border-slate-300 bg-white px-4 text-xl text-slate-900 outline-none focus:border-sky-600"
      />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${
              filter === f.key ? "border-sky-700 bg-sky-700 text-white" : "border-slate-300 bg-white text-slate-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loaded && !meta && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          No list on this device. Connect and download the list first (button above).
        </p>
      )}
      {searched && rows.length === 0 && meta && (
        <p role="status" className="rounded-lg bg-slate-50 p-3 text-center text-slate-700">
          {ready
            ? "Not in the downloaded list. Check the Reg. No. on the token."
            : "Not found in this device's list, which is incomplete. This does not mean the person is not on the list. Download the full list when online."}
        </p>
      )}
      {!q.trim() && <p className="py-6 text-center text-slate-500">Type a Reg. No. (token) or a name to begin.</p>}

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              href={`/distribution/profile?id=${r.id}`}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm active:bg-slate-50"
            >
              <div className="flex h-14 min-w-14 items-center justify-center rounded-lg bg-slate-900 px-2 text-xl font-bold text-white">
                {r.reg_no ?? "-"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-slate-900">{r.name}</p>
                <p className="truncate text-sm text-slate-500">
                  {r.appliances.map((a) => a.name).join(", ") || "No appliance listed"}
                </p>
              </div>
              <DeskPill status={asRosterStatus(r)} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
