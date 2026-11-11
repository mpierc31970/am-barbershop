// Panel settings/staff: filled by 13-46
// Panel settings/staff (13-46 choices 1 and 3; STAFF-06; 13-UI-SPEC "Settings" Staff; T-13-46-01).
// The area page already required `staff_roles` (super_admin). staffListStaff -> StaffList (role
// change runs changeStaffRoleAction -> setStaffRole with step-up). Invite and remove stay CLI.
import { staffListStaff, type StaffMemberRow } from "@cds/db";
import { formatHealthTime, type StaffListRowView } from "@cds/ui/staff";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { StaffListIsland } from "../SettingsIslands";

export function staffListRowView(r: StaffMemberRow): StaffListRowView {
  return {
    id: r.id,
    name: r.name,
    emailMasked: r.emailMasked,
    role: r.role,
    lastSignIn: formatHealthTime(r.lastSignIn),
  };
}

export default async function Panel({ session }: StaffPanelProps) {
  let rows: StaffMemberRow[];
  try {
    rows = await staffListStaff(session.ctx);
  } catch (err) {
    console.error(
      "[staff] staff list failed",
      err instanceof Error ? err.name : typeof err,
    );
    return <SitesLoadError href="/staff/settings?tab=staff" />;
  }
  return (
    <StaffListIsland
      rows={rows.map(staffListRowView)}
      currentUserId={session.ctx.actor}
    />
  );
}
