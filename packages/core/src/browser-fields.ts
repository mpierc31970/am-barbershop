// Deny-by-default browser field allowlist (BILL-05, D42; CONTEXT A3; same shape as the D187
// export guard). Pure and Edge-safe: no imports beyond ./errors.
//
// Every live collection (core and add-on migrations) has one entry here. Each non-system
// field sits in exactly one list:
//
//   allow       fields an owner-facing (or staff) screen legitimately shows; `toBrowser`
//               keeps these and nothing else.
//   serverOnly  external provider ids (`*_id` from Stripe, Bunny, SES and similar), tokens,
//               codes, hashes, secrets, signature evidence (ip, user agent, hashes), storage
//               keys and directories, raw JSON blobs used only server-side (checkout_draft,
//               payment_fake_objects.data, ...), and every field of payment_events and
//               payment_fake_objects.
//
// Implicit: `id`, `created`, `updated`, `collectionId`, `collectionName` are always allowed.
// On auth collections `password`, `tokenKey`, `email`, `emailVisibility`, `verified` are
// server-only unless listed in `allow`.
//
// A migration that adds a field must classify it here: the db-integration test
// `browser-fields.integration.test.ts` fails on any field in neither list. `CollectionSpec.public`
// (anonymous visitor fields) is a separate, stricter concern.
import { InvalidInput } from "./errors";

export type BrowserFieldSpec = {
  allow: readonly string[];
  serverOnly: readonly string[];
};

/** Always allowed on every collection. */
export const IMPLICIT_ALLOW: readonly string[] = [
  "id",
  "created",
  "updated",
  "collectionId",
  "collectionName",
];

/** Auth-collection system fields: server-only unless the entry lists them in `allow`. */
export const AUTH_SYSTEM_FIELDS: readonly string[] = [
  "password",
  "tokenKey",
  "email",
  "emailVisibility",
  "verified",
];

