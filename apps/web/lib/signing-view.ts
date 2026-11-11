// The signing screen's view model (09-17; AGR-07, CONTEXT A2-Q1, A3-Q1, D216, D287;
// 09-UI-SPEC "Signing screen", "Re-accept", Copywriting Contract). Pure: the page reads the
// status, the active set and the names, and this decides what the owner (or a member)
// sees. The cards are exactly the set the server will accept (09-10 choice 1): every active
// policy for an unsigned org, the `missing` list for an outdated one, and every active
// policy when only the consent text moved on.
import type { ConsentVersion, PolicyVersion } from "@cds/core/legal";
import type { AgreementStatus } from "@cds/db";
import { formatLegalDate } from "./legal-pages";

/** D216 order. */
const ORDER = [
  "service-agreement",
  "acceptable-use",
  "terms-of-service",
  "subscription-terms",
  "dpa",
] as const;

export const SIGN_TITLE = "Review and sign your agreement";
export const REACCEPT_TITLE = "We've updated our terms";
export const CURRENT_TITLE = "Your agreement";
export const INTRO_SIGN =
  "Five short policies cover how CDS builds and hosts your site. Read the summaries, open the full text of anything you want to check, tick each one, then sign once. You'll get a copy to keep.";
export const INTRO_CURRENT =
  "You've signed the current versions of every CDS policy. Your signed copies are in Settings › Legal.";
export const INTRO_CONSENT_ONLY =
  "We updated the electronic signature consent. Review the policies and sign again to keep using your hub. Your site stays live the whole time.";
export const CURRENT_COPY = "Your agreement is up to date.";
export const IMPERSONATING_SIGN_COPY =
  "You're viewing as CDS staff, so signing is turned off. Only the owner can sign.";
export const DRAFT_HUB_TITLE = "Draft wording";
export const DRAFT_HUB_COPY =
  "These policies are drafts and haven't been reviewed by a lawyer yet. CDS will ask you to accept the final wording before it applies.";

export function introReaccept(n: number): string {
  return `We changed ${n} of the policies you signed. Here's what changed. Sign again to keep using your hub. Your site stays live the whole time.`;
}

export function notOwnerSign(ownerName: string): string {
  const who = ownerName.trim() || "The site owner";
  return `Only the site owner can sign this agreement. ${who} will see it when they next sign in.`;
}

export type SigningCard = {
  key: string;
  version: number;
  sha256: string;
  title: string;
  metaLine: string;
  summary: readonly string[];
  /** Compiled, sanitised policy HTML (codegen); never user input (T-09-17-05). */
  bodyHtml: string;
  fullTextHref: string;
  whatChanged?: string;
  draft: boolean;
};

export type SigningView = {
  kind: "form" | "readonly" | "current" | "redirect";
  title: string;
  intro: string;
  /** Re-accept layout: changed cards, what-changed lines, still-current list. */
  reaccept: boolean;
  cards: SigningCard[];
  stillCurrent: string | null;
  consent: {
    version: number;
    sha256: string;
    metaLine: string;
    bodyHtml: string;
  };
  alert: { tone: "info" | "success"; text: string } | null;
  showDraft: boolean;
  /** "8 Oct 2026": the org's local day (review IN-C06; was the UTC day, 09-17 choice 4). */
  dateLabel: string;
  /** Org legal name, else business name (the signing statement). */
  onBehalfOf: string;
};

export type SigningViewInput = {
  status: AgreementStatus;
  active: readonly PolicyVersion[];
  consent: ConsentVersion;
  mode: "sign" | "reaccept";
  role: string;
  impersonating: boolean;
  ownerName: string;
  onBehalfOf: string;
  /** YYYY-MM-DD. */
  today: string;
};

function rank(key: string): number {
  const i = (ORDER as readonly string[]).indexOf(key);
  return i === -1 ? ORDER.length : i;
}

function byOrder<T extends { key: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => rank(a.key) - rank(b.key));
}

