// Permission matrix as data (TEN-06, TEN-07, TEN-11, TEN-14, TEN-15; D9, D98, D285, D287).
// Pure and Edge-safe. This file is the only source of org-role permissions: the repository
// (@cds/db) calls authorize() in every method; UI only mirrors can() for display.
//
// Rules:
// - Fail closed: an unknown feature, action or role is denied.
// - Admin never touches billing (TEN-06). The owner-only set is owner-only (TEN-14, D285).
// - Add-on grants apply only to `addon:<slug>` features, read/write only, never run and never
//   core features such as content or settings (TEN-07).
// - Renter rows (contacts:read) are narrowed to the renter's own records by the repository's
//   ownerField filter; the matrix only decides whether the role may read at all.
// - Under impersonation the deny-list is checked before any role check (TEN-15, D98).

import { Forbidden, ImpersonationDenied } from "./errors";
import type { Action, OrgRole, StaffRole } from "./roles";

type RoleTable = Partial<Record<Action, readonly OrgRole[]>>;

/** Org-role permissions: feature -> action -> allowed roles (D285, TEN-14). */
export const MATRIX = {
  content: {
    read: ["owner", "admin", "editor", "viewer"],
    write: ["owner", "admin", "editor"],
  },
  settings: { read: ["owner", "admin"], write: ["owner", "admin"] },
  members: { read: ["owner", "admin"], write: ["owner", "admin"] },
  billing: { read: ["owner"], write: ["owner"] },
  exports: { run: ["owner"] },
  audit_log: { read: ["owner", "admin"] },
  // P9 (CONTEXT A3-Q3): Owner and Admin read signed agreements; signing is policy_accept.
  agreements: { read: ["owner", "admin"] },
  contacts: {
    read: ["owner", "admin", "staff", "renter"],
    write: ["owner", "admin"],
  },
  orders: { read: ["owner", "admin", "staff"], write: ["owner", "admin"] },
  refunds: { run: ["owner"] },
  campaigns: {
    read: ["owner", "admin", "editor"],
    write: ["owner", "admin"],
  },
  chatbot_caps: { read: ["owner", "admin"], write: ["owner"] },
  stock: {
    read: ["owner", "admin", "staff"],
    write: ["owner", "admin", "staff"],
  },
  purchases: { run: ["owner"] },
  legal_ack: { run: ["owner"] },
  policy_accept: { run: ["owner"] },
  launch_approval: { run: ["owner"] },
  connect: { read: ["owner", "admin"], write: ["owner"] },
  dmca_counter: { run: ["owner"] },
  // ADDON-05 / CONTEXT A2-Q4: installing an add-on is a purchase decision (owner only);
  // Admin sees what is installed.
  addons: { read: ["owner", "admin"], run: ["owner"] },
  // D311 / PD-21: business details on Settings. Owner and Admin edit, Editor sees them
  // read-only; a separate feature so `settings` is not widened to Editors.
  business: {
    read: ["owner", "admin", "editor"],
    write: ["owner", "admin"],
  },
  // CONTEXT A3-Q4: "Send to CDS" hands the intake to the build team, an owner action.
  intake_send: { run: ["owner"] },
  // P12 (D93, COMM-07): every member but grants-only roles reads Support; Viewers read only.
  support: {
    read: ["owner", "admin", "editor", "viewer"],
    write: ["owner", "admin", "editor"],
  },
  // P14 (14-03; P14-P12): Domain is read by Owner and Admin, changed by the Owner (staff may
  // act while impersonating, audited). The launch review is read by Editors too and sent by
  // the Owner; Leaving CDS is the Owner's alone. Both are deny-listed under impersonation.
  domain: { read: ["owner", "admin"], write: ["owner"] },
  launch_review: { read: ["owner", "admin", "editor"], write: ["owner"] },
  offboarding: { read: ["owner", "admin"], run: ["owner"] },
} as const satisfies Record<string, RoleTable>;

export type Feature = keyof typeof MATRIX | `addon:${string}`;

/** Who a check is about: their org role, per-add-on grants, and the staff id if impersonated. */
export type AuthSubject = {
  role: OrgRole;
  grants: readonly string[];
  impersonator?: string;
};

