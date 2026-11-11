import { InvalidInput } from "@cds/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  addonCollectionsRegistered,
  allTenantCollections,
  composeTenantCollections,
  defineTestCollection,
  getCollectionSpec,
  projectPublic,
  registerAddonCollections,
  resetAddonCollectionsForTest,
  ORGANIZATION_EXPORT_FIELDS,
  ORGANIZATION_PUBLIC_FIELDS,
  TENANT_COLLECTIONS,
  type CollectionSpec,
} from "./registry";

// TEN-01 / LIFE-03 / D187: the registry is the single declaration of tenant collections.
const SECRET_RE = /(password|token|secret|api_?key|hash|credential|otp)/i;
// Named non-secret fields that happen to match the pattern. pages.password_protected is a
// boolean flag; the hash itself (password_hash) is never listed (T-03-08).
const NOT_SECRET = new Set(["password_protected"]);
const SECRET = {
  test: (f: string) => !NOT_SECRET.has(f) && SECRET_RE.test(f),
};

describe("tenant collection registry", () => {
  const savedVitest = process.env.VITEST;
  afterEach(() => {
    process.env.VITEST = savedVitest;
  });

  it("declares the P2-P11 tenant collections in dependency-safe order", () => {
    expect(Object.keys(TENANT_COLLECTIONS)).toEqual([
      "memberships",
      "org_hosts",
      "audit_log",
      "end_users",
      "pages",
      "page_sections",
      "popups",
      "site_settings",
      "content_flags",
      "org_addons",
      "business_profile",
      "media_assets",
      "team_members",
      "services",
      "org_intake",
      "org_email_routes",
      "email_suppressions",
      "forms",
      "contacts",
      "contact_lists",
      "contact_list_members",
      "contact_notes",
      "contact_events",
      "form_submissions",
      "form_drafts",
      "agreement_signatures",
      "site_policy_acks",
      "billing_accounts",
      "gateway_accounts",
      "work_orders",
      "billing_invoices",
      "care_plan_time",
      "member_prefs",
      "alerts",
      "push_subscriptions",
      "social_accounts",
      "site_daily_stats",
      "member_invites",
      "data_exports",
      "support_threads",
      "support_messages",
      "support_files",
      "cds_notes",
      "cds_documents",
      "feature_idea_votes",
      "held_drafts",
      "failsafe_requests",
      "launch_review_marks",
    ]);
  });

  it("registers launch_review_marks as launch_review, custom, restore skip (14-09, D172)", () => {
    const spec = (TENANT_COLLECTIONS as Record<string, CollectionSpec>)
      .launch_review_marks!;
    expect(spec.kind).toBe("base");
    expect(spec.feature).toBe("launch_review");
    expect(spec.writes).toBe("custom");
    expect(spec.restore).toBe("skip");
    expect(spec.public).toBeUndefined();
    const list = spec.export === "never" ? [] : spec.export;
    expect(list).toContain("organization");
    expect(list).not.toContain("by");
    expect(list).not.toContain("note_ticket");
  });

  it("exports the sending local part and test flag, never system sending state (14-09)", () => {
    const specs = TENANT_COLLECTIONS as Record<string, CollectionSpec>;
    const bp = specs.business_profile!;
    const bpList = bp.export === "never" ? [] : bp.export;
    expect(bpList).toContain("sending_local_part");
    expect(bpList).not.toContain("sending_domain");
    expect(bpList).not.toContain("sending_status");
    const fs = specs.form_submissions!;
    expect(fs.export === "never" ? [] : fs.export).toContain("is_test");
  });

  it("registers failsafe_requests as an addons collection, custom, restore skip (13-06, P13-P31)", () => {
    const spec = (TENANT_COLLECTIONS as Record<string, CollectionSpec>)
      .failsafe_requests!;
    expect(spec.kind).toBe("base");
    expect(spec.feature).toBe("addons");
    expect(spec.writes).toBe("custom");
    expect(spec.restore).toBe("skip");
    expect(spec.public).toBeUndefined();
    const list = spec.export === "never" ? [] : spec.export;
    expect(list).toContain("organization");
    expect(list).not.toContain("handled_by");
    expect(list).not.toContain("acked_at");
    expect(list).not.toContain("capture_id");
  });

  it("exports the ticket rating but never the credited agent (13-06, P13-P18, T-13-06-03)", () => {
    const spec = (TENANT_COLLECTIONS as Record<string, CollectionSpec>)
      .support_threads!;
    const list = spec.export === "never" ? [] : spec.export;
    for (const f of ["rating", "rating_comment", "rated_at"]) {
      expect(list, f).toContain(f);
    }
    for (const f of ["rated_by", "rated_agent", "rating_followed_at"]) {
      expect(list, f).not.toContain(f);
    }
  });

  it("registers the P12 support collections as custom, restore skip (12-04, RESEARCH Pattern 1)", () => {
    const specs = TENANT_COLLECTIONS as Record<string, CollectionSpec>;
    for (const name of [
      "support_threads",
      "support_messages",
      "support_files",
      "cds_notes",
      "cds_documents",
      "feature_idea_votes",
      "held_drafts",
    ]) {
      const spec = specs[name]!;
      expect(spec.kind, name).toBe("base");
      expect(spec.feature, name).toBe("support");
      expect(spec.writes, name).toBe("custom");
      expect(spec.restore, name).toBe("skip");
      expect(spec.public, name).toBeUndefined();
    }
    expect(specs.held_drafts!.export).toBe("never");
    expect(specs.held_drafts!.ownerField).toBe("user");
    expect(specs.held_drafts!.personal).toBe(true);
  });

  it("never exports staff-only support fields or storage keys (T-12-04-04)", () => {
    const specs = TENANT_COLLECTIONS as Record<string, CollectionSpec>;
    const list = (n: string): readonly string[] => {
      const e = specs[n]!.export;
      return e === "never" ? [] : e;
    };
    expect(list("support_messages")).not.toContain("author_staff");
    expect(list("support_files")).not.toContain("object_key");
    expect(list("cds_documents")).not.toContain("object_key");
    for (const f of [
      "assignee",
      "priority",
      "opened_by_staff",
      "first_reply_due_at",
      "sla_warned_at",
      "incident",
      "last_cds_activity_at",
    ]) {
      expect(list("support_threads"), f).not.toContain(f);
    }
    expect(list("cds_notes")).not.toContain("created_by");
    expect(list("cds_documents")).not.toContain("shared_by");
    expect(list("member_prefs")).toContain("support_read");
    expect(list("work_orders")).toContain("ticket");
  });

  it("support_messages exports public rows only (rowFilter, T-12-04-01)", () => {
    const spec = (TENANT_COLLECTIONS as Record<string, CollectionSpec>)
      .support_messages!;
    expect(spec.rowFilter).toEqual({ field: "visibility", equals: "public" });
  });

  it("every rowFilter field is in its collection's export list", () => {
    for (const [name, spec] of Object.entries(allTenantCollections())) {
      if (spec.rowFilter === undefined) continue;
      const list = spec.export === "never" ? [] : spec.export;
      expect(list, name).toContain(spec.rowFilter.field);
    }
  });

  it("exports the site's own daily conversion counts, never vitals (review 11 IN-A02)", () => {
    const spec = (TENANT_COLLECTIONS as Record<string, CollectionSpec>)
      .site_daily_stats!;
    expect(spec.export).toContain("conversions");
    expect(spec.export).not.toContain("vitals");
  });

  it("registers the P10 billing collections as custom, restore skip, no provider ids (10-04, D187)", () => {
    const specs = TENANT_COLLECTIONS as Record<string, CollectionSpec>;
    const PROVIDER =
      /customer_id|subscription_id|account_id|provider_invoice_id|_url$|checkout_|card_|invoice_id|retain_until|created_by/;
    for (const name of [
      "billing_accounts",
      "gateway_accounts",
      "work_orders",
      "billing_invoices",
      "care_plan_time",
    ]) {
      const spec = specs[name]!;
      expect(spec.writes, name).toBe("custom");
      expect(spec.restore, name).toBe("skip");
      expect(spec.public, name).toBeUndefined();
      const list = spec.export === "never" ? [] : spec.export;
      expect(list, name).toContain("organization");
      expect(
        list.filter((f) => PROVIDER.test(f) || SECRET.test(f)),
        name,
      ).toEqual([]);
    }
    expect(specs.care_plan_time!.kind).toBe("append-only");
    expect(specs.gateway_accounts!.feature).toBe("connect");
  });

  it("registers the legal evidence collections as append-only, restore skip (AGR-05, D187, Pitfall 2)", () => {
    const specs = TENANT_COLLECTIONS as Record<string, CollectionSpec>;
    for (const name of ["agreement_signatures", "site_policy_acks"]) {
      const spec = specs[name]!;
      expect(spec.kind, name).toBe("append-only");
      expect(spec.feature, name).toBe("agreements");
      expect(spec.writes, name).toBe("custom");
      expect(spec.restore, name).toBe("skip");
      expect(spec.public, name).toBeUndefined();
      const list = spec.export === "never" ? [] : spec.export;
      expect(
        list.filter((f) => SECRET.test(f)),
        name,
      ).toEqual([]);
    }
    expect(specs.agreement_signatures!.export).toEqual([
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
    ]);
    expect(specs.site_policy_acks!.export).toEqual([
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
    ]);
  });

  it("forms.public is the visitor shape only: never notify_route or deleted_at (T-07-03)", () => {
    const spec = TENANT_COLLECTIONS.forms as CollectionSpec;
    expect(spec.public).toEqual([
      "id",
      "name",
      "layout",
      "fields",
      "after_submit",
      "newsletter_checkbox",
      "newsletter_wording",
    ]);
    expect(spec.public).not.toContain("notify_route");
    expect(spec.public).not.toContain("deleted_at");
  });

  it("contacts has no ownerField and the contacts family uses feature contacts (D266, Pitfall 11)", () => {
    const specs = TENANT_COLLECTIONS as Record<string, CollectionSpec>;
    expect(specs.contacts!.ownerField).toBeUndefined();
    for (const name of [
      "contacts",
      "contact_lists",
      "contact_list_members",
      "contact_notes",
      "contact_events",
    ]) {
      expect(specs[name]!.feature, name).toBe("contacts");
    }
    expect(specs.contact_events!.kind).toBe("append-only");
    expect(specs.contact_events!.restore).toBe("append-missing");
  });

  it("never names password_version or storage_dir where it must not (T-07-04)", () => {
    for (const spec of Object.values(
      TENANT_COLLECTIONS as Record<string, CollectionSpec>,
    )) {
      const lists = [
        spec.export === "never" ? [] : spec.export,
        spec.filterable ?? [],
        spec.public ?? [],
      ];
      for (const list of lists) expect(list).not.toContain("password_version");
      expect(spec.public ?? []).not.toContain("storage_dir");
    }
  });

  it("media_assets.public is the list 07-12 projects visitor media through", () => {
    const spec = TENANT_COLLECTIONS.media_assets as CollectionSpec;
    expect(spec.public).toEqual([
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
    ]);
  });

  it("never lists the email route confirm digest (Pitfall 12, D187)", () => {
    const spec = TENANT_COLLECTIONS.org_email_routes as CollectionSpec;
    const lists = [
      spec.export === "never" ? [] : spec.export,
      spec.filterable ?? [],
      spec.public ?? [],
    ];
    for (const list of lists) {
      expect(list.filter((f) => f.startsWith("confirm_h"))).toEqual([]);
    }
  });

  it("never names the page password hash in any list (T-03-08)", () => {
    for (const spec of Object.values(
      TENANT_COLLECTIONS as Record<string, CollectionSpec>,
    )) {
      const lists = [
        spec.export === "never" ? [] : spec.export,
        spec.filterable ?? [],
        spec.public ?? [],
      ];
      for (const list of lists) expect(list).not.toContain("password_hash");
    }
  });

  it("has no secret-looking public field and public is deny by default (A3-Q1)", () => {
    const specs = TENANT_COLLECTIONS as Record<string, CollectionSpec>;
    const fields: string[] = [];
    for (const spec of Object.values(specs)) {
      if (spec.public) fields.push(...spec.public);
    }
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.filter((f) => SECRET.test(f))).toEqual([]);
    for (const name of [
      "pages",
      "page_sections",
      "content_flags",
      "memberships",
      "org_hosts",
      "audit_log",
      "end_users",
    ]) {
      expect(specs[name]!.public, name).toBeUndefined();
    }
    expect(specs.site_settings!.public).toEqual([
      "banner",
      "nav",
      "footer",
      "seo",
      "settings",
      "language",
    ]);
    // Every public field is also an approved export field.
    for (const spec of Object.values(specs)) {
      if (!spec.public || spec.export === "never") continue;
      for (const f of spec.public) expect(spec.export).toContain(f);
    }
  });

  it("returns a spec for a known collection", () => {
    expect(getCollectionSpec("org_hosts").feature).toBe("settings");
  });

  it("throws InvalidInput for an unknown collection", () => {
    expect(() => getCollectionSpec("nope")).toThrow(InvalidInput);
    expect(() => getCollectionSpec("toString")).toThrow(InvalidInput);
  });

  it("never exports an auth collection", () => {
    for (const spec of Object.values(
      TENANT_COLLECTIONS as Record<string, CollectionSpec>,
    )) {
      if (spec.kind === "auth") expect(spec.export).toBe("never");
    }
  });

  it("has no secret-looking export field (D187)", () => {
    const fields: string[] = [...ORGANIZATION_EXPORT_FIELDS];
    for (const spec of Object.values(
      TENANT_COLLECTIONS as Record<string, CollectionSpec>,
    )) {
      if (spec.export !== "never") fields.push(...spec.export);
    }
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.filter((f) => SECRET.test(f))).toEqual([]);
  });

  it("organizations public fields are the design and the site name, deny by default (THEME-02)", () => {
    expect([...ORGANIZATION_PUBLIC_FIELDS]).toEqual(["design", "name"]);
    const exported: readonly string[] = ORGANIZATION_EXPORT_FIELDS;
    for (const f of ORGANIZATION_PUBLIC_FIELDS) expect(exported).toContain(f);
  });

  it("has no secret-looking or path-like filterable field (CR-02)", () => {
    const fields: string[] = [];
    for (const spec of Object.values(
      TENANT_COLLECTIONS as Record<string, CollectionSpec>,
    )) {
      if (spec.filterable) fields.push(...spec.filterable);
    }
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.filter((f) => SECRET.test(f))).toEqual([]);
    expect(fields.filter((f) => !/^[a-z_][a-z0-9_]*$/.test(f))).toEqual([]);
    expect(fields).not.toContain("tokenKey");
  });

  it("defineTestCollection throws outside vitest", () => {
    delete process.env.VITEST;
    expect(() =>
      defineTestCollection("x_widgets", {
        kind: "base",
        feature: "contacts",
        writes: "generic",
        export: ["id"],
      }),
    ).toThrow();
  });

  it("defineTestCollection registers under vitest", () => {
    defineTestCollection("unit_widgets", {
      kind: "base",
      feature: "contacts",
      writes: "generic",
      export: ["id"],
    });
    expect(getCollectionSpec("unit_widgets").feature).toBe("contacts");
  });
});

