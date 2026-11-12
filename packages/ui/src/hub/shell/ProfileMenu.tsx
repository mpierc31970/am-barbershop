"use client";
// Profile menu (11-15; DASH-28; 11-UI-SPEC "Profile menu"; D-UI-P11-5). An IconButton
// (CircleUserRound 20, "Your profile and sign out") opening a 280px popover anchored right:
// a non-interactive head (name Body 600, email Label ink-muted truncated, optional role
// line "Owner at Rivera Bakery"), then a menu with "Your profile and alerts" and
// "Sign out". Arrow keys move, Esc closes and returns focus. Sign out is a prop so the app
// can run it through its nav guard.
// A&M fork: `links` replaces the default profile link with the person's own items, and
// `photoSeatId` adds "Take a photo" (the phone camera) that posts straight to that seat's
// gallery through /hub/api/studio/photo (a plain multipart form, submitted on pick).
import { Camera, CircleUserRound, LogOut, UserRound } from "lucide-react";
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
  /** The person's own items; when given, they replace the default profile link. */
  links?: readonly { href: string; label: string }[];
  /** Their own seat: adds "Take a photo" (uploads to that seat's gallery). */
  photoSeatId?: string;
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
  links,
  photoSeatId,
}: ProfileMenuProps) {
  const { open, setOpen, close, anchorRef } = usePopover();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
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
      {photoSeatId ? (
        // Outside the popover: the menu closes while the camera is open, and an unmounted
        // input would drop the picked photo.
        <form
          ref={formRef}
          method="post"
          action="/hub/api/studio/photo"
          encType="multipart/form-data"
          hidden
        >
          <input type="hidden" name="seatId" value={photoSeatId} />
          <input type="hidden" name="target" value="gallery" />
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              if (e.currentTarget.files?.length) formRef.current?.submit();
            }}
          />
        </form>
      ) : null}
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
            {(
              links ?? [{ href: profileHref, label: SHELL_COPY.profileLink }]
            ).map((l) => (
              <Link
                key={l.href}
                role="menuitem"
                tabIndex={-1}
                href={l.href}
                className={ITEM}
                onClick={() => close(false)}
              >
                {links ? null : (
                  <UserRound aria-hidden="true" size={16} strokeWidth={2} />
                )}
                {l.label}
              </Link>
            ))}
            {photoSeatId ? (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={ITEM}
                onClick={() => {
                  fileRef.current?.click();
                  close(false);
                }}
              >
                <Camera aria-hidden="true" size={16} strokeWidth={2} />
                Take a photo
              </button>
            ) : null}
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
