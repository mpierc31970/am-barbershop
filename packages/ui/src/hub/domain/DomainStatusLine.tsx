// DomainStatusLine (14-30 choice 3; 14-UI-SPEC "DomainStatusLine (always first)", "Owner
// domain tone map"). One Body line: tone badge + sentence + optional link. The badge always
// carries its word (never colour alone); "Your turn" and "Renew soon" reuse the warning
// ready-review tone (never red before something breaks, D-UI-P14-5), "Live" reuses P11 live.
// The sentence arrives from the caller built from P14_COPY (bold domain as <strong>).
// Server-safe: no state.
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "../Badge";
import { DOMAIN_STATUS_WORDS, type DomainStatusTone } from "./copy";

const BADGE: Readonly<Record<DomainStatusTone, BadgeTone>> = {
  none: "dom-none",
  checking: "dom-checking",
  "your-turn": "ready-review",
  cds: "dom-cds",
  finishing: "dom-cds",
  waiting: "dom-waiting",
  ready: "dom-ready",
  live: "live",
  broken: "dom-broken",
  "renew-soon": "ready-review",
};

export interface DomainStatusLineProps {
  tone: DomainStatusTone;
  sentence: ReactNode;
  link?: { href: string; label: string };
}

export function DomainStatusLine({
  tone,
  sentence,
  link,
}: DomainStatusLineProps) {
  return (
    <p
      data-domain-status={tone}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 font-hub text-base text-hub-ink"
    >
      <Badge tone={BADGE[tone]}>{DOMAIN_STATUS_WORDS[tone]}</Badge>
      <span className="max-w-[68ch]">{sentence}</span>
      {link ? (
        <a
          href={link.href}
          className="rounded text-hub-accent underline underline-offset-2 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
        >
          {link.label}
        </a>
      ) : null}
    </p>
  );
}
