"use client";
// Settings client islands (13-46 choice 3; STAFF-18, STAFF-06): StaffList and DemoPanel wired to
// the Settings Server Actions (both super_admin + step-up; useStaffAction inside the components
// opens the step-up dialog and retries once).
import {
  DemoPanel,
  StaffList,
  type DemoPanelView,
  type StaffListRowView,
} from "@cds/ui/staff";
import { useRouter } from "next/navigation";
import {
  changeStaffRoleAction,
  resetDemoAction,
} from "../../../../actions/staff/settings";

export function StaffListIsland({
  rows,
  currentUserId,
}: {
  rows: StaffListRowView[];
  currentUserId: string;
}) {
  return (
    <StaffList
      rows={rows}
      currentUserId={currentUserId}
      changeRole={(id, role) => changeStaffRoleAction(id, role)}
    />
  );
}

export function DemoIsland({ view }: { view: DemoPanelView }) {
  const router = useRouter();
  return (
    <DemoPanel
      view={view}
      reset={async () => {
        const res = await resetDemoAction();
        if (res.ok) router.refresh();
        return res;
      }}
    />
  );
}
