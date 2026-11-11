// Settings › Domain view model (14-31 choice 2; 14-UI-SPEC "Settings › Domain", "DomainStatusLine",
// D-UI-P14-1, D-UI-P14-2, D-UI-P14-6, D-UI-P14-28). Pure: maps the 14-29 `OwnerDomainView` to
// what the panel renders, so the state table is unit-tested without React (the
// BillingPanel/payments-view split). One status line (tone + sentence, the domain in bold),
// the one active section, at most one primary action (D-UI-P14-6), the secondary actions, the
// collapsed history line, the expiry overlay, whether the status poller runs and the tab count.
// Admin read mode (`canAct` false) keeps links only: every button is absent. Copy with a
// UI-SPEC id comes from P14_COPY; the status sentences without an id are written here once.
import { P14_COPY, type RegistrarId } from "@cds/core/dns";
import type { OwnerDomainState, OwnerDomainView } from "@cds/db";
import type { DomainStatusTone } from "@cds/ui/hub/domain";

export type DomainSection =
  | "closed"
  | "connect"
  | "checking"
  | "findings"
  | "nameservers"
  | "waiting"
  | "connected"
  | "finishing"
  | "live"
  | "switch_back"
  | "lost";

/** Every control the Domain tab can offer (links and buttons). */
export type DomainActionId =
  | "check_domain"
  | "ive_changed"
  | "check_again"
  | "add_zone_file"
  | "different_domain"
  | "send_steps"
  | "check_now"
  | "show_nameservers"
  | "switched_back"
  | "change_main"
  | "ask_support"
  | "dns_records"
  | "set_up_email"
  | "view_site"
  | "how_to_renew";

/** Controls that are links: an Admin (read only) keeps these. */
const LINK_ACTIONS: ReadonlySet<DomainActionId> = new Set([
  "dns_records",
  "view_site",
  "how_to_renew",
]);

/** A sentence in runs; `strong` runs render bold (the domain or the preview host). */
export type SentenceRun = { text: string; strong?: true };

export type DomainExpiryOverlay = {
  tone: "warning" | "error";
  text: string;
  /** EXPIRY-7 receives focus once on load (UI-SPEC interaction states). */
  focus: boolean;
};

export type DomainViewModel = {
  state: OwnerDomainState;
  section: DomainSection;
  tone: DomainStatusTone;
  sentence: SentenceRun[];
  /** Status line link (S6 View site). */
  link: { href: string; label: string } | null;
  /** Admin read mode: DOMAIN-ADMIN-READ under the status line, no buttons. */
  readOnly: boolean;
  adminNote: string | null;
  primary: DomainActionId | null;
  secondary: DomainActionId[];
  /** "Records copied 9 Oct · Nameservers changed 10 Oct" (collapsed past steps). */
  history: string | null;
  expiry: DomainExpiryOverlay | null;
  /** The 5 s status poller runs (S1, S4 only; T-14-31-03). */
  poll: boolean;
  /** S7 / S8 / EXPIRY-7 alerts take focus once on load. */
  focusAlert: boolean;
  /** Registrar display name for the copy ("GoDaddy", "your registrar"). */
  registrar: string;
  registrarId: RegistrarId;
  /** The address visitors land on after launch (apex or www). */
  mainHost: string | null;
  /** "Domain · 1" (14-31 choice 1). */
  count: number;
};

export const DOMAIN_STATUS_COPY = Object.freeze({
  previewAddress: "Your site is on its preview address, ",
  checking: "Checking ",
  oneThing: "One thing to do before ",
  manyThings: (n: number) => `${n} things to do before `,
  canSwitch: " can switch.",
  cdsReviewing: (n: number) =>
    n === 1
      ? "Support is reviewing one record with you. Usually within 1 business day."
      : `Support is reviewing ${n} records with you. Usually within 1 business day.`,
  nameservers: "Every record is copied. Next: change your nameservers.",
  waiting: "Waiting for your nameservers to change.",
  liveAt: "Your site is live at ",
  switchBack: "Switch your nameservers back. Your email is safer there.",
  noLongerPoints: " no longer points to us.",
  viewSite: "View site",
  yourRegistrar: "your registrar",
});

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "3 Mar" (with `year`, "3 Mar 2027") in UTC; "" for an unreadable date. */
export function formatDomainDate(iso: string | null, year = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return year ? `${base} ${d.getUTCFullYear()}` : base;
}

