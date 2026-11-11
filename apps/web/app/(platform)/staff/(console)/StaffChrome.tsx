"use client";
// Client wrapper for the console shell (13-25 choice 3; 13-09 notes). StaffShell (sidebar, top
// bar, Find, shortcut sheet) with client navigation, and StaffActionProvider inside it so every
// console action shares one step-up flow (13-21 step-up actions). The server layout passes plain
// data only (nav, user, env, Find index). Find searches tickets, sites and cases through
// findAction (13-47); the sidebar badges are re-read every 60 s and on focus through
// todayBadgesAction (D-UI-P13-20) and patched into the nav; a failed read keeps the last ones.
import {
  StaffActionProvider,
  StaffShell,
  useStaffRefresh,
  type StaffEnv,
  type StaffFindEntry,
  type StaffFindSearch,
  type StaffNavItem,
  type StaffUser,
} from "@cds/ui/staff";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  staffConfirmStepUpAction,
  staffRequestStepUpAction,
  staffSignOutAction,
} from "../../../actions/staff/session";
import { findAction, todayBadgesAction } from "../../../actions/staff/today";

export interface StaffChromeProps {
  nav: StaffNavItem[];
  user: StaffUser;
  env: StaffEnv;
  findIndex: StaffFindEntry[];
  title?: string;
  children: ReactNode;
}

/**
 * Marks the current item from the live pathname: the layout is not re-rendered on client
 * navigation, so `current` from the server would go stale. Today (/staff) matches exactly,
 * every other area by prefix.
 */
export function withCurrent(
  nav: readonly StaffNavItem[],
  pathname: string | null,
): StaffNavItem[] {
  const p = pathname ?? "";
  if (!p) return [...nav];
  return nav.map((item) => {
    const on =
      item.href === "/staff"
        ? p === "/staff"
        : p === item.href || p.startsWith(`${item.href}/`);
    const { current, ...rest } = item;
    void current;
    return on ? { ...rest, current: true } : rest;
  });
}

/** Badge keys are section keys (UI-SPEC "Sidebar": Tickets, Pipeline, Review, Health). */
export type StaffNavBadges = Partial<
  Record<"tickets" | "pipeline" | "review" | "health", number | null>
>;

/** Patches fresh badge counts into the nav; null / 0 = no badge (never a wrong one). */
export function withBadges(
  nav: readonly StaffNavItem[],
  badges: StaffNavBadges | null,
): StaffNavItem[] {
  if (!badges) return [...nav];
  return nav.map((item) => {
    if (!(item.key in badges)) return item;
    const n = badges[item.key as keyof StaffNavBadges];
    const { badge, ...rest } = item;
    void badge;
    return typeof n === "number" && n > 0 ? { ...rest, badge: n } : rest;
  });
}

/** Find's server search: a failed or signed-out call shows no server hits. */
export const staffFindSearch: StaffFindSearch = async (q) => {
  const res = await findAction(q);
  return res.ok ? res.data : [];
};

export function StaffChrome({
  nav,
  user,
  env,
  findIndex,
  title,
  children,
}: StaffChromeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [badges, setBadges] = useState<StaffNavBadges | null>(null);
  const refreshBadges = useCallback(() => {
    todayBadgesAction().then(
      (res) => {
        if (res.ok) setBadges(res.data);
      },
      () => {},
    );
  }, []);
  useStaffRefresh(refreshBadges);
  // A fresh server render (navigation, router.refresh) brings its own badges.
  useEffect(() => setBadges(null), [nav]);
  const items = withCurrent(withBadges(nav, badges), pathname);
  return (
    <StaffShell
      nav={items}
      user={user}
      env={env}
      signOutAction={staffSignOutAction}
      findIndex={findIndex}
      searchTickets={staffFindSearch}
      onNavigate={(href) => router.push(href)}
      title={items.find((n) => n.current)?.label ?? title}
    >
      <StaffActionProvider
        requestStepUpCode={staffRequestStepUpAction}
        confirmStepUp={staffConfirmStepUpAction}
      >
        {children}
      </StaffActionProvider>
    </StaffShell>
  );
}
