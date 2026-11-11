// Tenant collection registry (TEN-01, TEN-03, LIFE-03; D5, D187, D284).
//
// Every PB collection with an organization field MUST be declared here (TEN-01/03, LIFE-03);
// registry.integration.test.ts enforces it. The TEN-03 isolation suite iterates this object,
// so a new collection is isolation-tested the moment it is declared. `export` is the
// approved snapshot field list (deny by default, D187): auth collections are "never", and no
// password, token, hash or credential field may ever appear in a list.
import { InvalidInput, type CollectionSpec } from "@cds/core";

export type { CollectionSpec } from "@cds/core";

export const TENANT_COLLECTIONS = {
  memberships: {
    kind: "base",
    feature: "members",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "user",
      "organization",
      "role",
      "addon_grants",
      "created",
      "updated",
    ],
  },
  org_hosts: {
    kind: "base",
    feature: "settings",
    writes: "generic",
    restore: "replace",
    export: [
      "id",
      "hostname",
      "organization",
      "kind",
      "primary",
      "created",
      "updated",
    ],
  },
  audit_log: {
    kind: "append-only",
    feature: "audit_log",
    writes: "custom",
    organizationOptional: true,
    restore: "append-missing",
    export: [
      "id",
      "organization",
      "actor",
      "impersonator",
      "action",
      "target_collection",
      "target_id",
      "ip",
      "meta",
      "created",
    ],
  },
  end_users: {
    kind: "auth",
    feature: "contacts",
    writes: "generic",
    export: "never",
    // end_users has no created/updated autodate fields.
    filterable: ["id", "organization", "email", "verified"],
  },
  // CONT-30 / D254: one pages collection, draft -> publish. The page password hash is NEVER
  // listed (T-03-08), and neither is password_version (CONT-28: bumped per password change,
  // reset with password_hash on restore); writes live in the pages chokepoint module (03-06).
  // CONT-36 / D275: version_refs (ids referenced by the retained versions) is exported.
  pages: {
    kind: "base",
    feature: "content",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "slug",
      "title",
      "seo",
      "status",
      "published_at",
      "has_unpublished_changes",
      "previous_slugs",
      "kind",
      "password_protected",
      "version_refs",
      // 11-29 (D275): a page in Recently deleted exports as deleted, so a restored export
      // keeps it in the bin. deleted_by (a member id) stays out.
      "deleted_at",
      "delete_redirect_to",
      "created",
      "updated",
    ],
    filterable: [
      "id",
      "slug",
      "title",
      "status",
      "kind",
      "has_unpublished_changes",
      "published_at",
      "deleted_at",
      "created",
      "updated",
    ],
  },
  // CONT-01 / D31: page_sections, DCR field-for-field plus organization and page.
  page_sections: {
    kind: "base",
    feature: "content",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "page",
      "page_slug",
      "section_type",
      "row_layout",
      "content",
      "settings",
      "sort_order",
      "is_published",
      "legacy_id",
      "created",
      "updated",
    ],
    filterable: [
      "id",
      "page",
      "section_type",
      "sort_order",
      "is_published",
      "created",
      "updated",
    ],
  },
  // CONT-11: site pop-ups. Visitors read display fields only. CONT-36 / D275: deleted_at
  // soft-deletes a pop-up a page version still references (07-28).
  popups: {
    kind: "base",
    feature: "content",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
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
      "created",
      "updated",
    ],
    filterable: [
      "id",
      "name",
      "enabled",
      "trigger",
      "deleted_at",
      "created",
      "updated",
    ],
    public: [
      "id",
      "name",
      "content",
      "trigger",
      "delay_seconds",
      "scroll_percent",
      "frequency",
      "show_on",
      "page_ids",
    ],
  },
  // CONT-12: one site_settings row per org. CONT-29 / D198, D249: P7 adds the site chrome
  // (nav, footer, seo with allow_ai_crawlers, settings, language). All six public fields are
  // visitor chrome.
  site_settings: {
    kind: "base",
    feature: "content",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "banner",
      "nav",
      "footer",
      "seo",
      "settings",
      "language",
      "created",
      "updated",
    ],
    filterable: ["id"],
    public: ["banner", "nav", "footer", "seo", "settings", "language"],
  },
  // D248: screening flags. Append-missing on restore so staff history is never lost.
  content_flags: {
    kind: "base",
    feature: "content",
    writes: "custom",
    restore: "append-missing",
    export: [
      "id",
      "organization",
      "target_collection",
      "target_id",
      "verdict",
      "reasons",
      "status",
      "created",
      "updated",
    ],
    filterable: [
      "id",
      "target_collection",
      "target_id",
      "verdict",
      "status",
      "created",
    ],
  },
  // ADDON-05 / CONTEXT A2-Q1: one entitlement row per (org, add-on). Writes live in the
  // installer chokepoint. Visitors see slug and status only; seeded page ids are projected
  // server-side (05-05), never exposed.
  // `settings` is NOT exported (A-WR-05, D187 deny by default): it is a free-form JSON bag
  // per add-on, the natural home of gateway or API credentials, and a field list cannot
  // vet nested keys. The first add-on that stores settings adds a per-manifest approved
  // settings projection (with the secret check on nested keys) before it is exported.
  org_addons: {
    kind: "base",
    feature: "addons",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "addon",
      "status",
      "disabled_reason",
      "source",
      "installed_version",
      "seeded",
      "installed_at",
      "disabled_at",
      "created",
      "updated",
    ],
    filterable: [
      "id",
      "addon",
      "status",
      "source",
      "installed_at",
      "disabled_at",
      "created",
      "updated",
    ],
    public: ["addon", "status"],
  },
  // ONB-01, ONB-13 / D257 / CONTEXT A3-Q1: one business profile per org. Hours are core data.
  business_profile: {
    kind: "base",
    feature: "business",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
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
      "about",
      "mission",
      "headline",
      "font_pairing",
      "ga4_id",
      "legal_name",
      "privacy_contact",
      "legal_region",
      "sending_domain_verified",
      // P14 (14-09, P14-P20): the owner's sending local part. sending_domain and
      // sending_status are system state, not tenant content, so they stay out.
      "sending_local_part",
      "created",
      "updated",
    ],
    filterable: ["id"],
    // 07-30: business_type feeds the JSON-LD LocalBusiness subtype (not sensitive).
    public: [
      "tagline",
      "business_type",
      "phone",
      "public_email",
      "address",
      "service_area",
      "time_zone",
      "hours",
      "about",
      "mission",
      "headline",
    ],
  },
  // ONB-04 / CONTEXT A4-Q1 / D255, D280: image metadata; storage_dir is a path, not a secret.
  // CONT-19/20/33/36 (P7): status + public_at gate public serving; deleted_at soft-deletes;
  // poster_asset is a text media id; captions_path is a variant file name, never a key.
  // Generic reads stay feature "business" (Editors read it); P7 writers use content write
  // (RESEARCH Pitfall 10, 07-12). `public` is the list 07-12's readPublicMedia projects
  // through: never storage_dir.
  media_assets: {
    kind: "base",
    feature: "business",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "kind",
      "storage_dir",
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
      "captions_path",
      // file name shown in the library (07-12); never public
      "name",
      "created",
      "updated",
    ],
    filterable: [
      "id",
      "kind",
      "sort_order",
      "status",
      "source",
      "public_at",
      "deleted_at",
      "created",
    ],
    public: [
      "id",
      "kind",
      "mime",
      "alt",
      "width",
      "height",
      "web_width",
      "web_height",
      "status",
      "public_at",
      "poster_asset",
      "duration_s",
      "captions_path",
    ],
  },
  // ONB-13 / D257: the team is core data (the Our Team block reads it).
  team_members: {
    kind: "base",
    feature: "business",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "name",
      "role",
      "bio",
      "photo",
      "sort_order",
      "is_published",
      "created",
      "updated",
    ],
    filterable: ["id", "sort_order", "is_published"],
    public: ["name", "role", "bio", "photo", "sort_order"],
  },
  // ONB-01: services entered at intake; the Services block reads them.
  services: {
    kind: "base",
    feature: "business",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "name",
      "description",
      "price_display",
      "price_cents",
      "duration_minutes",
      "sort_order",
      "is_published",
      "created",
      "updated",
    ],
    filterable: ["id", "sort_order", "is_published"],
    public: [
      "name",
      "description",
      "price_display",
      "price_cents",
      "duration_minutes",
      "sort_order",
    ],
  },
  // ONB-01 / CONTEXT A3-Q1: the intake's working state, one row per org. Never public.
  org_intake: {
    kind: "base",
    feature: "business",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "selections",
      "addon_config",
      "answers",
      "moodboard_proposal",
      "stages_saved",
      "first_visit_dismissed_at",
      "submitted_at",
      // P8 ledger, CONTEXT A2-Q3; no intake text.
      "assembly",
      "created",
      "updated",
    ],
    filterable: ["id"],
  },
  // ONB-09 / D173: email routing per purpose. The confirm link digest is deliberately
  // absent from every list (RESEARCH Pitfall 12, D187 deny by default).
  org_email_routes: {
    kind: "base",
    feature: "business",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "purpose",
      "address",
      "sender_name",
      "confirmed_at",
      "bounced_at",
      "confirm_expires",
      "last_confirm_sent_at",
      "created",
      "updated",
    ],
    filterable: ["id", "purpose"],
  },
  // EMAIL-01 / D267, D138: suppression list. Empty organization = CDS as sender; those rows
  // are unreachable from an OrgContext (audit_log precedent). Append-only; restore never
  // drops a suppression.
  email_suppressions: {
    kind: "append-only",
    feature: "business",
    writes: "custom",
    organizationOptional: true,
    restore: "append-missing",
    export: [
      "id",
      "organization",
      "email",
      "reason",
      "scope",
      "source_type",
      "created",
    ],
    filterable: ["id", "email", "scope"],
  },
  // CONT-25 / D231, D271, CONT-36 / D275: tenant forms. Visitors read the form's shape only:
  // never notify_route (reveals the routing setup) or deleted_at.
  forms: {
    kind: "base",
    feature: "content",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
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
      "created",
      "updated",
    ],
    filterable: ["id", "name", "template", "deleted_at", "created", "updated"],
    public: [
      "id",
      "name",
      "layout",
      "fields",
      "after_submit",
      "newsletter_checkbox",
      "newsletter_wording",
    ],
  },
  // CONTACTS-02 / D236, D266: one contact per (org, email_norm). NO ownerField: visibility is
  // list membership, so a renter context gets Forbidden here (RESEARCH Pitfall 11).
  contacts: {
    kind: "base",
    feature: "contacts",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "email",
      "email_norm",
      "name",
      "phone",
      "tags",
      "first_source",
      "last_seen_at",
      "marketing_consent",
      "deleted_at",
      "created",
      "updated",
    ],
    filterable: [
      "id",
      "email_norm",
      "name",
      "first_source",
      "last_seen_at",
      "deleted_at",
      "created",
      "updated",
    ],
  },
  // CONTACTS-02 / D266: the house list and one list per renter.
  contact_lists: {
    kind: "base",
    feature: "contacts",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "name",
      "kind",
      "owner_member",
      "created",
      "updated",
    ],
    filterable: ["id", "name", "kind"],
  },
  // CONTACTS-02 / D266: list membership decides who sees a contact.
  contact_list_members: {
    kind: "base",
    feature: "contacts",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "list",
      "contact",
      "added_at",
      "created",
      "updated",
    ],
    filterable: ["id", "list", "contact", "added_at"],
  },
  // CONTACTS-02 / D266: private notes per contact, per list.
  contact_notes: {
    kind: "base",
    feature: "contacts",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "contact",
      "list",
      "body",
      "author",
      "created",
      "updated",
    ],
    filterable: ["id", "contact", "list", "created"],
  },
  // CONTACTS-02 / D236: contact history. Append-only; restore never drops history.
  contact_events: {
    kind: "append-only",
    feature: "contacts",
    writes: "custom",
    restore: "append-missing",
    export: [
      "id",
      "organization",
      "contact",
      "kind",
      "ref",
      "summary",
      "at",
      "created",
    ],
    filterable: ["id", "contact", "kind", "at"],
  },
  // CONT-25 / D231: form messages (the Inbox, 07-19). Last: it relates to forms, pages and
  // contacts, so restore upserts it after all three. Never public.
  form_submissions: {
    kind: "base",
    feature: "content",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "form",
      "form_name",
      "page",
      "data",
      "labels",
      "contact",
      "spam",
      "read_at",
      // P14 (14-09, P14-P26): review-cookie test submission.
      "is_test",
      "created",
      "updated",
    ],
    filterable: ["id", "form", "spam", "read_at", "created"],
  },
  // BILL-14, D233 (10-37): Forms Pro "save and finish later" drafts. Writes live in
  // forms/drafts.ts. Export (D187) never carries token_hash, email or the answers: a draft
  // is a 30-day convenience, not tenant data worth restoring (restore: skip). Never public.
  form_drafts: {
    kind: "base",
    feature: "content",
    writes: "custom",
    restore: "skip",
    export: ["id", "organization", "form", "expires_at", "created"],
    filterable: ["id", "form", "expires_at", "created"],
  },
  // AGR-05, D187, CONTEXT A2-Q2: signing evidence. Plain-text organization/signer ids (no
  // relations, so last is safe). Append-only (pb_hooks/legal_append_only.pb.js) and
  // restore: skip; never deleted or forged by a bundle (RESEARCH Pitfall 2). The export is
  // the tenant's own record; integrity fields are *_sha256, never secret-like (Pitfall 7).
  agreement_signatures: {
    kind: "append-only",
    feature: "agreements",
    writes: "custom",
    restore: "skip",
    export: [
      "id",
      "organization",
      "signer",
      "signer_email",
      "signer_name",
      "org_name",
      "policies",
      "consent",
      "ip",
      "user_agent",
      "auth_method",
      "signed_at",
      "order_snapshot",
      "document_key",
      "document_sha256",
      "evidence_sha256",
      "retain_until",
      "kind",
      "created",
    ],
  },
  // AGR-08, D187, CONTEXT A5-Q3: site privacy/terms acknowledgements (kind ack | review).
  // Same rules as agreement_signatures: append-only, restore: skip; never deleted or forged
  // by a bundle (RESEARCH Pitfall 2).
  site_policy_acks: {
    kind: "append-only",
    feature: "agreements",
    writes: "custom",
    restore: "skip",
    export: [
      "id",
      "organization",
      "user",
      "user_name",
      "kind",
      "template_version",
      "privacy_sha256",
      "terms_sha256",
      "clause_ids",
      "ip",
      "acked_at",
      "retain_until",
      "created",
    ],
  },
  // P10 billing (10-04, BILL-03/06/08/09/19/20, PAY-01, D187). Every entry is
  // writes: custom (the billing writers own them) and restore: skip, so a tenant restore can
  // never forge payment state (T-10-04-03). Export lists exclude every provider id, hosted
  // URL, checkout draft, card display field and retain_until (T-10-04-02).
  // CONTEXT A2: one billing record per org.
  billing_accounts: {
    kind: "base",
    feature: "billing",
    writes: "custom",
    restore: "skip",
    export: [
      "id",
      "organization",
      "status",
      "cadence",
      "build_plan",
      "installments_paid",
      "paid_at",
      "care_plan",
      "media_5gb_qty",
      "media_25gb_qty",
      "current_period_end",
      "lapsed_at",
      "price_locked_until",
      "created",
      "updated",
    ],
  },
  // PAY-01, D296, CONTEXT A1: the tenant's own payment gateway. account_id never exported.
  gateway_accounts: {
    kind: "base",
    feature: "connect",
    writes: "custom",
    restore: "skip",
    export: [
      "id",
      "organization",
      "provider",
      "charges_enabled",
      "details_submitted",
      "status",
      "checked_at",
      "created",
      "updated",
    ],
  },
  // BILL-19, BILL-09, CONTEXT A4: quoted extra work. Plain-text organization like invoices.
  work_orders: {
    kind: "base",
    feature: "billing",
    writes: "custom",
    restore: "skip",
    export: [
      "id",
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
      // P12 (12-04): the support ticket number a quote came from.
      "ticket",
      "created",
      "updated",
    ],
  },
  // CONTEXT A4, BILL-09, D214: the invoice mirror (after work_orders: it relates to it). Plain-text organization (outlives the
  // org row; RESEARCH P9 Pitfall 5); reads still filter organization = {:org}.
  billing_invoices: {
    kind: "base",
    feature: "billing",
    writes: "custom",
    restore: "skip",
    export: [
      "id",
      "organization",
      "number",
      "issued_at",
      "description",
      "kind",
      "amount_cents",
      "tax_cents",
      "refunded_cents",
      "status",
      "has_installment",
      "work_order",
      "created",
      "updated",
    ],
  },
  // BILL-20, CONTEXT A4: Care Plan time log. Append-only.
  care_plan_time: {
    kind: "append-only",
    feature: "billing",
    writes: "custom",
    restore: "skip",
    export: [
      "id",
      "organization",
      "minutes",
      "note",
      "ticket_ref",
      "logged_at",
      "created",
    ],
  },
  // P11 (11-09, D187, Pitfalls 6/15). Every entry is writes: custom (each has its own
  // module in @cds/db). member_prefs, alerts and push_subscriptions are per-person
  // (`personal`): every org context only sees its own rows, so a colleague's prefs, alerts
  // or devices are NotFound. Never exported: push endpoints and keys, invite token hashes,
  // alert bodies and source keys, download object keys.
  member_prefs: {
    kind: "base",
    feature: "content",
    writes: "custom",
    restore: "skip",
    ownerField: "user",
    personal: true,
    export: [
      "id",
      "organization",
      "user",
      "today_layout",
      "tours_seen",
      "alert_channels",
      "quiet_hours",
      "dismissed",
      "seen_flags",
      // P12 (12-04): per-thread read marks, the person's own.
      "support_read",
      "created",
      "updated",
    ],
  },
  // Alert bodies are ephemeral and may name clients: never exported or restored.
  alerts: {
    kind: "base",
    feature: "content",
    writes: "custom",
    restore: "skip",
    ownerField: "user",
    personal: true,
    export: "never",
    filterable: [
      "id",
      "organization",
      "user",
      "type",
      "level",
      "read_at",
      "created",
    ],
  },
  // Device endpoints and keys are per-device secrets: never exported or restored.
  push_subscriptions: {
    kind: "base",
    feature: "content",
    writes: "custom",
    restore: "skip",
    ownerField: "user",
    personal: true,
    export: "never",
    filterable: [
      "id",
      "organization",
      "user",
      "ua_family",
      "last_ok_at",
      "fail_count",
      "created",
    ],
  },
  social_accounts: {
    kind: "base",
    feature: "content",
    writes: "custom",
    restore: "replace",
    export: [
      "id",
      "organization",
      "platform",
      "label",
      "url",
      "short_code",
      "order",
      "created",
      "updated",
    ],
  },
  // Daily rollups are rebuilt from the beacon, so a restore skips them.
  site_daily_stats: {
    kind: "base",
    feature: "content",
    writes: "custom",
    restore: "skip",
    export: [
      "id",
      "organization",
      "day",
      "path",
      "source",
      "device",
      "views",
      "not_found",
      // Review 11 IN-A02: the site's own form-conversion counts (no visitor data). vitals
      // stays out (deny by default).
      "conversions",
      "created",
    ],
  },
  // token_hash is never exported; an invite is useless without it, so restore skips.
  member_invites: {
    kind: "base",
    feature: "members",
    writes: "custom",
    restore: "skip",
    export: [
      "id",
      "organization",
      "email",
      "role",
      "status",
      "expires_at",
      "created",
    ],
  },
  // Download my data jobs (LIFE-04): object_key never leaves the server.
  data_exports: {
    kind: "base",
    feature: "settings",
    writes: "custom",
    restore: "skip",
    export: "never",
    filterable: [
      "id",
      "organization",
      "status",
      "requested_at",
      "ready_at",
      "expires_at",
      "created",
    ],
  },
  // P12 communication hub (12-04, RESEARCH Pattern 1). Every entry is writes: custom (each
  // has its own module in @cds/db/support) and restore: skip, because a replace-restore
  // would delete internal notes and staff-only fields the bundle never carries. Never
  // exported: assignee, priority, staff ids, SLA bookkeeping, incident links, storage keys.
  support_threads: {
    kind: "base",
    feature: "support",
    writes: "custom",
    restore: "skip",
    export: [
      "id",
      "organization",
      "kind",
      "number",
      "type",
      "subject",
      "status",
      "target",
      "context",
      "opened_by",
      "opened_by_cds",
      "paid_service",
      "first_replied_at",
      "resolved_at",
      "closed_at",
      "last_activity_at",
      // P13-P18 (13-06): the owner's own rating. The credited agent, the rater id and the
      // staff follow-up mark never leave the server (T-13-06-03).
      "rating",
      "rating_comment",
      "rated_at",
      "created",
      "updated",
    ],
  },
  // Internal notes (visibility = internal) never leave the server: rowFilter (T-12-04-01).
  support_messages: {
    kind: "base",
    feature: "support",
    writes: "custom",
    restore: "skip",
    rowFilter: { field: "visibility", equals: "public" },
    export: [
      "id",
      "organization",
      "thread",
      "author_kind",
      "author_user",
      "author_name",
      "body",
      "visibility",
      "event",
      "attachments",
      "created",
    ],
  },
  // P12-P1: one row per attachment. object_key never leaves the server. Files on internal
  // staff notes never leave either (12-REVIEW CR-A02): visibility is copied from the message.
  support_files: {
    kind: "base",
    feature: "support",
    writes: "custom",
    restore: "skip",
    rowFilter: { field: "visibility", equals: "public" },
    export: [
      "id",
      "organization",
      "thread",
      "message",
      "name",
      "size",
      "mime",
      "scan",
      "author_kind",
      "visibility",
      "created",
    ],
  },
  cds_notes: {
    kind: "base",
    feature: "support",
    writes: "custom",
    restore: "skip",
    export: [
      "id",
      "organization",
      "title",
      "body",
      "pinned",
      "author_name",
      "removed_at",
      "created",
    ],
  },
  cds_documents: {
    kind: "base",
    feature: "support",
    writes: "custom",
    restore: "skip",
    export: [
      "id",
      "organization",
      "title",
      "note",
      "filename",
      "size",
      "mime",
      "author_name",
      "removed_at",
      "created",
    ],
  },
  feature_idea_votes: {
    kind: "base",
    feature: "support",
    writes: "custom",
    restore: "skip",
    export: ["id", "organization", "idea", "voted_by", "created"],
  },
  // Held drafts are transient and per-person (a locked-target edit waiting to be re-applied).
  held_drafts: {
    kind: "base",
    feature: "support",
    writes: "custom",
    restore: "skip",
    ownerField: "user",
    personal: true,
    export: "never",
    filterable: [
      "id",
      "organization",
      "user",
      "kind",
      "ref",
      "discarded_at",
      "created",
    ],
  },
  // P13 (13-06, P13-P31, D155, D291): booking requests the off-server fail-safe captured
  // during an outage, synced in by health:run. The site's own data, so it is exported; the
  // capture id, the converted booking ref and the staff handler fields are not. Org-less
  // `unmatched` rows are staff-only (CR-A01): no org, so no tenant read or export sees them.
  failsafe_requests: {
    kind: "base",
    feature: "addons",
    writes: "custom",
    organizationOptional: true,
    restore: "skip",
    export: [
      "id",
      "organization",
      "addon",
      "name",
      "email",
      "phone",
      "preferred",
      "message",
      "captured_at",
      "status",
      "converted_at",
      "dismissed_at",
      "created",
      "updated",
    ],
  },
  // P14 (14-09, DOM-10, D172): the owner's launch review marks (pages, key facts, phone
  // check, test form, submitted). Writes live in launch-review/marks.ts (14-33). Exported as
  // the site's own record; the marking member id (`by`) and the ticket number stay out
  // (T-14-09-04). A review is pre-launch state, never restored.
  launch_review_marks: {
    kind: "base",
    feature: "launch_review",
    writes: "custom",
    restore: "skip",
    export: [
      "id",
      "organization",
      "kind",
      "page",
      "status",
      "page_version",
      "at",
      "created",
      "updated",
    ],
  },
} as const satisfies Record<string, CollectionSpec>;