/** Roles that reach every installed add-on without a grant. */
const ADDON_ROLES: readonly OrgRole[] = ["owner", "admin"];
const ADDON_PREFIX = "addon:";
const ADDON_ACTIONS: readonly Action[] = ["read", "write"];

/**
 * Actions an impersonating staff member may never take, even in an owner view (TEN-15, D98):
 * sign, buy, refund, connect. A DMCA counter-notice is sworn under penalty of perjury (sign)
 * and a plan or payment-method change is a purchase (review WR-05).
 */
export const IMPERSONATION_DENY: ReadonlySet<string> = new Set([
  "legal_ack:run",
  "policy_accept:run",
  "launch_approval:run",
  "purchases:run",
  "refunds:run",
  "connect:write",
  "dmca_counter:run",
  "billing:write",
  // Install/uninstall changes what the tenant pays for (CONTEXT A2-Q4).
  "addons:run",
  // "Send to CDS" is the owner's sign-off on their intake (CONTEXT A3-Q4, TEN-15).
  "intake_send:run",
  // P12 (T-12-01-01): staff never file or reply as the tenant; they use the staff CLIs.
  "support:write",
  // P14 (14-03; P14-P12, T-14-03-01): sending the launch review and starting Leaving CDS stay
  // the owner's decisions. Domain writes stay allowed (staff help connect, audited).
  "launch_review:write",
  "offboarding:run",
]);

/**
 * Owner-only `run` actions deliberately NOT deny-listed under impersonation, with the reason.
 * A test requires every owner-only run action to be deny-listed or listed here.
 */
export const IMPERSONATION_WAIVED: Readonly<Record<string, string>> = {
  "exports:run":
    "an export signs and buys nothing; staff may export anyway (tenant_export)",
};

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** True when the subject may take `action` on `feature`. Never throws; ignores the deny-list. */
export function can(
  subject: AuthSubject,
  feature: string,
  action: Action,
): boolean {
  if (typeof feature !== "string" || typeof action !== "string") return false;

  if (feature.startsWith(ADDON_PREFIX)) {
    const slug = feature.slice(ADDON_PREFIX.length);
    if (!slug || !ADDON_ACTIONS.includes(action)) return false;
    if (ADDON_ROLES.includes(subject.role)) return true;
    return subject.grants.includes(slug);
  }

  if (!hasOwn(MATRIX, feature)) return false;
  const table: RoleTable = MATRIX[feature as keyof typeof MATRIX];
  if (!hasOwn(table, action)) return false;
  return table[action]?.includes(subject.role) ?? false;
}

/**
 * Throw unless the subject may take `action` on `feature`. The impersonation deny-list is
 * checked first, so an impersonated owner view still cannot sign, buy or refund.
 */
export function authorize(
  subject: AuthSubject,
  feature: string,
  action: Action,
): void {
  if (subject.impersonator && IMPERSONATION_DENY.has(`${feature}:${action}`)) {
    throw new ImpersonationDenied(
      `${feature}:${action} is not allowed while impersonating`,
    );
  }
  if (!can(subject, feature, action)) {
    throw new Forbidden(`${subject.role} may not ${action} ${feature}`);
  }
}