export const BROWSER_FIELDS: Readonly<Record<string, BrowserFieldSpec>> = {
  // ---- P2 tenancy, auth, audit -------------------------------------------------------
  organizations: {
    allow: [
      "name",
      "slug",
      "status",
      "design",
      "path",
      "stage",
      "closed_reason",
      "closed_at",
      "closed_prev_status",
      "billing_status",
      "launched_at",
      "build_started_at",
      "build_note",
      "build_note_at",
      // P13 (13-06): the hub suspension notice reads the date.
      "suspended_at",
    ],
    // P11 analytics ids (GA4 / Search Console) are read server-side only (T-11-03-04).
    // P13 (13-06, T-13-06-02): suspension details and the demo flag are staff/system only.
    serverOnly: ["analytics", "suspension", "demo"],
  },
  users: {
    allow: ["name", "avatar", "staff_role", "pending_signup"],
    serverOnly: [],
  },
  end_users: {
    allow: ["organization"],
    serverOnly: [],
  },
  memberships: {
    allow: ["user", "organization", "role", "addon_grants"],
    serverOnly: [],
  },
  org_hosts: {
    // P14 (14-08): verified_at and redirect_to are shown with kind in Settings › Domain.
    allow: [
      "hostname",
      "organization",
      "kind",
      "primary",
      "verified_at",
      "redirect_to",
    ],
    serverOnly: [],
  },
  audit_log: {
    allow: [
      "organization",
      "actor",
      "impersonator",
      "action",
      "target_collection",
      "target_id",
    ],
    serverOnly: ["ip", "meta"],
  },
  platform_meta: {
    allow: [],
    serverOnly: ["key", "value"],
  },

  // ---- P3 content, pages, site -------------------------------------------------------
  pages: {
    allow: [
      "organization",
      "slug",
      "title",
      "seo",
      "password_protected",
      "status",
      "published_at",
      "has_unpublished_changes",
      "previous_slugs",
      "kind",
      "deleted_at",
      "delete_redirect_to",
    ],
    serverOnly: [
      "password_hash",
      "password_version",
      "version_refs",
      "deleted_by",
    ],
  },
  page_sections: {
    allow: [
      "organization",
      "page",
      "page_slug",
      "section_type",
      "row_layout",
      "content",
      "settings",
      "sort_order",
      "is_published",
    ],
    serverOnly: ["legacy_id"],
  },
  site_settings: {
    allow: [
      "organization",
      "banner",
      "nav",
      "footer",
      "seo",
      "settings",
      "language",
    ],
    serverOnly: [],
  },
  business_profile: {
    allow: [
      "organization",
      "tagline",
      "business_type",
      "business_type_other",
      "description",
      "phone",
      "public_email",
      "address",
      "service_area",
      "time_zone",
      "hours",
      // 11-35: "socials" dropped (migration 830); social links live in social_accounts.
      "about",
      "mission",
      "headline",
      "font_pairing",
      "ga4_id",
      "legal_name",
      "privacy_contact",
      "legal_region",
      "sending_domain_verified",
      "sensitive_practice",
      "grow_checklist",
      // P14 (14-09, P14-P20): the owner sets only the local part.
      "sending_local_part",
    ],
    // System-written sending state (job step `sending`, P14-P19).
    serverOnly: ["sending_domain", "sending_status"],
  },
  content_flags: {
    allow: [
      "organization",
      "target_collection",
      "target_id",
      "verdict",
      "reasons",
      "status",
      // P13 (13-06): which scanner raised it and the outage rescan count.
      "source",
      "rescan_attempts",
    ],
    serverOnly: [],
  },

  // ---- P4 media ----------------------------------------------------------------------
  media_assets: {
    allow: [
      "organization",
      "kind",
      "original_ext",
      "width",
      "height",
      "web_width",
      "web_height",
      "bytes",
      "mime",
      "alt",
      "source",
      "sort_order",
      "removed_at",
      "status",
      "public_at",
      "deleted_at",
      "poster_asset",
      "duration_s",
      "name",
    ],
    serverOnly: [
      "storage_dir",
      "captions_path",
      "video_attempts",
      "processing_started_at",
    ],
  },

  // ---- P5 add-ons --------------------------------------------------------------------
  org_addons: {
    allow: [
      "organization",
      "addon",
      "status",
      "disabled_reason",
      "source",
      "installed_version",
      "settings",
      "installed_at",
      "disabled_at",
    ],
    serverOnly: ["seeded"],
  },
  services: {
    allow: [
      "organization",
      "name",
      "description",
      "price_display",
      "price_cents",
      "duration_minutes",
      "sort_order",
      "is_published",
    ],
    serverOnly: [],
  },
  team_members: {
    allow: [
      "organization",
      "name",
      "role",
      "bio",
      "photo",
      "sort_order",
      "is_published",
    ],
    serverOnly: [],
  },
  testimonials: {
    allow: [
      "organization",
      "quote",
      "author_name",
      "author_detail",
      "rating",
      "photo_url",
      "photo_alt",
      "source",
      "featured",
      "is_published",
      "sort_order",
    ],
    serverOnly: [],
  },
  credentials: {
    allow: [
      "organization",
      "title",
      "issuer",
      "category",
      "credential_number",
      "show_number",
      "issued_on",
      "expires_on",
      "verify_url",
      "is_published",
      "sort_order",
    ],
    serverOnly: [],
  },

  // ---- P6 forms, contacts, email -----------------------------------------------------
  forms: {
    allow: [
      "organization",
      "name",
      "template",
      "layout",
      "fields",
      "after_submit",
      "notify_route",
      "newsletter_checkbox",
      "newsletter_wording",
      "pro",
      "deleted_at",
    ],
    serverOnly: [],
  },
  form_submissions: {
    allow: [
      "organization",
      "form",
      "form_name",
      "page",
      "data",
      "labels",
      "spam",
      "read_at",
      "contact",
      // P14 (14-09, P14-P26): review-cookie test submission.
      "is_test",
    ],
    serverOnly: [],
  },
  // 10-37: resume token hash, the visitor's email and their partial answers stay server-side.
  form_drafts: {
    allow: ["organization", "form", "expires_at"],
    serverOnly: ["token_hash", "email", "data"],
  },
  popups: {
    allow: [
      "organization",
      "name",
      "content",
      "trigger",
      "delay_seconds",
      "scroll_percent",
      "frequency",
      "show_on",
      "page_ids",
      "enabled",
      "deleted_at",
    ],
    serverOnly: [],
  },
  contacts: {
    allow: [
      "organization",
      "email",
      "name",
      "phone",
      "tags",
      "first_source",
      "last_seen_at",
      "marketing_consent",
      "deleted_at",
    ],
    serverOnly: ["email_norm"],
  },
  contact_events: {
    allow: ["organization", "contact", "kind", "ref", "summary", "at"],
    serverOnly: [],
  },
  contact_lists: {
    allow: ["organization", "name", "kind", "owner_member"],
    serverOnly: [],
  },
  contact_list_members: {
    allow: ["organization", "list", "contact", "added_at"],
    serverOnly: [],
  },
  contact_notes: {
    allow: ["organization", "contact", "list", "body", "author"],
    serverOnly: [],
  },
  email_suppressions: {
    allow: ["organization", "email", "reason", "scope", "source_type"],
    serverOnly: [],
  },
  org_email_routes: {
    allow: [
      "organization",
      "purpose",
      "address",
      "sender_name",
      "confirmed_at",
      "bounced_at",
    ],
    serverOnly: ["confirm_hash", "confirm_expires", "last_confirm_sent_at"],
  },

  // ---- P8 onboarding, quotes, intake -------------------------------------------------
  quotes: {
    allow: [
      "email",
      "path",
      "business_type",
      "business_type_other",
      "business_name",
      "description",
      "selections",
      "totals",
      "status",
      "fit_category",
      "reminders_sent",
      "last_reminder_at",
      "saved_at",
      "expires_at",
      "merged_org",
    ],
    serverOnly: ["token_hash"],
  },
  org_intake: {
    allow: [
      "organization",
      "selections",
      "addon_config",
      "answers",
      "moodboard_proposal",
      "stages_saved",
      "first_visit_dismissed_at",
      "submitted_at",
      "assembly",
    ],
    serverOnly: [],
  },

  // ---- P9 legal (signature evidence is server-only) ----------------------------------
  policy_versions: {
    allow: [
      "key",
      "version",
      "title",
      "summary",
      "changes",
      "body_md",
      "sha256",
      "effective_at",
      "status",
      "draft",
    ],
    serverOnly: [],
  },
  agreement_signatures: {
    allow: [
      "organization",
      "signer",
      "signer_name",
      "org_name",
      "policies",
      "signed_at",
      "retain_until",
      "kind",
    ],
    serverOnly: [
      "signer_email",
      "consent",
      "ip",
      "user_agent",
      "auth_method",
      "order_snapshot",
      "document_key",
      "document_sha256",
      "evidence_sha256",
    ],
  },
  site_policy_acks: {
    allow: [
      "organization",
      "user",
      "user_name",
      "kind",
      "template_version",
      "clause_ids",
      "acked_at",
      "retain_until",
    ],
    serverOnly: ["privacy_sha256", "terms_sha256", "ip"],
  },

  // ---- P10 billing and payments (every provider id is server-only) -------------------
  price_catalog: {
    allow: [
      "item_kind",
      "item_key",
      "path",
      "monthly_cents",
      "one_time_cents",
      "priced",
      "installments",
      "active",
      "note",
    ],
    serverOnly: [
      "stripe_product",
      "stripe_price_monthly",
      "stripe_price_yearly",
      "stripe_price_once",
    ],
  },
  billing_accounts: {
    allow: [
      "organization",
      "provider",
      "status",
      "cadence",
      "build_plan",
      "installments_paid",
      "paid_at",
      "care_plan",
      "media_5gb_qty",
      "media_25gb_qty",
      "pages_5_qty",
      "current_period_end",
      "lapsed_at",
      "price_locked_until",
      "amount_due_cents",
      "card_brand",
      "card_last4",
      "card_exp",
      "declined_at",
      "restored_at",
      "item_prices",
    ],
    serverOnly: [
      "customer_id",
      "subscription_id",
      "checkout_session_id",
      "checkout_draft",
    ],
  },
  billing_invoices: {
    allow: [
      "organization",
      "provider",
      "number",
      "issued_at",
      "description",
      "kind",
      "amount_cents",
      "tax_cents",
      "refunded_cents",
      "status",
      "has_installment",
      "hosted_url",
      "pdf_url",
      "retain_until",
      "work_order",
    ],
    serverOnly: ["provider_invoice_id"],
  },
  gateway_accounts: {
    allow: [
      "organization",
      "provider",
      "charges_enabled",
      "details_submitted",
      "display_name",
      "status",
      "checked_at",
    ],
    serverOnly: ["account_id", "alerted_status"],
  },
  work_orders: {
    allow: [
      "organization",
      "kind",
      "title",
      "scope",
      "blocks",
      "rate_cents",
      "total_cents",
      "deposit_cents",
      "balance_cents",
      "maintenance_cents",
      "addon_slug",
      "status",
      "sent_at",
      "valid_until",
      "accepted_at",
      "delivered_at",
      "paid_at",
      "declined_at",
      "accepted_by",
      "created_by",
      "retain_until",
      "ticket",
    ],
    serverOnly: ["deposit_invoice_id", "balance_invoice_id"],
  },
  care_plan_time: {
    allow: ["organization", "minutes", "note", "ticket_ref", "logged_at"],
    serverOnly: ["staff"],
  },
  payment_events: {
    allow: [],
    serverOnly: [
      "provider",
      "event_id",
      "type",
      "account",
      "org_ref",
      "received_at",
      "processed_at",
      "outcome",
      "attempts",
      "error",
      "object_ref",
      "claimed_at",
      "claim_id",
    ],
  },
  payment_fake_objects: {
    allow: [],
    serverOnly: ["object_id", "kind", "org_ref", "data"],
  },
  // ---- P11 owner dashboard -------------------------------------------------------------
  member_prefs: {
    allow: [
      "organization",
      "user",
      "today_layout",
      "tours_seen",
      "alert_channels",
      "quiet_hours",
      "dismissed",
      "seen_flags",
      "support_read",
    ],
    serverOnly: [],
  },
  alerts: {
    allow: [
      "organization",
      "user",
      "type",
      "level",
      "title",
      "safe_title",
      "href",
      "section",
      "read_at",
      "pushed_at",
      "emailed_at",
      "push_state",
    ],
    serverOnly: ["source_key"],
  },
  push_subscriptions: {
    allow: ["organization", "user", "ua_family", "last_ok_at", "fail_count"],
    serverOnly: ["endpoint", "p256dh", "auth"],
  },
  social_accounts: {
    allow: ["organization", "platform", "label", "url", "short_code", "order"],
    serverOnly: [],
  },
  site_daily_stats: {
    allow: [
      "organization",
      "day",
      "path",
      "source",
      "device",
      "views",
      "not_found",
      "conversions",
      "vitals",
    ],
    serverOnly: [],
  },
  member_invites: {
    allow: [
      "organization",
      "email",
      "role",
      "grants",
      "expires_at",
      "invited_by",
      "status",
      "accepted_by",
    ],
    serverOnly: ["token_hash"],
  },
  data_exports: {
    allow: [
      "organization",
      "requested_by",
      "status",
      "size_bytes",
      "requested_at",
      "ready_at",
      "expires_at",
      "error_kind",
    ],
    serverOnly: ["object_key"],
  },
  platform_announcements: {
    allow: ["title", "body", "href", "starts_at", "ends_at", "paths"],
    serverOnly: ["created_by"],
  },
  // ---- P12 communication hub -----------------------------------------------------------
  // Staff-only fields (assignee, priority, SLA timers, captured context, staff ids, internal
  // visibility, storage keys, idea source and hold reason) never reach the browser
  // (T-12-02-02, T-12-02-04).
  support_threads: {
    allow: [
      "organization",
      "kind",
      "number",
      "type",
      "subject",
      "status",
      "target",
      "opened_by",
      "opened_by_cds",
      "paid_service",
      "incident",
      "first_replied_at",
      "resolved_at",
      "closed_at",
      "last_activity_at",
      "last_cds_activity_at",
      // P13-P18 (13-06): the owner's rating.
      "rating",
      "rating_comment",
      "rated_at",
    ],
    serverOnly: [
      "context",
      "opened_by_staff",
      "assignee",
      "priority",
      "first_reply_due_at",
      "sla_warned_at",
      // P13-P18, P13-P32 (13-06): staff ids and the follow-up mark.
      "rated_by",
      "rated_agent",
      "rating_followed_at",
    ],
  },
  support_messages: {
    allow: [
      "organization",
      "thread",
      "author_kind",
      "author_user",
      "author_name",
      "body",
      "event",
      "attachments",
    ],
    serverOnly: ["author_staff", "visibility"],
  },
  support_files: {
    allow: [
      "organization",
      "thread",
      "message",
      "name",
      "size",
      "mime",
      "ext",
      "scan",
      "author_kind",
    ],
    // 12-REVIEW CR-A02: visibility is copied from the message, server-side only.
    serverOnly: ["object_key", "visibility"],
  },
  cds_notes: {
    allow: [
      "organization",
      "title",
      "body",
      "pinned",
      "author_name",
      "removed_at",
    ],
    serverOnly: ["created_by"],
  },
  cds_documents: {
    allow: [
      "organization",
      "title",
      "note",
      "filename",
      "size",
      "mime",
      "ext",
      "author_name",
      "removed_at",
    ],
    serverOnly: ["object_key", "shared_by"],
  },
  service_windows: {
    allow: [
      "seq",
      "scope",
      "org_id",
      "addon",
      "page",
      "component",
      "message",
      "starts_at",
      "ends_at",
      "incident",
      "alerted_at",
      "cleared_at",
    ],
    serverOnly: ["created_by"],
  },
  incidents: {
    allow: ["seq", "title", "public_text", "status", "resolved_at"],
    serverOnly: ["created_by"],
  },
  feature_ideas: {
    allow: [
      "title",
      "description",
      "status",
      "votes",
      "hidden_at",
      "merged_into",
    ],
    serverOnly: ["source_org", "source_thread", "hold_reason"],
  },
  feature_idea_votes: {
    allow: ["organization", "idea", "voted_by"],
    serverOnly: [],
  },
  held_drafts: {
    allow: [
      "organization",
      "user",
      "kind",
      "target",
      "ref",
      "payload",
      "discarded_at",
    ],
    serverOnly: [],
  },
  // ---- P13 staff console ---------------------------------------------------------------
  // Platform collections (13-03, P13-P6). Session token hashes and IPs, reporter contact and
  // the DMCA statement, and every staff id (created_by, updated_by, assignee, user,
  // last_resubmit_by) never reach the browser (T-13-03-01, P12 precedent): console screens
  // receive display names resolved on the server.
  staff_sessions: {
    allow: ["last_seen_at", "step_up_at", "ended_at"],
    serverOnly: ["token_hash", "user", "ip"],
  },
  canned_replies: {
    allow: ["title", "body", "archived_at"],
    serverOnly: ["created_by", "updated_by"],
  },
  addon_listings: {
    allow: [
      "slug",
      "tagline",
      "description",
      "screenshots",
      "availability",
      "sort",
    ],
    serverOnly: ["updated_by"],
  },
  review_cases: {
    allow: [
      "seq",
      "kind",
      "org_id",
      "target_url",
      "target_collection",
      "target_id",
      "category",
      "description",
      "status",
      "steps",
      "due_at",
      "outcome",
      "pages",
    ],
    serverOnly: [
      "reporter_name",
      "reporter_email",
      "dmca_statement",
      "assignee",
      "created_by",
    ],
  },
  org_indexing: {
    allow: [
      "org_id",
      "last_ping_at",
      "last_ping_result",
      "sitemap_status",
      "sitemap_checked_at",
      "pages_indexed",
      "last_resubmit_at",
    ],
    // P14 (14-09): sitemap submission outcome, serverOnly like the staff fields.
    serverOnly: ["last_resubmit_by", "last_submit_at", "last_submit_result"],
  },
  // Tenant collection (13-06, P13-P31): the owner sees the captured request and its contact
  // so they can call back; the staff handler and the capture ack stay server-side.
  failsafe_requests: {
    allow: [
      "organization",
      "addon",
      "capture_id",
      "name",
      "email",
      "phone",
      "preferred",
      "message",
      "captured_at",
      "status",
      "converted_at",
      "converted_ref",
      "dismissed_at",
    ],
    // CR-A01: org_slug and reason belong to staff-only unmatched rows.
    serverOnly: ["handled_by", "acked_at", "org_slug", "reason"],
  },
  // ---- P14 platform/staff tables (14-08) ---------------------------------------------
  // Owners only ever read allowlisted views built in @cds/db, never these rows: every field
  // is server-only (T-14-08-01).
  dns_zones: {
    allow: [],
    serverOnly: [
      "org_id",
      "domain",
      "provider",
      "provider_zone_id",
      "status",
      "nameservers",
      "original_nameservers",
      "registrar",
      "expires_at",
      "dnssec",
      "snapshot_key",
      "snapshot_at",
      "accepted_email_hash",
      "accepted_at",
      "delegated_at",
      "cds_keys",
      "handback",
    ],
  },
  domain_moves: {
    allow: [],
    serverOnly: [
      "seq",
      "org_id",
      "kind",
      "from_host",
      "to_host",
      "status",
      "current_step",
      "steps",
      "failed_step",
      "overrides",
      "acks",
      "primary_choice",
      "created_by",
      "cancel_reason",
      "prepared_at",
      "done_at",
      "cancelled_at",
    ],
  },
  offboardings: {
    allow: [],
    serverOnly: [
      "org_id",
      "status",
      "requested_by",
      "requested_by_kind",
      "requested_at",
      "notice_ends_at",
      "steps",
      "reason_category",
      "note",
      "cancel_reason",
      "cancelled_at",
      "closed_at",
    ],
  },
  dns_fake_state: {
    allow: [],
    serverOnly: ["domain", "data"],
  },
  // ---- P14 tenant table (14-09) -------------------------------------------------------
  // The owner's launch review marks; the marking member id stays server-side.
  launch_review_marks: {
    allow: [
      "organization",
      "kind",
      "page",
      "status",
      "page_version",
      "at",
      "note_ticket",
    ],
    serverOnly: ["by"],
  },
  // ---- P15 platform table (15-03; P15-P14, T-15-03-01) ------------------------------
  // Hub /contact inquiries: staff read them through listHubInquiries on the server; no
  // browser read path exists, so every field is server-only. No IP field (WR-B06).
  hub_inquiries: {
    allow: [],
    serverOnly: [
      "name",
      "email",
      "business",
      "topic",
      "phone",
      "about",
      "message",
    ],
  },
};