export type TenantCollection = keyof typeof TENANT_COLLECTIONS;

/** Approved snapshot fields of the tenant root record (D187). */
export const ORGANIZATION_EXPORT_FIELDS = [
  "id",
  "name",
  "slug",
  "status",
  "design",
  "created",
  "updated",
] as const;

/**
 * Fields an anonymous SiteContext may read from organizations (deny by default, THEME-02).
 * `name` is the site name for SEO and llms.txt (07-30/07-31); theme.ts copies only design.
 */
export const ORGANIZATION_PUBLIC_FIELDS = ["design", "name"] as const;

// Test-only extension (fixture collections such as test_widgets). Kept apart from
// TENANT_COLLECTIONS so the completeness test always sees the real registry.
const testCollections = new Map<string, CollectionSpec>();

export function defineTestCollection(name: string, spec: CollectionSpec): void {
  if (!process.env.VITEST) {
    throw new Error("defineTestCollection is test-only");
  }
  if (Object.prototype.hasOwnProperty.call(TENANT_COLLECTIONS, name)) {
    throw new Error(`${name} is already a tenant collection`);
  }
  testCollections.set(name, spec);
}

// ---------------------------------------------------------------------------------------
// Add-on collections (ADDON-03, RESEARCH Pattern 3, Pitfall 5). Every add-on's collections
// ship in the schema from day one (invariant 3); their specs are registered once at load by
// the add-on registry, and every consumer (export, field docs, isolation, completeness)
// reads the composed set through allTenantCollections().

