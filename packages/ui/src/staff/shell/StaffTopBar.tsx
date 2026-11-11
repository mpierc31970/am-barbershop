"use client";
// Staff top bar (13-09; STAFF-05; 13-UI-SPEC "Top bar"). One sticky 56px <header>:
// - >= 1024px: the 280px Find button (Search 16, "Find a site or ticket", KeyHint Ctrl K /
//   ⌘ K), spacer, Keyboard shortcuts IconButton, "All times Central".
// - < 1024px (phone header): Open menu (the shell's Drawer), the screen title truncated,
//   spacer, Find IconButton, Keyboard shortcuts IconButton; 44px controls.
// The dev badge also shows here on phones, where the sidebar is hidden.
import { Keyboard, Menu, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "../../hub/IconButton";
import { KeyHint } from "../table/KeyHint";
import { STAFF_SHELL_COPY } from "./copy";
import { DevBadge, type StaffEnv } from "./StaffSidebar";

export interface StaffTopBarProps {
  env: StaffEnv;
  onOpenMenu: () => void;
  onOpenFind: () => void;
  onOpenShortcuts: () => void;
  /** Phone header title (the current screen); defaults to "CDS staff". */
  title?: string;
}

function isMacLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function StaffTopBar({
  env,
  onOpenMenu,
  onOpenFind,
  onOpenShortcuts,
  title,
}: StaffTopBarProps) {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isMacLike()), []);
  return (
    <header
      className={
        "sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-hub-border " +
        "bg-hub-surface-2 px-2 font-hub text-hub-ink lg:gap-4 lg:bg-hub-surface lg:px-8"
      }
    >
      <span className="lg:hidden">
        <IconButton
          label={STAFF_SHELL_COPY.openMenu}
          hideTooltip
          tooltipAlign="start"
          aria-haspopup="dialog"
          onClick={onOpenMenu}
          icon={<Menu aria-hidden="true" size={20} strokeWidth={2} />}
        />
      </span>
      <span className="min-w-0 truncate px-2 text-base font-semibold lg:hidden">
        {title ?? STAFF_SHELL_COPY.brand}
      </span>
      <span className="lg:hidden">
        <DevBadge env={env} />
      </span>
      <button
        type="button"
        aria-label={STAFF_SHELL_COPY.findButton}
        aria-keyshortcuts={STAFF_SHELL_COPY.findKeyshortcuts}
        aria-haspopup="dialog"
        onClick={onOpenFind}
        className={
          "hidden h-10 w-[280px] items-center gap-2 rounded border border-hub-border-strong " +
          "bg-hub-surface px-3 text-left text-sm text-hub-ink-muted transition-colors " +
          "duration-150 hover:bg-hub-surface-2 lg:flex"
        }
      >
        <Search aria-hidden="true" size={16} strokeWidth={2} />
        <span className="flex-1">{STAFF_SHELL_COPY.findButton}</span>
        <span aria-hidden="true">
          <KeyHint>
            {mac
              ? STAFF_SHELL_COPY.findKeysMac
              : STAFF_SHELL_COPY.findKeysWindows}
          </KeyHint>
        </span>
      </button>
      <span className="flex-1" />
      <span className="lg:hidden">
        <IconButton
          label={STAFF_SHELL_COPY.findIcon}
          hideTooltip
          aria-keyshortcuts={STAFF_SHELL_COPY.findKeyshortcuts}
          aria-haspopup="dialog"
          onClick={onOpenFind}
          icon={<Search aria-hidden="true" size={20} strokeWidth={2} />}
        />
      </span>
      <IconButton
        label={STAFF_SHELL_COPY.shortcutsTitle}
        tooltipAlign="end"
        aria-keyshortcuts="?"
        aria-haspopup="dialog"
        onClick={onOpenShortcuts}
        icon={<Keyboard aria-hidden="true" size={16} strokeWidth={2} />}
      />
      <span className="hidden text-sm text-hub-ink-muted lg:inline">
        {STAFF_SHELL_COPY.allTimesCentral}
      </span>
    </header>
  );
}
