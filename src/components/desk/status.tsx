import type { RosterRow } from "@/lib/types";
import { Badge, type Tone } from "@/components/ui";

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
const TONE: Record<DeskStatus, Tone> = { not_arrived: "neutral", attended: "info", distributed: "ok" };

export function DeskPill({ status }: { status: DeskStatus }) {
  return <Badge tone={TONE[status]} dot>{LABEL[status]}</Badge>;
}

export const STATUS_LABEL = LABEL;

export function SideChip({ side }: { side: string | null }) {
  if (!side) return null;
  return <Badge tone="info" className="uppercase">{side}</Badge>;
}