/** Field names that may never appear in a snapshot list (D187, deny by default). */
const SECRET_FIELD_RE = /(password|token|hash|secret|key$)/i;

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Merge core and add-on collection specs. Throws InvalidInput when an add-on collection
 * collides with a core or another add-on's collection, declares a feature other than
 * `addon:<slug>`, is an auth collection (invariant 10), names a secret-looking field in its
 * export, public or filterable list, or makes public a field outside its export list or the
 * organization id (A-WR-06, D187).
 */
export function composeTenantCollections(
  core: Record<string, CollectionSpec>,
  addons: Record<string, Record<string, CollectionSpec>>,
): Record<string, CollectionSpec> {
  const out: Record<string, CollectionSpec> = { ...core };
  const owner = new Map<string, string>();
  for (const [slug, specs] of Object.entries(addons)) {
    for (const [name, spec] of Object.entries(specs)) {
      if (hasOwn(core, name)) {
        throw new InvalidInput(
          `add-on ${slug} collection ${name} collides with a core collection`,
        );
      }
      const prior = owner.get(name);
      if (prior !== undefined) {
        throw new InvalidInput(
          `add-on ${slug} collection ${name} is already declared by add-on ${prior}`,
        );
      }
      if (spec.feature !== `addon:${slug}`) {
        throw new InvalidInput(
          `add-on ${slug} collection ${name} must use feature addon:${slug}, not ${spec.feature}`,
        );
      }
      const where = `add-on ${slug} collection ${name}`;
      // Invariant 10: exactly two user populations. An add-on never adds a third.
      if (spec.kind === "auth") {
        throw new InvalidInput(`${where} can't be an auth collection`);
      }
      const lists: [string, readonly string[] | undefined][] = [
        ["exports", spec.export === "never" ? undefined : spec.export],
        ["makes public", spec.public],
        ["makes filterable", spec.filterable],
      ];
      for (const [verb, list] of lists) {
        const bad = (list ?? []).filter((f) => SECRET_FIELD_RE.test(f));
        if (bad.length > 0) {
          throw new InvalidInput(
            `${where} ${verb} secret-looking fields: ${bad.join(", ")}`,
          );
        }
      }
      // Visitors read `public` (A-WR-06): only approved export fields, never the org id.
      if (spec.public) {
        if (spec.public.includes("organization")) {
          throw new InvalidInput(`${where} can't make organization public`);
        }
        const exported: readonly string[] =
          spec.export === "never" ? [] : spec.export;
        const outside = spec.public.filter((f) => !exported.includes(f));
        if (outside.length > 0) {
          throw new InvalidInput(
            `${where} makes public fields it doesn't export: ${outside.join(", ")}`,
          );
        }
      }
      // Owner-gated public fields (B-WR-04): each gated field is public, each gate exported.
      if (spec.publicWhen !== undefined) {
        const pub: readonly string[] = spec.public ?? [];
        const exported: readonly string[] =
          spec.export === "never" ? [] : spec.export;
        for (const [field, gate] of Object.entries(spec.publicWhen)) {
          if (!pub.includes(field)) {
            throw new InvalidInput(
              `${where} gates ${field}, which isn't public`,
            );
          }
          if (
            typeof gate !== "string" ||
            gate === field ||
            !exported.includes(gate)
          ) {
            throw new InvalidInput(
              `${where} gates ${field} on a field it doesn't export`,
            );
          }
        }
      }
      // Row filter (12-04): the filtered field must be an exported field.
      if (spec.rowFilter !== undefined) {
        const exported: readonly string[] =
          spec.export === "never" ? [] : spec.export;
        if (!exported.includes(spec.rowFilter.field)) {
          throw new InvalidInput(
            `${where} filters rows on a field it doesn't export`,
          );
        }
      }
      owner.set(name, slug);
      out[name] = spec;
    }
  }
  return out;
}