/** "2026-10-08 10:00:00.000Z" or ISO → "8 Oct 2026". */
function day(v: string): string {
  return formatLegalDate(v.slice(0, 10));
}

function baseMeta(p: PolicyVersion): string {
  return `Version ${p.version} · Effective ${day(p.effectiveAt)}`;
}

function card(
  p: PolicyVersion,
  extra: { metaLine?: string; whatChanged?: string } = {},
): SigningCard {
  return {
    key: p.key,
    version: p.version,
    sha256: p.sha256,
    title: p.title,
    metaLine: extra.metaLine ?? baseMeta(p),
    summary: [...p.summary],
    bodyHtml: p.bodyHtml,
    fullTextHref: `/legal/${p.key}/v${p.version}`,
    ...(extra.whatChanged ? { whatChanged: extra.whatChanged } : {}),
    draft: p.draft,
  };
}

export function buildSigningView(input: SigningViewInput): SigningView {
  const { status, active, consent, mode } = input;
  const consentView = {
    version: consent.version,
    sha256: consent.sha256,
    metaLine: `Electronic signature consent · Version ${consent.version}`,
    bodyHtml: consent.bodyHtml,
  };
  const dateLabel = day(input.today);
  const empty = {
    cards: [],
    stillCurrent: null,
    consent: consentView,
    showDraft: false,
    reaccept: false,
    dateLabel,
    onBehalfOf: input.onBehalfOf,
  };

  if (status.state === "current") {
    if (mode === "reaccept") {
      return {
        ...empty,
        kind: "redirect",
        title: REACCEPT_TITLE,
        intro: "",
        alert: null,
      };
    }
    return {
      ...empty,
      kind: "current",
      title: CURRENT_TITLE,
      intro: INTRO_CURRENT,
      alert: { tone: "success", text: CURRENT_COPY },
    };
  }

  const ordered = byOrder(active);
  let cards: SigningCard[];
  let title: string;
  let intro: string;
  let stillCurrent: string | null = null;
  const reaccept = status.state === "outdated";

  if (!reaccept) {
    cards = ordered.map((p) => card(p));
    title = SIGN_TITLE;
    intro = INTRO_SIGN;
  } else if (status.missing.length === 0) {
    // Consent text moved on, no policy did: the server takes the full active set.
    cards = ordered.map((p) => card(p));
    title = REACCEPT_TITLE;
    intro = INTRO_CONSENT_ONLY;
  } else {
    const missing = new Map(status.missing.map((m) => [m.key, m]));
    cards = [];
    const still: string[] = [];
    for (const p of ordered) {
      const m = missing.get(p.key);
      if (!m || m.version !== p.version) {
        still.push(`${p.title} v${p.version}`);
        continue;
      }
      const signedBefore =
        m.previousVersion !== null && m.previousSignedAt
          ? ` · You signed version ${m.previousVersion} on ${day(m.previousSignedAt)}`
          : "";
      const changes = (m.changes ?? p.changes ?? "").trim();
      cards.push(
        card(p, {
          metaLine: `${baseMeta(p)}${signedBefore}`,
          ...(changes ? { whatChanged: changes } : {}),
        }),
      );
    }
    title = REACCEPT_TITLE;
    intro = introReaccept(cards.length);
    stillCurrent =
      still.length > 0
        ? `Still current, no need to sign again: ${still.join(" · ")}.`
        : null;
  }

  const readOnly = input.role !== "owner" || input.impersonating;
  const alert = !readOnly
    ? null
    : {
        tone: "info" as const,
        text: input.impersonating
          ? IMPERSONATING_SIGN_COPY
          : notOwnerSign(input.ownerName),
      };

  return {
    kind: readOnly ? "readonly" : "form",
    title,
    intro,
    reaccept,
    cards,
    stillCurrent,
    consent: consentView,
    alert,
    showDraft: consent.draft || cards.some((c) => c.draft),
    dateLabel,
    onBehalfOf: input.onBehalfOf,
  };
}
