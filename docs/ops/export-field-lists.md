# Tenant export field lists (generated)

Generated from packages/db/src/registry.ts by `npm run docs:fields`. Do not edit by hand. Deny by default (D187, D284).

Only the fields listed here are written to a tenant export, page version or add-on backup. Any other field, including every password, token, hash, API key and credential, is never written.

## agreement_signatures

- `id`
- `organization`
- `signer`
- `signer_email`
- `signer_name`
- `org_name`
- `policies`
- `consent`
- `ip`
- `user_agent`
- `auth_method`
- `signed_at`
- `order_snapshot`
- `document_key`
- `document_sha256`
- `evidence_sha256`
- `retain_until`
- `kind`
- `created`

Restore mode: skip.

## alerts

Never exported or restored: per-person, per-device or ephemeral rows (device keys, alert bodies, download keys; D187, P11).

## audit_log

- `id`
- `organization`
- `actor`
- `impersonator`
- `action`
- `target_collection`
- `target_id`
- `ip`
- `meta`
- `created`

Restore mode: append-missing.

## billing_accounts

- `id`
- `organization`
- `status`
- `cadence`
- `build_plan`
- `installments_paid`
- `paid_at`
- `care_plan`
- `media_5gb_qty`
- `media_25gb_qty`
- `current_period_end`
- `lapsed_at`
- `price_locked_until`
- `created`
- `updated`

Restore mode: skip.

## billing_invoices

- `id`
- `organization`
- `number`
- `issued_at`
- `description`
- `kind`
- `amount_cents`
- `tax_cents`
- `refunded_cents`
- `status`
- `has_installment`
- `work_order`
- `created`
- `updated`

Restore mode: skip.

## business_profile

- `id`
- `organization`
- `tagline`
- `business_type`
- `business_type_other`
- `description`
- `phone`
- `public_email`
- `address`
- `service_area`
- `time_zone`
- `hours`
- `about`
- `mission`
- `headline`
- `font_pairing`
- `ga4_id`
- `legal_name`
- `privacy_contact`
- `legal_region`
- `sending_domain_verified`
- `sending_local_part`
- `created`
- `updated`

Restore mode: replace.
Public (visitor-readable) fields: `tagline`, `business_type`, `phone`, `public_email`, `address`, `service_area`, `time_zone`, `hours`, `about`, `mission`, `headline`.

## care_plan_time

- `id`
- `organization`
- `minutes`
- `note`
- `ticket_ref`
- `logged_at`
- `created`

Restore mode: skip.

## cds_documents

- `id`
- `organization`
- `title`
- `note`
- `filename`
- `size`
- `mime`
- `author_name`
- `removed_at`
- `created`

Restore mode: skip.

## cds_notes

- `id`
- `organization`
- `title`
- `body`
- `pinned`
- `author_name`
- `removed_at`
- `created`

Restore mode: skip.

## contact_events

- `id`
- `organization`
- `contact`
- `kind`
- `ref`
- `summary`
- `at`
- `created`

Restore mode: append-missing.

## contact_list_members

- `id`
- `organization`
- `list`
- `contact`
- `added_at`
- `created`
- `updated`

Restore mode: replace.

## contact_lists

- `id`
- `organization`
- `name`
- `kind`
- `owner_member`
- `created`
- `updated`

Restore mode: replace.

## contact_notes

- `id`
- `organization`
- `contact`
- `list`
- `body`
- `author`
- `created`
- `updated`

Restore mode: replace.

## contacts

- `id`
- `organization`
- `email`
- `email_norm`
- `name`
- `phone`
- `tags`
- `first_source`
- `last_seen_at`
- `marketing_consent`
- `deleted_at`
- `created`
- `updated`

Restore mode: replace.

## content_flags

- `id`
- `organization`
- `target_collection`
- `target_id`
- `verdict`
- `reasons`
- `status`
- `created`
- `updated`

Restore mode: append-missing.

## credentials

- `id`
- `organization`
- `title`
- `issuer`
- `category`
- `credential_number`
- `show_number`
- `issued_on`
- `expires_on`
- `verify_url`
- `is_published`
- `sort_order`
- `created`
- `updated`

Restore mode: replace.
Public (visitor-readable) fields: `id`, `title`, `issuer`, `category`, `credential_number` (only when `show_number` is on), `show_number`, `issued_on`, `expires_on`, `verify_url`, `sort_order`.

## data_exports

Never exported or restored: per-person, per-device or ephemeral rows (device keys, alert bodies, download keys; D187, P11).

## email_suppressions

- `id`
- `organization`
- `email`
- `reason`
- `scope`
- `source_type`
- `created`

Restore mode: append-missing.

## end_users

Never exported (auth collection). Logins return through the disaster-recovery path, not the export (LIFE-03, TEN-12).

## failsafe_requests

- `id`
- `organization`
- `addon`
- `name`
- `email`
- `phone`
- `preferred`
- `message`
- `captured_at`
- `status`
- `converted_at`
- `dismissed_at`
- `created`
- `updated`