let registeredInput: string | null = null;
let addonCollections: Record<string, CollectionSpec> = {};
let composed: Readonly<Record<string, CollectionSpec>> = Object.freeze({
  ...(TENANT_COLLECTIONS as Record<string, CollectionSpec>),
});

/** Stable JSON for deep-equality of registration input (keys sorted). */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

/**
 * Register every add-on's collection specs, keyed by slug. Called once at load by the
 * add-on registry. Idempotent for deep-equal input; a different second input throws.
 */
export function registerAddonCollections(
  bySlug: Record<string, Record<string, CollectionSpec>>,
): void {
  const key = stableJson(bySlug);
  if (registeredInput !== null) {
    if (registeredInput === key) return;
    throw new InvalidInput(
      "add-on collections are already registered with a different set",
    );
  }
  const all = composeTenantCollections(
    TENANT_COLLECTIONS as Record<string, CollectionSpec>,
    bySlug,
  );
  const extra: Record<string, CollectionSpec> = {};
  for (const [name, spec] of Object.entries(all)) {
    if (!hasOwn(TENANT_COLLECTIONS, name)) extra[name] = spec;
  }
  addonCollections = extra;
  composed = Object.freeze(all);
  registeredInput = key;
}

/** Core plus every registered add-on collection spec. */
export function allTenantCollections(): Readonly<
  Record<string, CollectionSpec>
