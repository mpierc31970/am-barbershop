"use client";
// "What's still needed" (06-18; 06-UI-SPEC "Setup overview" StillNeededList; ONB-02,
// ONB-03, D312). Heading, then:
//   - Must-haves: "Business phone or email · Contact & hours" + Needed badge; each row links
//     to the step with the field's anchor (/hub/setup/contact#field-phone).
//   - Optional: the item and its step, then what happens if it stays empty (the intake
//     schema's owner text, so the hub and the P8 build say the same thing). Collapsed after
//     5 rows behind "Show N more".
//   - Nothing left: "Everything's in. CDS has what it needs."
// The footer (the view's one primary action) is passed in by the overview.
// 09-19: `extra` is one more row the overview owns (the agreement item): a required one sits
// first under Must-haves and keeps "Everything's in" away; any other shows as its own row
// above Optional.
import type { NeededItem } from "@cds/core/intake";
import { STAGES } from "@cds/core/intake";
import { useId, useState, type ReactNode } from "react";
import type { HubLinkComponent } from "./AddonCard";
import { Badge } from "./Badge";

export const NOTHING_LEFT_COPY = "Everything's in. CDS has what it needs.";
export const OPTIONAL_VISIBLE = 5;

export interface StillNeededListProps {
  required: readonly NeededItem[];
  optional: readonly NeededItem[];
  footer: ReactNode;
  LinkComponent?: HubLinkComponent;
  /** One more row (its content), required or not (09-19 agreement item). */
  extra?: { node: ReactNode; required: boolean } | null;
}

function stageName(slug: string): string {
  return STAGES.find((s) => s.slug === slug)?.name ?? "";
}

const FOCUS =
  "rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";
const ROW_LINK = `text-hub-ink underline-offset-2 hover:underline ${FOCUS}`;

export function StillNeededList({
  required,
  optional,
  footer,
  LinkComponent,
  extra,
}: StillNeededListProps) {
  const L = LinkComponent ?? "a";
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);
  const shownOptional = expanded
    ? optional
    : optional.slice(0, OPTIONAL_VISIBLE);
  const hidden = optional.length - shownOptional.length;
  const extraRequired = extra?.required === true;
  const nothing =
    required.length === 0 && optional.length === 0 && !extraRequired;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-6 rounded-lg bg-hub-surface-2 p-6 font-hub"
    >
      <h2
        id={headingId}
        className="text-xl leading-tight font-semibold text-hub-ink"
      >
        What&apos;s still needed
      </h2>

      {nothing ? (
        <p className="text-base text-hub-ink">{NOTHING_LEFT_COPY}</p>
      ) : null}

      {required.length > 0 || extraRequired ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-hub-ink">Must-haves</h3>
          <ul className="flex flex-col gap-2">
            {extraRequired ? <li>{extra?.node}</li> : null}
            {required.map((item) => (
              <li
                key={item.fieldId}
                className="flex items-start justify-between gap-2"
              >
                <L href={item.href} className={`text-sm ${ROW_LINK}`}>
                  {item.label} · {stageName(item.stage)}
                </L>
                <Badge tone="needed">Needed</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {extra && !extraRequired ? <div>{extra.node}</div> : null}

      {optional.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-hub-ink">Optional</h3>
          <ul className="flex flex-col gap-4">
            {shownOptional.map((item) => (
              <li key={item.fieldId} className="flex flex-col gap-1">
                <L href={item.href} className={`text-sm ${ROW_LINK}`}>
                  {item.label} · {stageName(item.stage)}
                </L>
                {item.ownerText ? (
                  <p className="text-sm text-hub-ink-muted">{item.ownerText}</p>
                ) : null}
              </li>
            ))}
          </ul>
          {hidden > 0 ? (
            <button
              type="button"
              aria-expanded={false}
              onClick={() => setExpanded(true)}
              className={`min-h-11 self-start text-sm font-semibold text-hub-accent ${FOCUS}`}
            >
              Show {hidden} more
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-hub-border pt-4">
        {footer}
      </div>
    </section>
  );
}
