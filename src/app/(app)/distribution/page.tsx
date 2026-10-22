import { DeskSearch } from "@/components/desk/DeskSearch";
import { DatasetPanel } from "@/components/DatasetPanel";
import { PageHeader } from "@/components/ui";

export default function DistributionPage() {
  return (
    <div className="mx-auto max-w-xl space-y-3 p-4">
      <PageHeader title="Distribution" subtitle="Call out the token number, find the beneficiary, photograph the handover and save" />
      <DatasetPanel compact />
      <DeskSearch />
    </div>
  );
}
