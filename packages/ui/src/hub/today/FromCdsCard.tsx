"use client";
// FromCdsCard (11-19; DASH-23; 11-UI-SPEC "Today" § 8; D-UI-P11-24). At most one card, last in
// the side rail. Panel (1px border, 8px radius, 24px padding): Heading "From CDS" (the CDS
// byline; its row is `data-cds-identity`) + an X IconButton "Dismiss this card", then Body 600 title +
// Body text (at most 3 lines) + one text link by kind:
//   announcement → its optional link · training → "Show me how" (opens the TrainingDrawer)
//   tip → the tip's link · addon → "See {Add-on}" (/hub/add-ons/<slug>).
// Dismiss is saved per person (`onDismiss(id)`); the card leaves at once and the next one in
// priority shows on the next visit, not instantly. No Dismiss when `canDismiss` is false
// (impersonating staff). Never adds to Needs you.
// 12-29 (COMM-02, COMM-05; 12-UI-SPEC "From CDS card"): CdsMark 20 before the heading (decorative,
// the heading says CDS) inside the data-cds-identity heading row, and the `note` kind (a pinned
// CDS note, top priority) with the link "Read the note" (Support > Messages). Dismiss hides the
// card, never the note.
import type { FromCdsCard as FromCdsCardData } from "@cds/core/today";
import { X } from "lucide-react";
import { useId, useState } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { CdsMark } from "../cds";
import type { HowToStepView } from "../addon-types";
import { IconButton } from "../IconButton";
import { TrainingDrawer } from "../TrainingDrawer";
import { TODAY_CARDS_COPY } from "./copy";

export interface FromCdsCardProps {
  card: FromCdsCardData;
  /** Training kind: the add-on's how-to "Use" steps for the drawer. */
  steps?: readonly HowToStepView[];
  canDismiss?: boolean;
  onDismiss?: (id: string) => unknown;
  LinkComponent?: HubLinkComponent;
}

const LINK =
  "rounded text-base text-hub-accent underline underline-offset-2 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function isExternal(href: string): boolean {
  return /^https:\/\//.test(href);
}

export function FromCdsCard({
  card,
  steps = [],
  canDismiss = true,
  onDismiss,
  LinkComponent,
}: FromCdsCardProps) {
  const headingId = useId();
  const [gone, setGone] = useState(false);
  const [training, setTraining] = useState(false);
  const Link = LinkComponent ?? "a";
  if (gone) return null;

  let action = null;
  if (card.kind === "note") {
    action = (
      <Link href={card.link.href} className={LINK}>
        {card.link.label}
      </Link>
    );
  } else if (card.kind === "announcement" && card.link) {
    const ext = isExternal(card.link.href);
    action = ext ? (
      <a
        href={card.link.href}
        target="_blank"
        rel="noopener noreferrer"
        className={LINK}
      >
        {card.link.label}
      </a>
    ) : (
      <Link href={card.link.href} className={LINK}>
        {card.link.label}
      </Link>
    );
  } else if (card.kind === "tip") {
    action = (
      <Link href={card.link.href} className={LINK}>
        {card.link.label}
      </Link>
    );
  } else if (card.kind === "addon") {
    action = (
      <Link href={card.href} className={LINK}>
        {TODAY_CARDS_COPY.seeAddon(card.title)}
      </Link>
    );
  } else if (card.kind === "training" && steps.length > 0) {
    action = (
      <button type="button" onClick={() => setTraining(true)} className={LINK}>
        {TODAY_CARDS_COPY.showMeHow}
      </button>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-from-cds={card.kind}
      data-card-id={card.id}
      className="flex flex-col gap-3 rounded-lg border border-hub-border bg-hub-surface p-6 font-hub text-hub-ink"
    >
      <div className="flex items-center justify-between gap-2">
        <div data-cds-identity="" className="flex items-center gap-2">
          <CdsMark size={20} />
          <h2 id={headingId} className="text-xl leading-tight font-semibold">
            {TODAY_CARDS_COPY.fromCds}
          </h2>
        </div>
        {canDismiss && onDismiss ? (
          <IconButton
            size="sm"
            tooltipAlign="end"
            label={TODAY_CARDS_COPY.dismiss}
            icon={<X aria-hidden size={16} strokeWidth={2} />}
            onClick={() => {
              setGone(true);
              onDismiss(card.id);
            }}
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold">{card.title}</p>
        <p className="line-clamp-3 text-base">{card.text}</p>
      </div>
      {action ? <div>{action}</div> : null}
      {card.kind === "training" && steps.length > 0 ? (
        <TrainingDrawer
          open={training}
          onClose={() => setTraining(false)}
          title={card.title}
          steps={steps}
        />
      ) : null}
    </section>
  );
}