Restore mode: skip.

## feature_idea_votes

- `id`
- `organization`
- `idea`
- `voted_by`
- `created`

Restore mode: skip.

## form_drafts

- `id`
- `organization`
- `form`
- `expires_at`
- `created`

Restore mode: skip.

## form_submissions

- `id`
- `organization`
- `form`
- `form_name`
- `page`
- `data`
- `labels`
- `contact`
- `spam`
- `read_at`
- `is_test`
- `created`
- `updated`

Restore mode: replace.

## forms

- `id`
- `organization`
- `name`
- `template`
- `layout`
- `fields`
- `after_submit`
- `notify_route`
- `newsletter_checkbox`
- `newsletter_wording`
- `pro`
- `deleted_at`
- `created`
- `updated`

Restore mode: replace.
Public (visitor-readable) fields: `id`, `name`, `layout`, `fields`, `after_submit`, `newsletter_checkbox`, `newsletter_wording`.

## gateway_accounts

- `id`
- `organization`
- `provider`
- `charges_enabled`
- `details_submitted`
- `status`
- `checked_at`
- `created`
- `updated`

Restore mode: skip.

## held_drafts

Never exported or restored: per-person, per-device or ephemeral rows (device keys, alert bodies, download keys; D187, P11).

## launch_review_marks

- `id`
- `organization`
- `kind`
- `page`
- `status`
- `page_version`
- `at`
- `created`
- `updated`

Restore mode: skip.

## media_assets

- `id`
- `organization`
- `kind`
- `storage_dir`
- `original_ext`
- `width`
- `height`
- `web_width`
- `web_height`
- `bytes`
- `mime`
- `alt`
- `source`
- `sort_order`
- `removed_at`
- `status`
- `public_at`
- `deleted_at`
- `poster_asset`
- `duration_s`
- `captions_path`
- `name`
- `created`
- `updated`

Restore mode: replace.
Public (visitor-readable) fields: `id`, `kind`, `mime`, `alt`, `width`, `height`, `web_width`, `web_height`, `status`, `public_at`, `poster_asset`, `duration_s`, `captions_path`.

## member_invites

- `id`
- `organization`
- `email`
- `role`
- `status`
- `expires_at`
- `created`

Restore mode: skip.

## member_prefs

- `id`
- `organization`
- `user`
- `today_layout`
- `tours_seen`
- `alert_channels`
- `quiet_hours`
- `dismissed`
- `seen_flags`
- `support_read`
- `created`
- `updated`

Restore mode: skip.
Owner field: `user`.

## memberships

- `id`
- `user`
- `organization`
- `role`
- `addon_grants`
- `created`
- `updated`

Restore mode: replace.

## org_addons

- `id`
- `organization`
- `addon`
- `status`
- `disabled_reason`
- `source`
- `installed_version`
- `seeded`
- `installed_at`
- `disabled_at`
- `created`
- `updated`

Restore mode: replace.
Public (visitor-readable) fields: `addon`, `status`.

## org_email_routes

- `id`
- `organization`
- `purpose`
- `address`
- `sender_name`
- `confirmed_at`
- `bounced_at`
- `confirm_expires`
- `last_confirm_sent_at`
- `created`
- `updated`

Restore mode: replace.

## org_hosts

- `id`
- `hostname`
- `organization`
- `kind`
- `primary`
- `created`
- `updated`

Restore mode: replace.

## org_intake

- `id`
- `organization`
- `selections`
- `addon_config`
- `answers`
- `moodboard_proposal`
- `stages_saved`
- `first_visit_dismissed_at`
- `submitted_at`
- `assembly`
- `created`
- `updated`

Restore mode: replace.

## organizations

- `id`
- `name`
- `slug`
- `status`
- `design`
- `created`
- `updated`

Restore mode: tenant root record (updated in place, never recreated).

## page_sections

- `id`
- `organization`
- `page`
- `page_slug`
- `section_type`
- `row_layout`
- `content`
- `settings`
- `sort_order`
- `is_published`
- `legacy_id`
- `created`
- `updated`

Restore mode: replace.

## pages

- `id`
- `organization`
- `slug`
- `title`
- `seo`
- `status`
- `published_at`
- `has_unpublished_changes`
- `previous_slugs`
- `kind`
- `password_protected`
- `version_refs`
- `deleted_at`
- `delete_redirect_to`
- `created`
- `updated`

Restore mode: replace.

## popups

- `id`
- `organization`
- `name`
- `content`
- `trigger`
- `delay_seconds`
- `scroll_percent`
- `frequency`
- `show_on`
- `page_ids`
- `enabled`
- `deleted_at`
- `created`
- `updated`

Restore mode: replace.
Public (visitor-readable) fields: `id`, `name`, `content`, `trigger`, `delay_seconds`, `scroll_percent`, `frequency`, `show_on`, `page_ids`.

## push_subscriptions

Never exported or restored: per-person, per-device or ephemeral rows (device keys, alert bodies, download keys; D187, P11).

