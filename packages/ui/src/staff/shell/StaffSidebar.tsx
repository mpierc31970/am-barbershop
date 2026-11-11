// Staff sidebar (13-09; STAFF-05, D311; 13-UI-SPEC "Sidebar"). Data-driven and role-agnostic:
// The web app builds `nav` from STAFF_SECTIONS + staffCan (Settings is simply absent for an
// agent), so this component never knows roles (T-13-09-01). Top: CdsMark + "CDS staff" and, in
// dev only, the h-warn "Dev" badge (D-UI-P13-4). One flat list in the given order, 40px rows,
// icon 20 + label, aria-current="page" on the current item, neutral count chips ("9+", sr
// "12 need attention"; never red). Bottom: signed-in name, role badge, ghost Sign out (a form
// posting the injected server action). Server-safe: the shell renders it in the fixed column
// and inside the phone Drawer.
import {
  Activity,
  Globe,
  House,
  LifeBuoy,
  LogOut,
  Package,
  Settings,
  ShieldCheck,
  SquareKanban,
} from "lucide-react";
import { Badge } from "../../hub/Badge";
import { Button } from "../../hub/Button";
import { CdsMark } from "../../hub/cds/CdsMark";
import { STAFF_SHELL_COPY } from "./copy";

/** The sidebar icons (UI-SPEC table). A name, so a server component can pass it. */
export const STAFF_NAV_ICONS = {
  House,
  LifeBuoy,
  SquareKanban,
  ShieldCheck,
  Globe,
  Package,
  Activity,
  Settings,
} as const;

export type StaffNavIcon = keyof typeof STAFF_NAV_ICONS;

export interface StaffNavItem {
  /** Section key (`today`, `tickets` …); `g x` shortcuts look items up by it. */
  key: string;
  href: string;
  label: string;
  icon: StaffNavIcon;
  /** Neutral attention count; 0 or absent shows nothing. */
  badge?: number;
  current?: boolean;
}

export interface StaffUser {
  name: string;
  /** "Super Admin" / "Support agent". */
  roleLabel: string;
}

export type StaffEnv = "production" | "dev";

/** Server action posted by the Sign out form. */
export type StaffSignOutAction = (formData: FormData) => void | Promise<void>;

/** "3", "9+", or null for 0 / absent. */
export function formatNavBadge(n: number | undefined): string | null {
  if (!n || n <= 0) return null;
  return n > 9 ? "9+" : String(n);
}

export function DevBadge({ env }: { env: StaffEnv }) {
  if (env === "production") return null;
  return (
    <span data-env-badge="">
      <Badge tone="h-warn">{STAFF_SHELL_COPY.dev}</Badge>
    </span>
  );
}

export interface StaffSidebarProps {
  nav: readonly StaffNavItem[];
  user: StaffUser;
  env: StaffEnv;
  signOutAction: StaffSignOutAction;
  /** The Drawer closes when a nav link is followed. */
  onNavigateItem?: () => void;
}

export function StaffSidebar({
  nav,
  user,
  env,
  signOutAction,
  onNavigateItem,
}: StaffSidebarProps) {
  return (
    <div className="flex h-full flex-col bg-hub-surface-2 font-hub text-hub-ink">
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <CdsMark size={20} />
          <span className="text-sm font-semibold">
            {STAFF_SHELL_COPY.brand}
          </span>
        </div>
        <DevBadge env={env} />
      </div>
      <nav aria-label={STAFF_SHELL_COPY.navLabel} className="flex-1 px-2">
        <ul className="flex flex-col gap-0.5">
          {nav.map((item) => {
            const Icon = STAFF_NAV_ICONS[item.icon];
            const chip = formatNavBadge(item.badge);
            return (
              <li key={item.key}>
                <a
                  href={item.href}
                  aria-current={item.current ? "page" : undefined}
                  onClick={onNavigateItem}
                  className={
                    "flex h-10 items-center gap-3 rounded px-3 text-sm transition-colors " +
                    "duration-150 pointer-coarse:h-11 " +
                    (item.current
                      ? "bg-hub-surface font-semibold text-hub-ink"
                      : "text-hub-ink-muted hover:bg-hub-surface hover:text-hub-ink")
                  }
                >
                  <Icon aria-hidden="true" size={20} strokeWidth={2} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {chip ? (
                    <>
                      <span
                        data-nav-badge=""
                        aria-hidden="true"
                        className={
                          "inline-flex h-5 min-w-5 items-center justify-center rounded-full " +
                          "border border-hub-border bg-hub-surface px-1.5 text-sm leading-none " +
                          "font-semibold text-hub-ink tabular-nums"
                        }
                      >
                        {chip}
                      </span>
                      <span className="sr-only">
                        {`, ${STAFF_SHELL_COPY.needAttention(item.badge!)}`}
                      </span>
                    </>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex flex-col gap-2 border-t border-hub-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm text-hub-ink-muted">
            {user.name}
          </span>
          <Badge tone="role">{user.roleLabel}</Badge>
        </div>
        <form action={signOutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            icon={<LogOut aria-hidden="true" size={16} strokeWidth={2} />}
          >
            {STAFF_SHELL_COPY.signOut}
          </Button>
        </form>
      </div>
    </div>
  );
}
