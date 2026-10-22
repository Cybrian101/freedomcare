import { AttendanceDesk } from "@/components/desk/AttendanceDesk";
import { DatasetPanel } from "@/components/DatasetPanel";
import { Page, PageHeader } from "@/components/ui";

export default function AttendancePage() {
  return (
    <Page width="wide">
      <PageHeader title="Attendance" subtitle="Mark who has arrived: type a Reg. No., name or Aadhaar, or scan the Aadhaar" />
      <DatasetPanel compact />
      <AttendanceDesk />
    </Page>
  );
}