> {
  return composed;
}

/** True once registerAddonCollections has run (05-04 fails export closed without it). */
export function addonCollectionsRegistered(): boolean {
  return registeredInput !== null;
}

/** Test-only: forget the registered add-on collections. */
export function resetAddonCollectionsForTest(): void {
  if (!process.env.VITEST) {
    throw new Error("resetAddonCollectionsForTest is test-only");
  }
  registeredInput = null;
  addonCollections = {};
  composed = Object.freeze({
    ...(TENANT_COLLECTIONS as Record<string, CollectionSpec>),
  });
}

export function getCollectionSpec(name: string): CollectionSpec {
  if (hasOwn(TENANT_COLLECTIONS, name)) {
    return TENANT_COLLECTIONS[name as TenantCollection];
  }
  if (hasOwn(addonCollections, name)) return addonCollections[name]!;
  const test = testCollections.get(name);
  if (test) return test;
  throw new InvalidInput(`unknown tenant collection: ${name}`);
}

/**
 * One row's visitor-readable fields (D187, B-WR-04): the spec's `public` list only, with each
 * owner-gated field (`publicWhen`) read as null unless its gate field is true on the row.
 * Every visitor read projects through here, so the owner's privacy toggle is enforced at the
 * chokepoint rather than by each renderer.
 */
