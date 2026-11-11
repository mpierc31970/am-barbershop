// /staff: Today (13-25 choice 4; STAFF-20, STAFF-26, P13-P23). requireStaff("console"); the
// needs-attention panel is filled by 13-47 (TODAY-EMPTY when nothing needs attention). 13-47
// wiring only: the title gains "(3)" from the same staffTodayCounts read (loadStaffToday,
// cached per request and shared with the panel and the sidebar badges).
import type { Metadata } from "next";
import { getStaffSession, requireStaff } from "../../../../lib/staff-session";
import { loadStaffToday } from "../../../../lib/staff-today";
import { STAFF_SECTIONS } from "../sections";
import {
  StaffAreaPage,
  type StaffPanel,
  type StaffSearchParams,
} from "./StaffAreaPage";
import TodayTab from "./panels/today";

const TodayPanel: StaffPanel = TodayTab;

export async function generateMetadata(): Promise<Metadata> {
  try {
    const session = await getStaffSession();
    if (!session) return { title: "Today" };
    const { rows } = await loadStaffToday(session);
    const n = rows.filter((r) => r.count !== null).length;
    return { title: n > 0 ? `(${n}) Today` : "Today" };
  } catch {
    return { title: "Today" };
  }
}

export const dynamic = "force-dynamic";

export default async function StaffTodayPage({
  searchParams,
}: {
  searchParams?: Promise<StaffSearchParams>;
}) {
  const params: StaffSearchParams = (await searchParams) ?? {};
  const session = await requireStaff(STAFF_SECTIONS.today.feature);
  return (
    <StaffAreaPage section="today" session={session}>
      {await TodayPanel({ session, params })}
    </StaffAreaPage>
  );
}
