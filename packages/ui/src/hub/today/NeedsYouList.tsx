"use client";
// NeedsYouList (11-17; DASH-20, DASH-31; 11-UI-SPEC "Today" § 3; D-UI-P11-10). One
// <section aria-labelledby> "Needs you" with the count, then one row per item in the order
// given (the server already sorts urgent first, then oldest, and filters by the person's
// access). Each row: an urgent marker (TriangleAlert + hidden "Urgent") or a 16px blank, the
// title, an optional sub-line (inbox rows add "· 2 hours ago"), an Optional badge, and ONE
// secondary sm link that finishes it, named with the title too. No primary button here.
// Below 640px the link drops under the text, full width. More than 8 rows: the first 8 and a
// ghost "Show all N" that expands in place. Empty: CircleCheck + "You're all caught up."
// 12-29 (COMM-03, COMM-05): CDS-sourced rows (key prefix `support:`, the support provider) show
// CdsMark 16 in the marker column inside a data-cds-identity wrapper; urgent rows keep
// TriangleAlert. Keyed on the provider prefix only, never on text (T-12-29-01).
// TodaySectionError is the ERR-SECTION panel any Today section shows when its read failed.
import type { NeedsYouItem } from "@cds/core/today";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { Badge } from "../Badge";
import { Button, buttonClasses } from "../Button";
import { CdsMark } from "../cds";
import { InlineAlert } from "../feedback";
import { NEEDS_YOU_VISIBLE, relativeAge, TODAY_COPY } from "./copy";

export interface NeedsYouListProps {
  items: readonly NeedsYouItem[];
  /** Request time (ms) for "2 hours ago"; omit to show no age. */
  now?: number;
  LinkComponent?: HubLinkComponent;
}

/** Needs-you items from the CDS support provider (12-24 keys). */
export function isCdsNeedsYouKey(key: string): boolean {
  return key.startsWith("support:");
}

function subLine(item: NeedsYouItem, now?: number): string {
  const sub = item.sub ?? "";
  if (now === undefined || item.section !== "inbox") return sub;
  const age = relativeAge(item.at, now);
  if (!age) return sub;
  return sub ? `${sub} · ${age}` : age;
}

export function NeedsYouList({ items, now, LinkComponent }: NeedsYouListProps) {
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);
  const Link = LinkComponent ?? "a";
  const shown =
    expanded || items.length <= NEEDS_YOU_VISIBLE
      ? items
      : items.slice(0, NEEDS_YOU_VISIBLE);
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 font-hub text-hub-ink"
      data-needs-you=""
    >
      <div className="flex items-baseline gap-2">
        <h2 id={headingId} className="text-xl leading-tight font-semibold">
          {TODAY_COPY.needsYou}
        </h2>
        {items.length > 0 ? (
          <span className="text-sm text-hub-ink-muted tabular-nums">
            {items.length}
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-base" data-caught-up="">
          <CircleCheck
            aria-hidden
            size={20}
            strokeWidth={2}
            className="shrink-0 text-hub-success"
          />
          {TODAY_COPY.caughtUp}
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-hub-border border-y border-hub-border">
            {shown.map((item) => {
              const sub = subLine(item, now);
              return (
                <li
                  key={item.key}
                  data-needs-you-item={item.key}
                  data-level={item.level}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    {item.level === "urgent" ? (
                      <span className="mt-1 shrink-0">
                        <TriangleAlert
                          aria-hidden
                          size={16}
                          strokeWidth={2}
                          className="text-hub-danger"
                        />
                        <span className="sr-only">{TODAY_COPY.urgent}: </span>
                      </span>
                    ) : isCdsNeedsYouKey(item.key) ? (
                      <span data-cds-identity="" className="mt-1 shrink-0">
                        <CdsMark size={16} />
                      </span>
                    ) : (
                      <span aria-hidden className="w-4 shrink-0" />
                    )}
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="flex flex-wrap items-center gap-2 text-base font-semibold break-words">
                        {item.title}
                        {item.optional ? (
                          <Badge tone="optional">{TODAY_COPY.optional}</Badge>
                        ) : null}
                      </p>
                      {sub ? (
                        <p className="text-sm text-hub-ink-muted">{sub}</p>
                      ) : null}
                    </div>
                  </div>
                  <Link
                    href={item.href}
                    aria-label={`${item.actionLabel}: ${item.title}`}
                    className={`${buttonClasses("secondary", "sm")} w-full shrink-0 sm:w-auto`}
                  >
                    {item.actionLabel}
                  </Link>
                </li>
              );
            })}
          </ul>
          {shown.length < items.length ? (
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(true)}
              >
                {TODAY_COPY.showAll(items.length)}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export interface TodaySectionErrorProps {
  /** Heading of the section that failed (kept so the page keeps its outline). */
  title?: string;
  retryHref?: string;
  LinkComponent?: HubLinkComponent;
}

/** ERR-SECTION in place of one Today section; the rest of the screen renders. */
export function TodaySectionError({
  title,
  retryHref = "/hub/today",
  LinkComponent,
}: TodaySectionErrorProps) {
  const Link = LinkComponent ?? "a";
  return (
    <div className="flex flex-col gap-3 font-hub" data-section-error="">
      {title ? (
        <h2 className="text-xl leading-tight font-semibold text-hub-ink">
          {title}
        </h2>
      ) : null}
      <InlineAlert
        tone="error"
        action={
          <Link href={retryHref} className={buttonClasses("secondary", "sm")}>
            {TODAY_COPY.tryAgain}
          </Link>
        }
      >
        {TODAY_COPY.errSection}
      </InlineAlert>
    </div>
  );
}
