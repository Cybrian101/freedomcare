import { AttendanceDesk } from "@/components/desk/AttendanceDesk";
import { DatasetPanel } from "@/components/DatasetPanel";
import { PageHeader } from "@/components/ui";

export default function AttendancePage() {
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <PageHeader title="Attendance" subtitle="Mark who has arrived: type a Reg. No., name or Aadhaar, or scan the Aadhaar" />
      <DatasetPanel compact />
      <AttendanceDesk />
    </div>
  );
}