/** Staff console permissions (TEN-11). */
export const STAFF_MATRIX = {
  billing: ["super_admin"],
  staff_management: ["super_admin"],
  service_mode: ["super_admin"],
  tenant_restore: ["super_admin"],
  impersonate: ["super_admin", "support_agent"],
  tenant_export: ["super_admin", "support_agent"],
  theme_import: ["super_admin", "support_agent"],
  // Staff install/uninstall is a sale: super_admin only (CONTEXT A2-Q4, RESEARCH A3).
  addon_install: ["super_admin"],
  // P6 staff CLIs: fit:review decides a held signup (CONTEXT A1-Q5), prices:set changes
  // every visitor's quote (A2-Q2); both super_admin. leads:list is read-only (ONB-07).
  fit_review: ["super_admin"],
  prices_set: ["super_admin"],
  leads_list: ["super_admin", "support_agent"],
  // P7 media staff CLIs (07-27; CONTEXT A1-Q5). media:usage is read-only; a DMCA takedown
  // deletes tenant media (D249), so super_admin only.
  media_usage: ["super_admin", "support_agent"],
  media_takedown: ["super_admin"],
  // P8 site:assemble (CONTEXT A2-Q1): runs or re-runs assembly; never deletes, never
  // overwrites edited pages.
  site_assemble: ["super_admin", "support_agent"],
  // P9 (AGR-04): agreements:verify CLI recomputes signature hashes
  agreements_verify: ["super_admin", "support_agent"],
  // P10 staff CLIs (CONTEXT A4): work:quote creates and sends quotes; work:deliver invoices
  // the balance and installs a private add-on (super_admin, choice 3); care:log records Care
  // Plan time; org:decline refunds and closes (D214).
  work_quote: ["super_admin", "support_agent"],
  work_deliver: ["super_admin"],
  care_log: ["super_admin", "support_agent"],
  org_decline: ["super_admin"],
  // P11 (11-03): org:stage moves an org forward (D312; live is final), super_admin only. The
  // build note is the CDS line on Today while building. announce:set posts a CDS-wide
  // announcement; analytics:set records an org's GA4 / Search Console ids.
  org_stage: ["super_admin"],
  build_note: ["super_admin", "support_agent"],
  announce_set: ["super_admin"],
  analytics_set: ["super_admin", "support_agent"],
  // P12 (12-01; RESEARCH staff keys): support CLIs and CDS posts for both staff roles. An
  // org service window is support work; a platform or add-on window is super_admin (D100).
  support_read: ["super_admin", "support_agent"],
  support_reply: ["super_admin", "support_agent"],
  support_open: ["super_admin", "support_agent"],
  cds_post: ["super_admin", "support_agent"],
  incident_run: ["super_admin", "support_agent"],
  ideas_run: ["super_admin", "support_agent"],
  service_window_org: ["super_admin", "support_agent"],
  service_window_platform: ["super_admin"],
  // P13 (13-02; CONTEXT Area 1): the staff console. Both roles reach the console, canned
  // replies, catalog listings, the review queue, the suspension notice, indexing, health,
  // fail-safe requests and Reveal email (P13-P22). Suspending at once, lifting a suspension,
  // resetting the demo and changing staff roles are super_admin only (T-13-02-01).
  // Existing keys are reused, never duplicated (impersonate, prices_set, fit_review,
  // org_stage, service_window_*, media_takedown, addon_install, ...).
  console: ["super_admin", "support_agent"],
  canned_replies: ["super_admin", "support_agent"],
  catalog_listings: ["super_admin", "support_agent"],
  review_queue: ["super_admin", "support_agent"],
  suspend_notice: ["super_admin", "support_agent"],
  indexing: ["super_admin", "support_agent"],
  health: ["super_admin", "support_agent"],
  failsafe_requests: ["super_admin", "support_agent"],
  lead_reveal: ["super_admin", "support_agent"],
  suspend_now: ["super_admin"],
  suspend_lift: ["super_admin"],
  demo_reset: ["super_admin"],
  staff_roles: ["super_admin"],
  // WR-D08 (13 review): the impersonation "owner" view, one key for the console button and
  // startImpersonationSession, so the UI gate and the server gate never drift.
  impersonate_owner: ["super_admin"],
  // P14 (14-03; P14-P13, D-UI-P14-18): both roles read a site's domain, retry a step,
  // re-take the snapshot and download the zone file. Moving a domain, overriding a gate rule
  // and offboarding a site are super_admin only (step-up in the console, MFA in the CLI).
  domains: ["super_admin", "support_agent"],
  domain_move: ["super_admin"],
  domain_override: ["super_admin"],
  offboard: ["super_admin"],
} as const satisfies Record<string, readonly StaffRole[]>;

export type StaffFeature = keyof typeof STAFF_MATRIX;

/** Throw unless the staff role may use `feature`. Empty/missing role is not staff. */
export function authorizeStaff(
  staffRole: StaffRole | "" | null | undefined,
  feature: string,
): void {
  const allowed: readonly StaffRole[] | undefined = hasOwn(
    STAFF_MATRIX,
    feature,
  )
    ? STAFF_MATRIX[feature as StaffFeature]
    : undefined;
  if (!staffRole || !allowed || !allowed.includes(staffRole)) {
    throw new Forbidden(`staff role may not use ${feature}`);
  }
}
