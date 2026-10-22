import type { RosterRow } from "@/lib/types";

export type DeskStatus = "not_arrived" | "attended" | "distributed";

export function rosterStatus(r: Pick<RosterRow, "attended_at" | "distributed_at">): DeskStatus {
  if (r.distributed_at) return "distributed";
  if (r.attended_at) return "attended";
  return "not_arrived";
}

const LABEL: Record<DeskStatus, string> = {
  not_arrived: "Not arrived",
  attended: "Attended",
  distributed: "Distributed",
};
const TONE: Record<DeskStatus, string> = {
  not_arrived: "bg-slate-100 text-slate-700 border-slate-300",
  attended: "bg-amber-100 text-amber-900 border-amber-300",
  distributed: "bg-emerald-100 text-emerald-900 border-emerald-300",
};

export function DeskPill({ status }: { status: DeskStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[status]}`}>
      {LABEL[status]}
    </span>
  );
}

export const STATUS_LABEL = LABEL;

export function SideChip({ side }: { side: string | null }) {
  if (!side) return null;
  return (
    <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-xs font-bold uppercase text-sky-900">{side}</span>
  );
}
