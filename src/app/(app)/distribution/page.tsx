import { DeskSearch } from "@/components/desk/DeskSearch";
import { DatasetPanel } from "@/components/DatasetPanel";
import { Page, PageHeader } from "@/components/ui";

export default function DistributionPage() {
  return (
    <Page>
      <PageHeader title="Distribution" subtitle="Call out the token number, find the person, photograph the handover and save" />
      <DatasetPanel compact />
      <DeskSearch />
    </Page>
  );
}
