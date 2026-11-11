// Pure view helpers for Settings › Legal, section 1 "Your agreements" (09-20; AGR-06, AGR-07;
// CONTEXT A3-Q3; D82, D216 "dashboard shows version and date signed", D311; 09-UI-SPEC
// "Settings › Legal"; D-UI-P9-17, D-UI-P9-19).
//
// Dates use the org's business-profile time zone when set and valid, else UTC (09-20 choice
// 3, the same helper as the signed confirmation, 09-18).
import type {
  AgreementDocument,
  AgreementStatus,
  HubDocument,
  SitePolicyState,
} from "@cds/db";
import type { AgreementHistoryRow } from "@cds/ui/hub/legal";
import { MEMBER_OUTDATED_COPY, signedOnDate } from "./agreement-setup";
import { dateParts, validZone } from "./signed-confirmation";

/** Where the Owner signs (09-17). */
export const AGREEMENT_HREF = "/hub/agreement";
/** The strip and empty-state action label. */
export const REVIEW_AND_SIGN = "Review and sign";
/** Accessible name of the action (the visible label alone is ambiguous out of context). */
export const REVIEW_AND_SIGN_LABEL = "Review and sign your agreement";
export const EMPTY_AGR_H = "No signed agreements yet";
export const EMPTY_AGR_B =
  "You sign your agreement once, before checkout. It will be listed here with a copy you can download.";
export const UNSIGNED_COPY = "Not signed yet. You sign once, before checkout.";
export const OUTDATED_OWNER_COPY = "Updated terms are waiting for you.";

/** The signings in a documents list (10-12: listDocuments also returns invoices). */
export function agreementsOnly(
  docs: readonly HubDocument[],
): AgreementDocument[] {
  return docs.filter((d): d is AgreementDocument => d.kind === "agreement");
}

/** One row per signing, in the order given (listDocuments is newest first). */
export function agreementRows(
  docs: readonly AgreementDocument[],
  timeZone: string | null,
): AgreementHistoryRow[] {
  const tz = validZone(timeZone);
  return docs.map((d) => {
    const { date, time } = dateParts(d.signedAt, tz);
    return {
      id: d.id,
      dateLabel: date,
      timeLabel: time,
      signerName: d.signerName,
      signerEmail: d.signerEmail,
      items: d.versions.map((v) => `${v.title} · version ${v.version}`),
      typeLabel:
        d.signingKind === "reaccept" ? "Updated terms" : "First signing",
      downloadHref: d.downloadUrl,
      downloadAriaLabel: `Download the agreement signed ${date}`,
    };
  });
}

export type AgreementStrip = {
  tone: "success" | "warning" | "info";
  text: string;
  action: { label: string; href: string } | null;
};

/**
 * The status strip at the top of "Your agreements". Only the Owner, signed in as themselves,
 * gets **Review and sign**; Admins (and staff impersonating) read the status alone.
 */
export function agreementStrip(
  status: AgreementStatus,
  role: string,
  impersonating: boolean,
  timeZone: string | null = null,
): AgreementStrip {
  const canSign = role === "owner" && !impersonating;
  const action = canSign
    ? { label: REVIEW_AND_SIGN, href: AGREEMENT_HREF }
    : null;
  if (status.state === "current") {
    const on = signedOnDate(status.lastSignedAt, timeZone);
    return {
      tone: "success",
      text: on
        ? `Your agreement is up to date. Last signed ${on}.`
        : "Your agreement is up to date.",
      action: null,
    };
  }
  if (status.state === "outdated") {
    return role === "owner"
      ? { tone: "warning", text: OUTDATED_OWNER_COPY, action }
      : { tone: "info", text: MEMBER_OUTDATED_COPY, action: null };
  }
  return { tone: "info", text: UNSIGNED_COPY, action };
}