describe("composed add-on collections (ADDON-03, RESEARCH Pattern 3)", () => {
  const core = TENANT_COLLECTIONS as Record<string, CollectionSpec>;
  const widget = (slug: string, extra: Partial<CollectionSpec> = {}) =>
    ({
      kind: "base",
      feature: `addon:${slug}`,
      writes: "generic",
      restore: "replace",
      export: ["id", "organization", "title", "created", "updated"],
      ...extra,
    }) as CollectionSpec;

  afterEach(() => {
    resetAddonCollectionsForTest();
  });

  it("merges add-on collections after core", () => {
    const all = composeTenantCollections(core, {
      testimonials: { testimonials: widget("testimonials") },
    });
    expect(Object.keys(all)).toEqual([...Object.keys(core), "testimonials"]);
  });

  it("refuses an add-on collection named like a core collection", () => {
    expect(() =>
      composeTenantCollections(core, { pagesx: { pages: widget("pagesx") } }),
    ).toThrow(InvalidInput);
  });

  it("refuses the same collection from two add-ons", () => {
    expect(() =>
      composeTenantCollections(core, {
        one: { shared_things: widget("one") },
        two: { shared_things: widget("two") },
      }),
    ).toThrow(/already declared by add-on one/);
  });

  it("refuses a feature other than addon:<slug>", () => {
    expect(() =>
      composeTenantCollections(core, {
        events: { event_rows: widget("events", { feature: "content" }) },
      }),
    ).toThrow(InvalidInput);
  });

  it("refuses a secret-looking export field (D187)", () => {
    for (const field of ["api_key", "password", "reset_token", "pin_hash"]) {
      expect(() =>
        composeTenantCollections(core, {
          events: {
            event_rows: widget("events", { export: ["id", field] }),
          },
        }),
      ).toThrow(InvalidInput);
    }
  });

  it("refuses a secret-looking public or filterable field (A-WR-06)", () => {
    for (const extra of [
      { public: ["id", "api_key"] },
      { filterable: ["id", "reset_token"] },
    ]) {
      expect(() =>
        composeTenantCollections(core, {
          events: { event_rows: widget("events", extra) },
        }),
      ).toThrow(/secret-looking/);
    }
  });

  it("public must be a subset of export and never name organization (A-WR-06)", () => {
    expect(() =>
      composeTenantCollections(core, {
        events: {
          event_rows: widget("events", { public: ["id", "private_note"] }),
        },
      }),
    ).toThrow(/doesn't export: private_note/);
    expect(() =>
      composeTenantCollections(core, {
        events: {
          event_rows: widget("events", { public: ["id", "organization"] }),
        },
      }),
    ).toThrow(/organization public/);
    expect(() =>
      composeTenantCollections(core, {
        events: {
          event_rows: widget("events", { export: "never", public: ["id"] }),
        },
      }),
    ).toThrow(InvalidInput);
    expect(
      Object.keys(
        composeTenantCollections(core, {
          events: {
            event_rows: widget("events", { public: ["id", "title"] }),
          },
        }),
      ),
    ).toContain("event_rows");
  });

  it("publicWhen gates only public fields, on an exported gate (B-WR-04)", () => {
    const exp = ["id", "organization", "title", "num", "show", "created"];
    const make = (extra: Partial<CollectionSpec>) => () =>
      composeTenantCollections(core, {
        events: {
          event_rows: widget("events", {
            export: exp,
            public: ["id", "title", "num"],
            ...extra,
          }),
        },
      });
    expect(make({ publicWhen: { title2: "show" } })).toThrow(/isn't public/);
    expect(make({ publicWhen: { num: "missing" } })).toThrow(/doesn't export/);
    expect(make({ publicWhen: { num: "num" } })).toThrow(/doesn't export/);
    expect(Object.keys(make({ publicWhen: { num: "show" } })())).toContain(
      "event_rows",
    );
  });

  it("projectPublic nulls a gated field unless its gate is true (B-WR-04)", () => {
    const spec = widget("events", {
      export: ["id", "organization", "title", "num", "show", "secret_note"],
      public: ["id", "title", "num"],
      publicWhen: { num: "show" },
    });
    const row = {
      id: "r1",
      organization: "o1",
      title: "T",
      num: "123",
      secret_note: "x",
    };
    expect(projectPublic(spec, { ...row, show: false })).toEqual({
      id: "r1",
      title: "T",
      num: null,
    });
    expect(projectPublic(spec, { ...row, show: "true" }).num).toBeNull();
    expect(projectPublic(spec, row).num).toBeNull();
    expect(projectPublic(spec, { ...row, show: true })).toEqual({
      id: "r1",
      title: "T",
      num: "123",
    });
    expect(projectPublic(widget("events"), row)).toEqual({});
  });

  it("refuses an add-on auth collection (invariant 10, A-WR-06)", () => {
    expect(() =>
      composeTenantCollections(core, {
        events: { event_users: widget("events", { kind: "auth" }) },
      }),
    ).toThrow(/auth collection/);
  });

  it("registerAddonCollections is idempotent for the same input", () => {
    expect(addonCollectionsRegistered()).toBe(false);
    registerAddonCollections({ events: { event_rows: widget("events") } });
    registerAddonCollections({ events: { event_rows: widget("events") } });
    expect(addonCollectionsRegistered()).toBe(true);
    expect(Object.keys(allTenantCollections())).toContain("event_rows");
  });

  it("registerAddonCollections throws for a different second input", () => {
    registerAddonCollections({ events: { event_rows: widget("events") } });
    expect(() =>
      registerAddonCollections({ events: { other_rows: widget("events") } }),
    ).toThrow(InvalidInput);
  });

  it("getCollectionSpec resolves a registered add-on collection", () => {
    expect(() => getCollectionSpec("event_rows")).toThrow(InvalidInput);
    registerAddonCollections({ events: { event_rows: widget("events") } });
    expect(getCollectionSpec("event_rows").feature).toBe("addon:events");
  });

  it("allTenantCollections is core only before registration", () => {
    expect(Object.keys(allTenantCollections())).toEqual(Object.keys(core));
  });

  it("org_addons is custom-write under the addons feature", () => {
    const spec = getCollectionSpec("org_addons");
    expect(spec.feature).toBe("addons");
    expect(spec.writes).toBe("custom");
    expect(spec.public).toEqual(["addon", "status"]);
  });
});
