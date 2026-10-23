import { AttendanceDesk } from "@/components/desk/AttendanceDesk";
import { DatasetPanel } from "@/components/DatasetPanel";
import { Page, PageHeader } from "@/components/ui";

export default function AttendancePage() {
  return (
    <Page width="wide">
      <PageHeader title="Attendance" subtitle="Scan the Aadhaar or type the token. Mark present." />
      <DatasetPanel compact />
      <AttendanceDesk />
    </Page>
  );
}