/** "Legal · 1" when the terms are outdated or a site policy update waits; else 0. */
export function legalTabCount(
  status: AgreementStatus | null,
  siteState: {
    templateUpdateWaiting: boolean;
    addedSinceReview: readonly unknown[];
  } | null,
): number {
  if (status?.state === "outdated") return 1;
  if (
    siteState &&
    (siteState.templateUpdateWaiting || siteState.addedSinceReview.length > 0)
  ) {
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------- section 2 (09-23)
// "Your site's policy pages" (AGR-08; D217, D287; CONTEXT A5-Q3, A5-Q4; 09-UI-SPEC section 2
// and Copywriting).

export const SITE_POLICY_WARN_TITLE = "CDS is not a law firm";
export const SITE_POLICY_WARN =
  "CDS gives no legal advice. These pages are a starting point written from what your site collects. Have your own lawyer approve them before you rely on them.";
export const SITE_POLICY_MISSING =
  "Add your legal business name and a privacy contact email first, in Setup › Domain & the rest. Your policy pages use them.";
export const SITE_POLICY_TEMPLATE_UPDATE =
  "CDS updated the policy page template. Your site keeps showing the version you approved until you review and publish the update.";
export const SITE_POLICY_NOT_OWNER =
  "Only the site owner can publish these pages.";
export const SITE_POLICY_IMPERSONATING =
  "You're viewing as CDS staff, so publishing is turned off. Only the owner can publish these pages.";
/** Where legal_name and privacy_contact are edited (setup step "Domain & the rest"). */
export const LEGAL_INPUTS_HREF = "/hub/setup/the-rest";

export type SitePolicyPageId = "privacy" | "terms";

export type SitePolicyRow = {
  page: SitePolicyPageId;
  label: string;
  badge: { tone: "draft" | "published" | "update-waiting"; text: string };
  covers: string | null;
};

/** The two pages with their status badge; only Privacy lists what it covers. */
export function sitePolicyRows(state: SitePolicyState): SitePolicyRow[] {
  const badge: SitePolicyRow["badge"] = !state.published
    ? { tone: "draft", text: "Not published" }
    : state.templateUpdateWaiting
      ? { tone: "update-waiting", text: "Update waiting" }
      : { tone: "published", text: "Published" };
  return [
    {
      page: "privacy",
      label: "Privacy policy",
      badge,
      covers:
        state.coveredLabels.length > 0
          ? `Covers: ${state.coveredLabels.join(" · ")}`
          : null,
    },
    { page: "terms", label: "Terms", badge: { ...badge }, covers: null },
  ];
}

export type SitePolicyNotice = {
  key: string;
  tone: "warning" | "info";
  title: string | null;
  text: string;
  link: { label: string; href: string } | null;
};

/**
 * The section's alerts, in UI-SPEC order: WARN-LEGAL always first (never dismissible),
 * then ADDON-CHANGED per add-on (published only), MISSING-LEGAL-INPUTS, TEMPLATE-UPDATE
 * (owner). `ackedLine` is ACKED-LINE when published and nothing waits.
 */
export function sitePolicyNotices(
  state: SitePolicyState,
  role: string,
  impersonating: boolean,
  timeZone: string | null = null,
): { alerts: SitePolicyNotice[]; ackedLine: string | null } {
  void impersonating; // Notices read the same for staff; the action block differs.
  const alerts: SitePolicyNotice[] = [
    {
      key: "warn-legal",
      tone: "warning",
      title: SITE_POLICY_WARN_TITLE,
      text: SITE_POLICY_WARN,
      link: null,
    },
  ];
  if (state.published) {
    for (const a of state.addedSinceReview) {
      alerts.push({
        key: `addon-changed:${a.slug}`,
        tone: "info",
        title: null,
        text: `Your privacy policy changed because you added ${a.label}. Review it.`,
        link: null,
      });
    }
  }
  if (state.missingInputs.length > 0) {
    alerts.push({
      key: "missing-inputs",
      tone: "info",
      title: null,
      text: SITE_POLICY_MISSING,
      link: { label: "Add your legal details", href: LEGAL_INPUTS_HREF },
    });
  }
  if (role === "owner" && state.templateUpdateWaiting) {
    alerts.push({
      key: "template-update",
      tone: "warning",
      title: null,
      text: SITE_POLICY_TEMPLATE_UPDATE,
      link: null,
    });
  }
  let ackedLine: string | null = null;
  if (state.published && state.ack && !state.templateUpdateWaiting) {
    const on = signedOnDate(state.ack.ackedAt, timeZone);
    const who = state.ack.userName || "the site owner";
    ackedLine = `Published by ${who} on ${on ?? ""} (template version ${state.ack.templateVersion}).`;
  }
  return { alerts, ackedLine };
}
