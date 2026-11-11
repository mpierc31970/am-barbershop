"use client";
// Hub top bar (11-15; DASH-28, DASH-18; 11-UI-SPEC "Header"; D-UI-P11-2, D-UI-P11-3). One
// sticky 56px <header> at every width:
// - >= 1024px: hub-surface, 1px bottom border, 32px sides: org switcher (two or more sites),
//   the 320px Jump to button with its Ctrl K / ⌘ K chip, spacer, View site, bell, profile.
// - < 1024px: hub-surface-2: Open menu (when the shell passes onOpenMenu), the business
//   name (it is the switcher button with two or more sites), spacer, Jump to IconButton,
//   bell, profile; 44px controls.
// The bell is a slot (11-21 fills it). Data and actions arrive as props.
import { Menu, Search } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { IconButton } from "../IconButton";
import { SHELL_COPY } from "./copy";
import { JumpToDialog, useJumpShortcut, type JumpEntry } from "./JumpToDialog";
import { OrgSwitcher, type ShellOrg } from "./OrgSwitcher";
import { ProfileMenu, type ProfileMenuProps } from "./ProfileMenu";

export interface TopBarProps {
  orgs: readonly ShellOrg[];
  currentOrgId: string;
  onSwitch: (id: string) => void | Promise<unknown>;
  /** Server-built, grant-filtered Jump to index (hub hrefs only). */
  jumpIndex: readonly JumpEntry[];
  /** Navigates through the app's nav guard; defaults to location.assign. */
  onNavigate?: (href: string) => void;
  /** Bell slot (AlertBell, 11-21). */
  bell?: ReactNode;
  profile: ProfileMenuProps;
  viewSiteHref?: string;
  /** Phone header Open menu (the shell's nav drawer). */
  onOpenMenu?: () => void;
}

function isMacLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function TopBar({
  orgs,
  currentOrgId,
  onSwitch,
  jumpIndex,
  onNavigate,
  bell,
  profile,
  viewSiteHref,
  onOpenMenu,
}: TopBarProps) {
  const [jumpOpen, setJumpOpen] = useState(false);
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isMacLike()), []);
  useJumpShortcut(() => setJumpOpen(true));

  const navigate = useCallback(
    (href: string) => {
      setJumpOpen(false);
      if (onNavigate) onNavigate(href);
      else window.location.assign(href);
    },
    [onNavigate],
  );

  const current = orgs.find((o) => o.id === currentOrgId) ?? orgs[0];
  const multi = orgs.length > 1;

  return (
    <header
      className={
        "sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-hub-border " +
        "bg-hub-surface-2 px-2 font-hub text-hub-ink lg:gap-4 lg:bg-hub-surface lg:px-8"
      }
    >
      {onOpenMenu ? (
        <span className="lg:hidden">
          <IconButton
            label={SHELL_COPY.openMenu}
            hideTooltip
            onClick={onOpenMenu}
            icon={<Menu aria-hidden="true" size={20} strokeWidth={2} />}
          />
        </span>
      ) : null}
      {multi ? (
        <OrgSwitcher orgs={orgs} currentId={currentOrgId} onSwitch={onSwitch} />
      ) : current ? (
        <span className="min-w-0 truncate px-2 text-base font-semibold lg:hidden">
          {current.name}
        </span>
      ) : null}
      <button
        type="button"
        aria-label={SHELL_COPY.jumpButtonName}
        aria-keyshortcuts={SHELL_COPY.jumpKeyshortcuts}
        aria-haspopup="dialog"
        onClick={() => setJumpOpen(true)}
        className={
          "hidden h-10 w-[320px] items-center gap-2 rounded border border-hub-border-strong " +
          "bg-hub-surface px-3 text-left text-base text-hub-ink-muted transition-colors " +
          "duration-150 hover:bg-hub-surface-2 lg:flex"
        }
      >
        <Search aria-hidden="true" size={16} strokeWidth={2} />
        <span className="flex-1">{SHELL_COPY.jumpButtonText}</span>
        <kbd
          aria-hidden="true"
          className="rounded border border-hub-border px-1.5 font-hub text-sm"
        >
          {mac ? SHELL_COPY.jumpKeysMac : SHELL_COPY.jumpKeysWindows}
        </kbd>
      </button>
      <span className="flex-1" />
      <span className="lg:hidden">
        <IconButton
          label={SHELL_COPY.jumpIconLabel}
          hideTooltip
          aria-keyshortcuts={SHELL_COPY.jumpKeyshortcuts}
          aria-haspopup="dialog"
          onClick={() => setJumpOpen(true)}
          icon={<Search aria-hidden="true" size={20} strokeWidth={2} />}
        />
      </span>
      {viewSiteHref ? (
        <a
          href={viewSiteHref}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden text-base text-hub-accent underline-offset-2 hover:underline lg:inline"
        >
          {SHELL_COPY.viewSite}
        </a>
      ) : null}
      {bell}
      <ProfileMenu {...profile} />
      <JumpToDialog
        entries={jumpIndex}
        open={jumpOpen}
        onOpenChange={setJumpOpen}
        onNavigate={navigate}
      />
    </header>
  );
}