/** Split `text` around `word` so the word renders bold (first occurrence only). */
export function boldIn(text: string, word: string | null): SentenceRun[] {
  if (!word) return [{ text }];
  const at = text.indexOf(word);
  if (at < 0) return [{ text }];
  const runs: SentenceRun[] = [];
  if (at > 0) runs.push({ text: text.slice(0, at) });
  runs.push({ text: word, strong: true });
  const rest = text.slice(at + word.length);
  if (rest) runs.push({ text: rest });
  return runs;
}

/** Plain text of a sentence (tests, aria). */
export function sentenceText(runs: readonly SentenceRun[]): string {
  return runs.map((r) => r.text).join("");
}

/**
 * "Domain · 1" (14-31 choice 1; 14-29 carry: expiry != ok counts too). WR-D04: findings
 * count only when one is the owner's (a CDS-only review is "CDS is reviewing", no step).
 */
export function domainTabCount(
  view: Pick<OwnerDomainView, "state" | "nsSlow" | "expiry" | "findings">,
): number {
  const s = view.state;
  if (s === "findings") {
    return view.findings.some((f) => f.kind !== "cds_review") ? 1 : 0;
  }
  if (s === "nameservers" || s === "switch_back" || s === "lost") {
    return 1;
  }
  if (s === "waiting" && view.nsSlow) return 1;
  if (view.expiry !== "ok" && (s === "connected" || s === "live")) return 1;
  return 0;
}

/** The poller's change fingerprint: state + what the panel shows (no values, no ids). */
export function domainMark(
  view: Pick<
    OwnerDomainView,
    "state" | "records" | "findings" | "registrar" | "nsSlow"
  >,
): string {
  return [
    view.state,
    view.records.length,
    view.findings.length,
    view.registrar?.id ?? "",
    view.nsSlow ? 1 : 0,
  ].join(":");
}

const SECTION: Readonly<Record<OwnerDomainState, DomainSection>> = {
  closed: "closed",
  none: "connect",
  checking: "checking",
  findings: "findings",
  nameservers: "nameservers",
  waiting: "waiting",
  connected: "connected",
  finishing: "finishing",
  live: "live",
  switch_back: "switch_back",
  lost: "lost",
};

function mainHostOf(view: OwnerDomainView): string | null {
  if (!view.domain) return null;
  return view.primaryChoice === "www" ? `www.${view.domain}` : view.domain;
}