export function projectPublic(
  spec: CollectionSpec,
  row: Readonly<Record<string, unknown>>,
  fields: readonly string[] = spec.public ?? [],
): Record<string, unknown> {
  const gates = spec.publicWhen ?? {};
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const gate = hasOwn(gates, f) ? gates[f] : undefined;
    out[f] = gate !== undefined && row[gate] !== true ? null : (row[f] ?? null);
  }
  return out;
}

const FIELD_NAME_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * The spec's row filter as a PocketBase filter template plus params (12-04), or null when
 * the collection has none. Callers bind it with `pb.filter(template, params)` and AND it
 * onto their org clause. The field is checked against the spec's export list and a plain
 * identifier pattern, so a malformed spec fails closed instead of building a bad filter.
 */
export function rowFilterTemplate(
  spec: CollectionSpec,
): { template: string; params: { rf: string } } | null {
  const rf = spec.rowFilter;
  if (rf === undefined) return null;
  const exported: readonly string[] =
    spec.export === "never" ? [] : spec.export;
  if (
    !FIELD_NAME_RE.test(rf.field) ||
    !exported.includes(rf.field) ||
    typeof rf.equals !== "string"
  ) {
    throw new InvalidInput("collection row filter is malformed");
  }
  return { template: `${rf.field} = {:rf}`, params: { rf: rf.equals } };
}

/** True when `row` passes the spec's row filter (always true without one). */
export function passesRowFilter(
  spec: CollectionSpec,
  row: Readonly<Record<string, unknown>>,
): boolean {
  const rf = spec.rowFilter;
  if (rf === undefined) return true;
  return row[rf.field] === rf.equals;
}