export type BrowserCollection = keyof typeof BROWSER_FIELDS;

/** Keep only the fields a client component may receive (deny by default, BILL-05). */
export function toBrowser<T extends Record<string, unknown>>(
  collection: string,
  row: T,
): Partial<T> {
  const spec = Object.hasOwn(BROWSER_FIELDS, collection)
    ? BROWSER_FIELDS[collection]
    : undefined;
  if (!spec) {
    throw new InvalidInput(`no browser field list for "${collection}"`);
  }
  const allowed = new Set([...IMPLICIT_ALLOW, ...spec.allow]);
  const out: Partial<T> = {};
  for (const key of Object.keys(row)) {
    if (allowed.has(key)) {
      (out as Record<string, unknown>)[key] = row[key];
    }
  }
  return out;
}

/** One live collection's shape, as the completeness check reads it. */
export type LiveCollection = { type?: string; fields: readonly string[] };

/**
 * Every classification problem between the live schema and the map; empty means complete.
 * Problems: a live collection with no entry, an entry for a collection that does not
 * exist, a field in neither list, a listed field that does not exist, a field in both.
 */
export function unclassifiedFields(
  liveSchema: Readonly<Record<string, LiveCollection>>,
  map: Readonly<Record<string, BrowserFieldSpec>> = BROWSER_FIELDS,
): string[] {
  const problems: string[] = [];
  const implicit = new Set(IMPLICIT_ALLOW);
  for (const [name, live] of Object.entries(liveSchema)) {
    const spec = Object.hasOwn(map, name) ? map[name] : undefined;
    if (!spec) {
      problems.push(`${name}: no BROWSER_FIELDS entry`);
      continue;
    }
    const auth = live.type === "auth" ? new Set(AUTH_SYSTEM_FIELDS) : null;
    const allow = new Set(spec.allow);
    const server = new Set(spec.serverOnly);
    const fields = new Set(live.fields);
    for (const f of live.fields) {
      if (implicit.has(f) || auth?.has(f)) continue;
      if (!allow.has(f) && !server.has(f)) {
        problems.push(`${name}.${f}: unclassified`);
      }
    }
    for (const f of [...spec.allow, ...spec.serverOnly]) {
      if (!fields.has(f)) problems.push(`${name}.${f}: listed but not live`);
      if (allow.has(f) && server.has(f)) {
        problems.push(`${name}.${f}: in both allow and serverOnly`);
      }
    }
  }
  for (const name of Object.keys(map)) {
    if (!Object.hasOwn(liveSchema, name)) {
      problems.push(`${name}: entry for a collection that does not exist`);
    }
  }
  return [...new Set(problems)].sort();
}