export function buildDomainView(view: OwnerDomainView): DomainViewModel {
  const domain = view.domain ?? "";
  const registrar = view.registrar?.name || DOMAIN_STATUS_COPY.yourRegistrar;
  const registrarId: RegistrarId = view.registrar?.id ?? "other";
  const readOnly = !view.canAct;
  const mainHost = mainHostOf(view);
  const C = DOMAIN_STATUS_COPY;

  let tone: DomainStatusTone = "none";
  let sentence: SentenceRun[] = [];
  let link: DomainViewModel["link"] = null;
  let primary: DomainActionId | null = null;
  const secondary: DomainActionId[] = [];

  switch (view.state) {
    case "closed":
      tone = "none";
      sentence = [{ text: P14_COPY.DOM_CLOSED }];
      break;
    case "none":
      tone = "none";
      sentence = view.previewHost
        ? [
            { text: C.previewAddress },
            { text: view.previewHost, strong: true },
            { text: "." },
          ]
        : [{ text: P14_COPY.DOM_WHY_NOW }];
      primary = "check_domain";
      break;
    case "checking":
      tone = "checking";
      sentence = [
        { text: C.checking },
        { text: domain, strong: true },
        { text: "." },
      ];
      secondary.push("different_domain");
      break;
    case "findings": {
      const owner = view.findings.filter((f) => f.kind !== "cds_review");
      const cds = view.findings.filter((f) => f.kind === "cds_review");
      if (owner.length > 0) {
        tone = "your-turn";
        sentence = [
          {
            text: owner.length === 1 ? C.oneThing : C.manyThings(owner.length),
          },
          { text: domain, strong: true },
          { text: C.canSwitch },
        ];
      } else {
        tone = "cds";
        const n = cds.reduce((sum, f) => sum + Math.max(1, f.count ?? 1), 0);
        sentence = [{ text: C.cdsReviewing(Math.max(1, n)) }];
      }
      if (view.findings.some((f) => f.hardBlock && f.kind !== "cds_review")) {
        secondary.push("check_again");
      }
      if (view.findings.some((f) => f.kind === "mail_incomplete")) {
        secondary.push("add_zone_file");
      }
      if (view.findings.some((f) => f.kind === "spf")) {
        secondary.push("ask_support");
      }
      secondary.push("different_domain");
      break;
    }
    case "nameservers":
      tone = "your-turn";
      sentence = [{ text: C.nameservers }];
      primary = "ive_changed";
      secondary.push("send_steps");
      break;
    case "waiting":
      tone = "waiting";
      sentence = [{ text: C.waiting }];
      secondary.push("check_now");
      if (view.nsSlow) secondary.push("send_steps");
      secondary.push("show_nameservers");
      break;
    case "connected":
      tone = "ready";
      sentence = boldIn(P14_COPY.CONNECTED_READY({ domain }), domain);
      secondary.push("dns_records", "set_up_email");
      break;
    case "finishing":
      tone = "finishing";
      sentence = [{ text: P14_COPY.LAUNCH_FINISHING }];
      break;
    case "live":
      tone = "live";
      sentence = [
        { text: C.liveAt },
        { text: mainHost ?? domain, strong: true },
        { text: "." },
      ];
      if (mainHost) {
        link = { href: `https://${mainHost}`, label: C.viewSite };
      }
      secondary.push("change_main", "dns_records", "ask_support");
      secondary.push("set_up_email");
      break;
    case "switch_back":
      tone = "broken";
      sentence = [{ text: C.switchBack }];
      secondary.push("switched_back");
      break;
    case "lost":
      tone = "broken";
      sentence = [{ text: domain, strong: true }, { text: C.noLongerPoints }];
      secondary.push("ask_support", "send_steps");
      break;
  }

  // Expiry overlays S5 / S6 (daily health): the badge changes, the alert carries the words.
  let expiry: DomainExpiryOverlay | null = null;
  if (
    view.expiry !== "ok" &&
    (view.state === "connected" || view.state === "live")
  ) {
    const date = formatDomainDate(view.expiresAt);
    const slots = { domain, registrar, date };
    if (view.expiry === "7d") {
      tone = "broken";
      expiry = { tone: "error", text: P14_COPY.EXPIRY_7(slots), focus: true };
    } else {
      tone = "renew-soon";
      expiry = {
        tone: "warning",
        text: P14_COPY.EXPIRY_30(slots),
        focus: false,
      };
    }
    secondary.push("how_to_renew");
  }

  const keep = (a: DomainActionId) => !readOnly || LINK_ACTIONS.has(a);
  return {
    state: view.state,
    section: SECTION[view.state],
    tone,
    sentence,
    link,
    readOnly,
    adminNote:
      readOnly && view.state !== "closed" ? P14_COPY.DOM_ADMIN_READ : null,
    primary: primary && keep(primary) ? primary : null,
    secondary: secondary.filter(keep),
    history: view.history,
    expiry,
    poll: view.state === "checking" || view.state === "waiting",
    focusAlert:
      view.state === "switch_back" ||
      view.state === "lost" ||
      expiry?.focus === true,
    registrar,
    registrarId,
    mainHost,
    count: domainTabCount(view),
  };
}