## services

- `id`
- `organization`
- `name`
- `description`
- `price_display`
- `price_cents`
- `duration_minutes`
- `sort_order`
- `is_published`
- `created`
- `updated`

Restore mode: replace.
Public (visitor-readable) fields: `name`, `description`, `price_display`, `price_cents`, `duration_minutes`, `sort_order`.

## site_daily_stats

- `id`
- `organization`
- `day`
- `path`
- `source`
- `device`
- `views`
- `not_found`
- `conversions`
- `created`

Restore mode: skip.

## site_policy_acks

- `id`
- `organization`
- `user`
- `user_name`
- `kind`
- `template_version`
- `privacy_sha256`
- `terms_sha256`
- `clause_ids`
- `ip`
- `acked_at`
- `retain_until`
- `created`

Restore mode: skip.

## site_settings

- `id`
- `organization`
- `banner`
- `nav`
- `footer`
- `seo`
- `settings`
- `language`
- `created`
- `updated`

Restore mode: replace.
Public (visitor-readable) fields: `banner`, `nav`, `footer`, `seo`, `settings`, `language`.

## social_accounts

- `id`
- `organization`
- `platform`
- `label`
- `url`
- `short_code`
- `order`
- `created`
- `updated`

Restore mode: replace.

## studio_bookings

- `id`
- `organization`
- `seat`
- `reference`
- `service`
- `service_name`
- `duration_minutes`
- `price_cents`
- `starts_at`
- `ends_at`
- `client_name`
- `client_email`
- `client_phone`
- `note`
- `status`
- `reminder_sent`
- `created`
- `updated`

Restore mode: replace.

## studio_lease_payments

- `id`
- `organization`
- `seat`
- `amount_cents`
- `paid_on`
- `period_due`
- `note`
- `created`
- `updated`

Restore mode: replace.

## studio_leases

- `id`
- `organization`
- `seat`
- `rent_cents`
- `cadence`
- `next_due`
- `active`
- `overdue_alerted`
- `created`
- `updated`

Restore mode: replace.

## studio_seats

- `id`
- `organization`
- `user`
- `email`
- `name`
- `slug`
- `kind`
- `headline`
- `bio`
- `photo`
- `gallery`
- `brand_name`
- `logo`
- `socials`
- `license_number`
- `hours`
- `slot_minutes`
- `is_published`
- `sort_order`
- `created`
- `updated`

Restore mode: replace.
Owner field: `user`.

## studio_services

- `id`
- `organization`
- `seat`
- `name`
- `description`
- `duration_minutes`
- `price_cents`
- `sort_order`
- `created`
- `updated`

Restore mode: replace.

## studio_time_off

- `id`
- `organization`
- `seat`
- `start_date`
- `end_date`
- `start_time`
- `end_time`
- `note`
- `created`
- `updated`

Restore mode: replace.

## support_files

- `id`
- `organization`
- `thread`
- `message`
- `name`
- `size`
- `mime`
- `scan`
- `author_kind`
- `visibility`
- `created`

Restore mode: skip.
Rows: only those with `visibility` = `public` (others never leave the server).

## support_messages

- `id`
- `organization`
- `thread`
- `author_kind`
- `author_user`
- `author_name`
- `body`
- `visibility`
- `event`
- `attachments`
- `created`

Restore mode: skip.
Rows: only those with `visibility` = `public` (others never leave the server).

## support_threads

- `id`
- `organization`
- `kind`
- `number`
- `type`
- `subject`
- `status`
- `target`
- `context`
- `opened_by`
- `opened_by_cds`
- `paid_service`
- `first_replied_at`
- `resolved_at`
- `closed_at`
- `last_activity_at`
- `rating`
- `rating_comment`
- `rated_at`
- `created`
- `updated`

Restore mode: skip.

## team_members

- `id`
- `organization`
- `name`
- `role`
- `bio`
- `photo`
- `sort_order`
- `is_published`
- `created`
- `updated`

Restore mode: replace.
Public (visitor-readable) fields: `name`, `role`, `bio`, `photo`, `sort_order`.

## testimonials

- `id`
- `organization`
- `quote`
- `author_name`
- `author_detail`
- `rating`
- `photo_url`
- `photo_alt`
- `source`
- `featured`
- `is_published`
- `sort_order`
- `created`
- `updated`

Restore mode: replace.
Public (visitor-readable) fields: `id`, `quote`, `author_name`, `author_detail`, `rating`, `photo_url`, `photo_alt`, `featured`, `sort_order`.

## work_orders

- `id`
- `organization`
- `kind`
- `title`
- `scope`
- `blocks`
- `rate_cents`
- `total_cents`
- `deposit_cents`
- `balance_cents`
- `maintenance_cents`
- `addon_slug`
- `status`
- `sent_at`
- `valid_until`
- `accepted_at`
- `delivered_at`
- `paid_at`
- `declined_at`
- `accepted_by`
- `ticket`
- `created`
- `updated`

Restore mode: skip.
