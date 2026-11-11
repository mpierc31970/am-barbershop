// The authed staff console layout (13-25 choice 3; STAFF-05, STAFF-06, D311, Invariant 10;
// 13-UI-SPEC "Shell"). requireStaff("console") first (signed out -> /staff/sign-in?next=<path>,
// a non-staff token never gets here; T-13-25-01), then the shell from plain data: the fixed
// 8-item nav filtered by staffCan (Settings absent for support agents), the Dev badge when
// CDS_ENV is not production, the signed-in name + role label, and Find's Screens index from
// STAFF_SECTIONS. Toasts wrap everything; StaffActionProvider (inside StaffChrome) owns step-up.
// Sidebar badges come from the Today read model (13-47 choice 4): staffTodayCounts through the
// per-request loadStaffToday (shared with the Today page); a failed read renders no badge (the
// badges are hints). Find searches tickets, sites and cases through findAction (StaffChrome).
import { ToastRegion } from "@cds/ui/hub";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { PATH_HEADER } from "../../../../lib/path-header";
import { requireStaff } from "../../../../lib/staff-session";
import { loadStaffToday } from "../../../../lib/staff-today";
import {
  staffBadgeCounts,
  staffNav,
  staffRoleLabel,
  staffScreensIndex,
  staffSectionOf,
} from "../sections";
import { StaffChrome } from "./StaffChrome";

export const metadata: Metadata = {
  title: { default: "CDS staff", template: "%s · CDS staff" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function StaffConsoleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireStaff("console");
  const path = (await headers()).get(PATH_HEADER);
  const current = staffSectionOf(path);
  // staffTodayCounts (via loadStaffToday): one read for the badges and the Today page.
  let badges = null;
  try {
    badges = (await loadStaffToday(session)).badges;
  } catch (err) {
    console.error(
      "[staff layout] badges failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
  const nav = staffNav(session.role, current, staffBadgeCounts(badges));
  const env = process.env.CDS_ENV === "production" ? "production" : "dev";
  return (
    <ToastRegion>
      <StaffChrome
        nav={nav}
        user={{ name: session.name, roleLabel: staffRoleLabel(session.role) }}
        env={env}
        findIndex={staffScreensIndex(session.role)}
        title={nav.find((n) => n.current)?.label}
      >
        {children}
      </StaffChrome>
    </ToastRegion>
  );
}
