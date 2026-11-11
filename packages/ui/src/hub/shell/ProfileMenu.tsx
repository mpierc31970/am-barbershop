"use client";
// Profile menu (11-15; DASH-28; 11-UI-SPEC "Profile menu"; D-UI-P11-5). An IconButton
// (CircleUserRound 20, "Your profile and sign out") opening a 280px popover anchored right:
// a non-interactive head (name Body 600, email Label ink-muted truncated, optional role
// line "Owner at Rivera Bakery"), then a menu with "Your profile and alerts" and
// "Sign out". Arrow keys move, Esc closes and returns focus. Sign out is a prop so the app
// can run it through its nav guard.
import { CircleUserRound, LogOut, UserRound } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { IconButton } from "../IconButton";
import { SHELL_COPY } from "./copy";
import { usePopover } from "./usePopover";

export interface ProfileMenuProps {
  name: string;
  email: string;
  /** "Owner at Rivera Bakery" */
  roleLine?: string;
  onSignOut: () => void;
  profileHref?: string;
  LinkComponent?: HubLinkComponent;
}

const ITEM =
  "flex min-h-11 w-full items-center gap-2 px-4 text-left text-base text-hub-ink " +
  "hover:bg-hub-surface-2 focus:bg-hub-surface-2 focus:outline-none";

export function ProfileMenu({
  name,
  email,
  roleLine,
  onSignOut,
  profileHref = SHELL_COPY.profileHref,
  LinkComponent,
}: ProfileMenuProps) {
  const { open, setOpen, close, anchorRef } = usePopover();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const Link = LinkComponent ?? "a";

  const items = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );

  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        move(at + 1);
        break;
      case "ArrowUp":
        move(at - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(list.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={anchorRef} className="relative">
      <IconButton
        label={SHELL_COPY.profileButton}
        hideTooltip={open}
        tooltipAlign="end"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        icon={<CircleUserRound aria-hidden="true" size={20} strokeWidth={2} />}
      />
      {open ? (
        <div
          className={
            "absolute top-full right-0 z-40 mt-1 w-[280px] max-w-[calc(100vw-32px)] rounded " +
            "border border-hub-border bg-hub-surface font-hub text-hub-ink shadow-lg"
          }
        >
          <div className="border-b border-hub-border px-4 py-3">
            <p className="truncate text-base font-semibold">{name}</p>
            <p className="truncate text-sm text-hub-ink-muted">{email}</p>
            {roleLine ? <p className="text-sm">{roleLine}</p> : null}
          </div>
          <div
            ref={menuRef}
            role="menu"
            aria-label={SHELL_COPY.profileButton}
            onKeyDown={onKeyDown}
            className="py-1"
          >
            <Link
              role="menuitem"
              tabIndex={-1}
              href={profileHref}
              className={ITEM}
              onClick={() => close(false)}
            >
              <UserRound aria-hidden="true" size={16} strokeWidth={2} />
              {SHELL_COPY.profileLink}
            </Link>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={ITEM}
              onClick={() => {
                close(false);
                onSignOut();
              }}
            >
              <LogOut aria-hidden="true" size={16} strokeWidth={2} />
              {SHELL_COPY.signOut}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
