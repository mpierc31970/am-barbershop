"use client";
// ServiceNoticeStrip (12-14 choice 1; COMM-11, COMM-05, D99-D101; 12-UI-SPEC "Service notices"
// lines 564-582, spacing 100-101, a11y 845-846, D-UI-P12-17, D-UI-P12-18). Rendered by HubShell
// under the top bar, inside the content column, on every screen a window's scope reaches:
//   - Active: CDS speaking. CdsSurface `flush` (full-bleed, 4px left rule, 1px bottom border),
//     CdsMark 16, NOTICE-ACTIVE text, and "What happened" when an incident is linked (opens a
//     Dialog with the IncidentBox; no extra fetch, choice 5). Never dismissible.
//   - Upcoming (starts within 24 h): neutral hub-surface-2, CalendarClock 16, NOTICE-PLANNED
//     text in ink-muted, and an X IconButton "Dismiss this notice" (per person; P12-P10),
//     described by the strip's own text so each Dismiss names its notice.
// `role="status"` (polite, not alert), not sticky. Active before upcoming; more than two shows
// two strips and a "1 more notice" expander. The notice text is a text node (T-12-14-01).
// `noticesForPath` is the pure page/component filter the shell runs on the live path.
// Focus never falls to <body> (12-REVIEW IN-D06): after Dismiss it moves to the next strip's
// control (else that strip, else the region); after the expander it moves to the first newly
// shown strip. Strips and the region take programmatic focus only (tabIndex -1).
import type { NoticeReach, ServiceNotice } from "@cds/core/support";
import { CalendarClock, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../Button";
import { Dialog } from "../../Dialog";
import { IconButton } from "../../IconButton";
import { CdsMark, CdsSurface } from "../../cds";
import { IncidentBox } from "../paid/IncidentBox";
import { NOTICES_COPY } from "./copy";

/** Site part → the Website tabs that edit it (the lock map in db/support/lock.ts). */
const PART_TABS: Readonly<Record<string, readonly string[]>> = {
  header: ["banner", "site"],
  footer: ["footer"],
  menus: ["navigation"],
};

/** Strips shown before the expander. */
export const NOTICE_STRIPS_SHOWN = 2;

function splitPath(path: string): { pathname: string; tab: string | null } {
  const [rawPath = "", rawQuery = ""] = path.split("?", 2);
  const pathname = rawPath.split("#", 1)[0]!.replace(/\/+$/, "") || "/";
  const query = rawQuery.split("#", 1)[0] ?? "";
  return { pathname, tab: new URLSearchParams(query).get("tab") };
}

function within(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

function reaches(
  reach: NoticeReach | undefined,
  pathname: string,
  tab: string | null,
): boolean {
  if (!reach || reach.scope === "everywhere") return true;
  if (reach.scope === "page") {
    return pathname === `/hub/website/pages/${encodeURIComponent(reach.page)}`;
  }
  const key = reach.component;
  if (Object.hasOwn(PART_TABS, key)) {
    return (
      pathname === "/hub/website" && !!tab && PART_TABS[key]!.includes(tab)
    );
  }
  // An add-on component: its detail page, its sidebar route, or its Website/Marketing tab.
  const slug = encodeURIComponent(key);
  if (within(pathname, `/hub/add-ons/${slug}`)) return true;
  if (within(pathname, `/hub/${slug}`)) return true;
  return (
    (pathname === "/hub/website" || pathname === "/hub/marketing") &&
    tab === key
  );
}

/**
 * The notices this screen shows (UI-SPEC line 566). `path` is the pathname, optionally with
 * its query (`/hub/website?tab=footer`). Site-wide notices (no reach, or `everywhere`) show on
 * every screen; a page notice on `/hub/website/pages/<id>` only; a site part on its Website
 * tab (header: Banner and Site settings; footer: Footer; menus: Navigation); an add-on
 * component on `/hub/add-ons/<slug>`, `/hub/<slug>` and `?tab=<slug>`. Order is kept.
 */
export function noticesForPath(
  notices: readonly ServiceNotice[],
  path: string,
): ServiceNotice[] {
  const { pathname, tab } = splitPath(path);
  return notices.filter((n) => reaches(n.reach, pathname, tab));
}

/** Active before upcoming; otherwise the server's order. */
function ordered(notices: readonly ServiceNotice[]): ServiceNotice[] {
  return [
    ...notices.filter((n) => n.phase === "active"),
    ...notices.filter((n) => n.phase !== "active"),
  ];
}

const STRIP_SPACING = "flex min-h-12 items-center gap-3 px-4 py-2 lg:px-8";
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-hub-accent";

function ActiveStrip({
  notice,
  onWhatHappened,
}: {
  notice: ServiceNotice;
  onWhatHappened: () => void;
}) {
  return (
    <CdsSurface
      flush
      data-notice-id={notice.id}
      tabIndex={-1}
      className={`${STRIP_SPACING} border-t-0 border-r-0 font-hub ${FOCUS_RING}`}
    >
      <CdsMark size={16} className="shrink-0" />
      <p className="min-w-0 flex-1 text-base">
        {notice.text}
        {notice.incident ? (
          <>
            {" "}
            <button
              type="button"
              onClick={onWhatHappened}
              className="font-semibold text-hub-accent underline underline-offset-2 hover:no-underline"
            >
              {NOTICES_COPY.whatHappened}
            </button>
          </>
        ) : null}
      </p>
    </CdsSurface>
  );
}

function UpcomingStrip({
  notice,
  onDismiss,
}: {
  notice: ServiceNotice;
  onDismiss: (() => void) | null;
}) {
  const textId = useId();
  return (
    <div
      data-notice-id={notice.id}
      tabIndex={-1}
      className={`${STRIP_SPACING} border-b border-hub-border bg-hub-surface-2 font-hub ${FOCUS_RING}`}
    >
      <CalendarClock
        aria-hidden
        size={16}
        strokeWidth={2}
        className="shrink-0 text-hub-ink-muted"
      />
      <p id={textId} className="min-w-0 flex-1 text-base text-hub-ink-muted">
        {notice.text}
      </p>
      {onDismiss ? (
        // The Dismiss names its notice (UI-SPEC line 846; 12-REVIEW WR-D07): two planned
        // strips never read as two identical buttons.
        <IconButton
          label={NOTICES_COPY.dismissLabel}
          aria-describedby={textId}
          icon={<X aria-hidden size={16} strokeWidth={2} />}
          size="sm"
          tooltipAlign="end"
          onClick={onDismiss}
        />
      ) : null}
    </div>
  );
}

export interface ServiceNoticeStripProps {
  /** Every notice that reaches the org (activeServiceNotices). */
  notices: readonly ServiceNotice[];
  /** The live path (with `?tab=`): page and component notices show only on their screens. */
  pathname?: string;
  /** Business time zone for the incident box's date line. */
  timeZone: string;
  /** Persist a planned-notice dismissal for this person (the strip hides it at once). */
  onDismiss?: (id: string) => Promise<unknown> | void;
}

export function ServiceNoticeStrip({
  notices,
  pathname,
  timeZone,
  onDismiss,
}: ServiceNoticeStripProps) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [expanded, setExpanded] = useState(false);
  const [incidentFor, setIncidentFor] = useState<string | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  // Where focus goes once the next render lands: the strip index after a Dismiss, or the
  // first newly shown strip after the expander.
  const focusNext = useRef<{ kind: "dismissed" | "expanded"; index: number }>(
    null,
  );
  useEffect(() => {
    const want = focusNext.current;
    if (!want) return;
    focusNext.current = null;
    const region = regionRef.current;
    if (!region) return;
    const strips = Array.from(
      region.querySelectorAll<HTMLElement>("[data-notice-id]"),
    );
    if (want.kind === "expanded") {
      (strips[want.index] ?? region).focus();
      return;
    }
    // The strip that took the dismissed one's place, else the one before it.
    const strip = strips[want.index] ?? strips[want.index - 1];
    const control = strip?.querySelector<HTMLElement>("button");
    (control ?? strip ?? region).focus();
  });
  const here =
    pathname === undefined ? notices : noticesForPath(notices, pathname);
  const shown = ordered(here).filter((n) => !hidden.has(n.id));
  // After the last Dismiss the empty region stays (no height) so focus has somewhere to land.
  if (shown.length === 0 && hidden.size === 0) return null;
  const visible = expanded ? shown : shown.slice(0, NOTICE_STRIPS_SHOWN);
  const rest = shown.length - visible.length;
  const open = incidentFor
    ? (shown.find((n) => n.id === incidentFor) ?? null)
    : null;

  const dismiss = (id: string) => {
    focusNext.current = {
      kind: "dismissed",
      index: Math.max(
        0,
        visible.findIndex((n) => n.id === id),
      ),
    };
    setHidden((prev) => new Set(prev).add(id));
    // The strip hides now; a failed save shows it again on the next load (never an error).
    Promise.resolve(onDismiss?.(id)).catch(() => {});
  };

  return (
    <>
      <div
        ref={regionRef}
        role="status"
        aria-label={NOTICES_COPY.regionLabel}
        tabIndex={-1}
        className={FOCUS_RING}
      >
        {visible.map((n) =>
          n.phase === "active" ? (
            <ActiveStrip
              key={n.id}
              notice={n}
              onWhatHappened={() => setIncidentFor(n.id)}
            />
          ) : (
            <UpcomingStrip
              key={n.id}
              notice={n}
              onDismiss={n.dismissible ? () => dismiss(n.id) : null}
            />
          ),
        )}
        {rest > 0 ? (
          <div className="px-4 py-2 lg:px-8">
            <button
              type="button"
              onClick={() => {
                focusNext.current = { kind: "expanded", index: visible.length };
                setExpanded(true);
              }}
              className="text-sm font-semibold text-hub-accent underline underline-offset-2 hover:no-underline"
            >
              {NOTICES_COPY.more(rest)}
            </button>
          </div>
        ) : null}
      </div>
      {open?.incident ? (
        <Dialog
          open
          onClose={() => setIncidentFor(null)}
          title={NOTICES_COPY.incidentTitle}
          footer={
            <Button variant="secondary" onClick={() => setIncidentFor(null)}>
              {NOTICES_COPY.close}
            </Button>
          }
        >
          <IncidentBox
            incident={open.incident}
            timeZone={timeZone}
            headingLevel="h3"
            context="notice"
          />
        </Dialog>
      ) : null}
    </>
  );
}
