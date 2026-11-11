"use client";
// Add-on tab header row (05-06; 05-UI-SPEC "Add-on tabs" item 1, R1, R2; D311).
// Left: Heading and the count line (Label, ink-muted, tabular). 11-47 (D-UI-P11-16): no "?"
// here any more; the screen's ScreenHeader "?" resolves the current tab's how-to, so each
// screen has exactly one. `helpLabel` / `onHelp` are accepted and ignored. Right: the view's one primary ("Add testimonial";
// omitted while the list is empty so the empty state's "Add your first ..." is the single
// primary, R2), Import (secondary, Upload icon, "Import <plural>"), and an overflow menu
// (Export CSV, Download the template, Backups). Below 768px the actions wrap under the
// heading with the primary full width first.
// Menu focus contract (C-WR-06): opening focuses the first item; Esc and picking an item
// close it and return focus to More actions; a pointer press outside or focus leaving the
// actions closes it; aria-controls is set only while the list exists.
// 12-17 (COMM-11, D102; UI-SPEC lines 586-593): `locked` (or AddonTabLockContext, which the
// hub's add-on tab loader provides around the add-on's own panel) shows the LockedPanel under
// the header row while a CDS service window locks the add-on. The actions stay visible but
// aria-disabled and described by the panel (disabled, not hidden); the menu does not open.
import { MoreHorizontal, Upload } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { LockedPanel } from "./support/notices/LockedPanel";

/** A CDS service window locking this add-on's editor (12-17). */
export interface AddonTabLock {
  /** The window's end (ISO). */
  until: string;
  /** Owner words for the locked thing ("add-on"). */
  target: string;
  timeZone: string;
  /** The panel id the disabled controls point at. */
  panelId: string;
  /** A save parked by the lock (HELD-KEPT + "Saved at …"). */
  held?: { savedAt: string } | null;
}

/** Lets the hub's add-on tab loader lock a registry panel's header without new panel props. */
export const AddonTabLockContext = createContext<AddonTabLock | null>(null);

export interface AddonTabMenuItem {
  label: string;
  onSelect: () => void;
}

export interface AddonTabHeaderProps {
  /** "Testimonials" */
  heading: string;
  /** "12 testimonials · 9 shown on your site" */
  countLine: string;
  /** @deprecated 11-47: ignored; the ScreenHeader "?" opens the how-to (D-UI-P11-16). */
  helpLabel?: string;
  /** @deprecated 11-47: ignored. */
  onHelp?: () => void;
  /** Id of the heading, for a host section's aria-labelledby. */
  headingId?: string;
  /** Lower-case plural, for the Import button's accessible name (R1). */
  plural: string;
  /** The one primary action; null hides it (empty list, R2). */
  primary?: { label: string; onClick: () => void } | null;
  /** Shown only when CSV import is enabled. */
  onImport?: () => void;
  menu: readonly AddonTabMenuItem[];
  /** 12-17: the add-on is locked by a CDS service window (default: AddonTabLockContext). */
  locked?: AddonTabLock | null;
}

const MENU_ITEM =
  "flex min-h-10 w-full items-center rounded px-3 text-left text-sm text-hub-ink " +
  "transition-colors duration-150 hover:bg-hub-surface-2 pointer-coarse:min-h-11";

export function AddonTabHeader({
  heading,
  countLine,
  plural,
  primary = null,
  onImport,
  menu,
  headingId,
  locked: lockedProp,
}: AddonTabHeaderProps) {
  const lockedCtx = useContext(AddonTabLockContext);
  const locked = lockedProp === undefined ? lockedCtx : lockedProp;
  const lockProps = locked
    ? {
        "aria-disabled": true as const,
        "aria-describedby": locked.panelId,
      }
    : {};
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const trigger = () =>
    wrapRef.current?.querySelector<HTMLButtonElement>("[data-menu-trigger]") ??
    null;
  /** Close and put focus back on More actions (Esc, a picked item). */
  const closeToTrigger = () => {
    setOpen(false);
    trigger()?.focus();
  };

  // Opening moves focus into the menu (05-UI-SPEC "Accessibility contract").
  useEffect(() => {
    if (open) listRef.current?.querySelector("button")?.focus();
  }, [open]);

  // A pointer press anywhere outside closes the menu (focus stays where the owner put it).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const wrap = wrapRef.current;
      if (wrap && e.target instanceof Node && !wrap.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const row = (
    <div className="flex flex-col gap-4 font-hub md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          id={headingId}
          className="text-xl leading-tight font-semibold text-hub-ink"
        >
          {heading}
        </h2>
        <p className="text-sm text-hub-ink-muted tabular-nums">{countLine}</p>
      </div>
      <div
        ref={wrapRef}
        className="relative flex flex-wrap items-center gap-2"
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            closeToTrigger();
          }
        }}
        onBlur={(e) => {
          // Tabbing (or any focus move) out of the actions closes the menu.
          const next = e.relatedTarget;
          if (open && next instanceof Node && !e.currentTarget.contains(next)) {
            setOpen(false);
          }
        }}
      >
        {primary ? (
          <Button
            variant="primary"
            onClick={locked ? undefined : primary.onClick}
            className="w-full md:w-auto"
            {...lockProps}
          >
            {primary.label}
          </Button>
        ) : null}
        {onImport ? (
          <Button
            variant="secondary"
            onClick={locked ? undefined : onImport}
            {...lockProps}
            aria-label={`Import ${plural}`}
            icon={<Upload aria-hidden size={16} strokeWidth={2} />}
          >
            Import
          </Button>
        ) : null}
        {menu.length > 0 ? (
          <IconButton
            label={`More actions for ${heading}`}
            tooltipAlign="end"
            data-menu-trigger=""
            aria-expanded={open}
            // Only while the list is in the DOM (it is unmounted when closed).
            aria-controls={open ? menuId : undefined}
            onClick={() => {
              if (!locked) setOpen((o) => !o);
            }}
            {...lockProps}
            icon={<MoreHorizontal aria-hidden size={20} strokeWidth={2} />}
          />
        ) : null}
        {open ? (
          <ul
            ref={listRef}
            id={menuId}
            aria-label={`${heading} actions`}
            className={
              "absolute top-full right-0 z-20 mt-1 flex min-w-56 flex-col gap-1 rounded " +
              "border border-hub-border bg-hub-surface p-1 shadow-lg"
            }
          >
            {menu.map((item) => (
              <li key={item.label}>
                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={() => {
                    // Focus goes back to the trigger first, so a dialog the item opens
                    // returns focus there when it closes.
                    closeToTrigger();
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
  if (!locked) return row;
  return (
    <div className="flex flex-col gap-4">
      {row}
      <LockedPanel
        id={locked.panelId}
        target={locked.target}
        until={locked.until}
        timeZone={locked.timeZone}
        held={locked.held ?? null}
      />
    </div>
  );
}
