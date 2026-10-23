import { DeskSearch } from "@/components/desk/DeskSearch";
import { DatasetPanel } from "@/components/DatasetPanel";
import { Page, PageHeader } from "@/components/ui";

export default function DistributionPage() {
  return (
    <Page>
      <PageHeader title="Distribution" subtitle="Type the token number, tap the camera, save." />
      <DatasetPanel compact />
      <DeskSearch />
    </Page>
  );
}
