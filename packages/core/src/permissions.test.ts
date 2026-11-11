import { describe, expect, it } from "vitest";
import {
  AgreementRequired,
  CdsError,
  Forbidden,
  ImpersonationDenied,
  InvalidContext,
  InvalidInput,
  LastOwner,
  MfaRequired,
  NotFound,
  RateLimited,
  RestoreRejected,
  TargetLocked,
} from "./errors";
import {
  IMPERSONATION_DENY,
  IMPERSONATION_WAIVED,
  MATRIX,
  STAFF_MATRIX,
  authorize,
  authorizeStaff,
  can,
  type AuthSubject,
} from "./permissions";
import { ORG_ROLES, STAFF_ROLES, type Action, type OrgRole } from "./roles";

const subject = (role: OrgRole, grants: string[] = []): AuthSubject => ({
  role,
  grants,
});

// The expected matrix, written out independently of MATRIX (D285, TEN-14).
const O: OrgRole[] = ["owner"];
const OA: OrgRole[] = ["owner", "admin"];
const EXPECTED: Record<string, Partial<Record<Action, OrgRole[]>>> = {
  content: {
    read: ["owner", "admin", "editor", "viewer"],
    write: ["owner", "admin", "editor"],
  },
  settings: { read: OA, write: OA },
  members: { read: OA, write: OA },
  billing: { read: O, write: O },
  exports: { run: O },
  audit_log: { read: OA },
  agreements: { read: OA },
  contacts: { read: ["owner", "admin", "staff", "renter"], write: OA },
  orders: { read: ["owner", "admin", "staff"], write: OA },
  refunds: { run: O },
  campaigns: { read: ["owner", "admin", "editor"], write: OA },
  chatbot_caps: { read: OA, write: O },
  stock: {
    read: ["owner", "admin", "staff"],
    write: ["owner", "admin", "staff"],
  },
  purchases: { run: O },
  legal_ack: { run: O },
  policy_accept: { run: O },
  launch_approval: { run: O },
  connect: { read: OA, write: O },
  dmca_counter: { run: O },
  addons: { read: OA, run: O },
  business: { read: ["owner", "admin", "editor"], write: OA },
  intake_send: { run: O },
  support: {
    read: ["owner", "admin", "editor", "viewer"],
    write: ["owner", "admin", "editor"],
  },
  domain: { read: OA, write: O },
  launch_review: { read: ["owner", "admin", "editor"], write: O },
  offboarding: { read: OA, run: O },
};
const ACTIONS: Action[] = ["read", "write", "run"];

const rows: [OrgRole, string, Action, boolean][] = [];
for (const [feature, actions] of Object.entries(EXPECTED)) {
  for (const action of ACTIONS) {
    for (const role of ORG_ROLES) {
      rows.push([
        role,
        feature,
        action,
        (actions[action] ?? []).includes(role),
      ]);
    }
  }
}

describe("MATRIX (TEN-14, D285)", () => {
  it("has exactly the expected features", () => {
    expect(Object.keys(MATRIX).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(rows)("%s on %s:%s -> %s", (role, feature, action, expected) => {
    expect(can(subject(role), feature, action)).toBe(expected);
  });

  it.each(["read", "write"] as const)(
    "admin is denied billing:%s (TEN-06)",
    (action) => {
      expect(can(subject("admin"), "billing", action)).toBe(false);
      expect(() => authorize(subject("admin"), "billing", action)).toThrow(
        Forbidden,
      );
    },
  );

  // The owner-only set: every action that mutates or commits is owner-only.
  const ownerOnly: [string, Action][] = [
    ["purchases", "run"],
    ["refunds", "run"],
    ["exports", "run"],
    ["legal_ack", "run"],
    ["launch_approval", "run"],
    ["connect", "write"],
    ["dmca_counter", "run"],
  ];
  it.each(ownerOnly)("%s:%s is owner-only (TEN-14)", (feature, action) => {
    for (const role of ORG_ROLES) {
      expect(can(subject(role), feature, action)).toBe(role === "owner");
    }
  });
});

describe("add-on grants (TEN-07)", () => {
  it("staff with an events grant reaches addon:events only", () => {
    const s = subject("staff", ["events"]);
    expect(can(s, "addon:events", "read")).toBe(true);
    expect(can(s, "addon:events", "write")).toBe(true);
    expect(can(s, "content", "read")).toBe(false);
    expect(can(s, "settings", "read")).toBe(false);
  });

  it("viewer with an events grant can write events but not content or settings", () => {
    const s = subject("viewer", ["events"]);
    expect(can(s, "addon:events", "write")).toBe(true);
    expect(can(s, "content", "write")).toBe(false);
    expect(can(s, "settings", "read")).toBe(false);
  });

  it("a grant never unlocks a core feature named like the slug", () => {
    expect(can(subject("viewer", ["settings"]), "settings", "write")).toBe(
      false,
    );
    expect(can(subject("viewer", ["billing"]), "billing", "read")).toBe(false);
  });

  it("a grant is per add-on", () => {
    expect(can(subject("staff", ["events"]), "addon:store", "read")).toBe(
      false,
    );
  });

  it("a grant never allows run", () => {
    expect(can(subject("staff", ["events"]), "addon:events", "run")).toBe(
      false,
    );
  });

  it.each(ORG_ROLES.map((r) => [r, r === "owner" || r === "admin"] as const))(
    "%s without a grant on addon:events -> %s",
    (role, expected) => {
      expect(can(subject(role), "addon:events", "read")).toBe(expected);
      expect(can(subject(role), "addon:events", "write")).toBe(expected);
    },
  );

  it("rejects an empty add-on slug", () => {
    expect(can(subject("owner", [""]), "addon:", "read")).toBe(false);
  });
});

describe("fail closed", () => {
  it("denies an unknown feature", () => {
    expect(can(subject("owner"), "nope", "read")).toBe(false);
    expect(() => authorize(subject("owner"), "nope", "read")).toThrow(
      Forbidden,
    );
  });

  it("denies an undefined or unknown action", () => {
    const bad = undefined as unknown as Action;
    expect(can(subject("owner"), "content", bad)).toBe(false);
    expect(() => authorize(subject("owner"), "content", bad)).toThrow(
      Forbidden,
    );
    expect(can(subject("owner"), "content", "delete" as Action)).toBe(false);
  });

  it("denies inherited object keys", () => {
    expect(can(subject("owner"), "toString", "read")).toBe(false);
    expect(can(subject("owner"), "__proto__", "read")).toBe(false);
  });

  it("denies an unknown role", () => {
    expect(can(subject("root" as OrgRole), "content", "read")).toBe(false);
  });
});

describe("impersonation deny-list (TEN-15)", () => {
  const owner: AuthSubject = { role: "owner", grants: [], impersonator: "s1" };
  const denied: [string, Action][] = [
    ["legal_ack", "run"],
    ["policy_accept", "run"],
    ["launch_approval", "run"],
    ["purchases", "run"],
    ["refunds", "run"],
    ["connect", "write"],
    ["dmca_counter", "run"],
    ["billing", "write"],
    ["addons", "run"],
    ["intake_send", "run"],
    ["support", "write"],
    ["launch_review", "write"],
    ["offboarding", "run"],
  ];

  it("lists exactly the thirteen actions", () => {
    expect([...IMPERSONATION_DENY].sort()).toEqual(
      denied.map(([f, a]) => `${f}:${a}`).sort(),
    );
  });

  it.each(denied)(
    "%s:%s throws ImpersonationDenied for an owner view",
    (feature, action) => {
      expect(() => authorize(owner, feature, action)).toThrow(
        ImpersonationDenied,
      );
      // Without impersonation the owner passes.
      expect(() =>
        authorize({ role: "owner", grants: [] }, feature, action),
      ).not.toThrow();
    },
  );

  it("deny-lists or explicitly waives every owner-only run action (WR-05)", () => {
    const ownerOnlyRuns = Object.entries(MATRIX)
      .filter(([, table]) => {
        const run = (table as Partial<Record<Action, readonly OrgRole[]>>).run;
        return run !== undefined && run.length === 1 && run[0] === "owner";
      })
      .map(([f]) => `${f}:run`);
    expect(ownerOnlyRuns.length).toBeGreaterThan(0);
    for (const key of ownerOnlyRuns) {
      expect(
        IMPERSONATION_DENY.has(key) || key in IMPERSONATION_WAIVED,
        key,
      ).toBe(true);
    }
    for (const key of Object.keys(IMPERSONATION_WAIVED)) {
      expect(IMPERSONATION_DENY.has(key), key).toBe(false);
    }
  });

  it("checks the deny-list before the role check", () => {
    const viewer: AuthSubject = {
      role: "viewer",
      grants: [],
      impersonator: "s1",
    };
    expect(() => authorize(viewer, "purchases", "run")).toThrow(
      ImpersonationDenied,
    );
  });

  it("lets an impersonated owner write content", () => {
    expect(() => authorize(owner, "content", "write")).not.toThrow();
  });
});

describe("authorizeStaff (TEN-11)", () => {
  it("has exactly the expected staff features", () => {
    expect(Object.keys(STAFF_MATRIX).sort()).toEqual(
      [
        "billing",
        "impersonate",
        "service_mode",
        "staff_management",
        "tenant_export",
        "tenant_restore",
        "theme_import",
        "addon_install",
        "fit_review",
        "prices_set",
        "leads_list",
        "media_usage",
        "media_takedown",
        "site_assemble",
        "agreements_verify",
        "work_quote",
        "work_deliver",
        "care_log",
        "org_decline",
        "org_stage",
        "build_note",
        "announce_set",
        "analytics_set",
        "support_read",
        "support_reply",
        "support_open",
        "cds_post",
        "incident_run",
        "ideas_run",
        "service_window_org",
        "service_window_platform",
        "console",
        "canned_replies",
        "catalog_listings",
        "review_queue",
        "suspend_notice",
        "indexing",
        "health",
        "failsafe_requests",
        "lead_reveal",
        "suspend_now",
        "suspend_lift",
        "demo_reset",
        "staff_roles",
        "impersonate_owner",
        "domains",
        "domain_move",
        "domain_override",
        "offboard",
      ].sort(),
    );
  });

  const all = Object.keys(STAFF_MATRIX);
  const supportAllowed = [
    "impersonate",
    "tenant_export",
    "theme_import",
    "leads_list",
    "media_usage",
    "site_assemble",
    "agreements_verify",
    "work_quote",
    "care_log",
    "build_note",
    "analytics_set",
    "support_read",
    "support_reply",
    "support_open",
    "cds_post",
    "incident_run",
    "ideas_run",
    "service_window_org",
    "console",
    "canned_replies",
    "catalog_listings",
    "review_queue",
    "suspend_notice",
    "indexing",
    "health",
    "failsafe_requests",
    "lead_reveal",
    "domains",
  ];

  it.each(all)("super_admin passes %s", (feature) => {
    expect(() => authorizeStaff("super_admin", feature)).not.toThrow();
  });

  it.each(all)("support_agent on %s", (feature) => {
    if (supportAllowed.includes(feature)) {
      expect(() => authorizeStaff("support_agent", feature)).not.toThrow();
    } else {
      expect(() => authorizeStaff("support_agent", feature)).toThrow(Forbidden);
    }
  });

  it.each(all)("empty and null staff roles are denied %s", (feature) => {
    expect(() => authorizeStaff("", feature)).toThrow(Forbidden);
    expect(() => authorizeStaff(null, feature)).toThrow(Forbidden);
    expect(() => authorizeStaff(undefined, feature)).toThrow(Forbidden);
  });

  it("theme_import is CDS staff only (THEME-03, A1-Q3)", () => {
    expect(() => authorizeStaff("super_admin", "theme_import")).not.toThrow();
    expect(() => authorizeStaff("support_agent", "theme_import")).not.toThrow();
    expect(() => authorizeStaff("", "theme_import")).toThrow(Forbidden);
    expect(() => authorizeStaff(null, "theme_import")).toThrow(Forbidden);
  });

  it("addon_install is super_admin only (CONTEXT A2-Q4)", () => {
    expect(() => authorizeStaff("super_admin", "addon_install")).not.toThrow();
    expect(() => authorizeStaff("support_agent", "addon_install")).toThrow(
      Forbidden,
    );
  });

  it("denies an unknown staff feature", () => {
    expect(() => authorizeStaff("super_admin", "nope")).toThrow(Forbidden);
    expect(() => authorizeStaff("super_admin", "toString")).toThrow(Forbidden);
  });

  it("STAFF_ROLES lists both roles", () => {
    expect([...STAFF_ROLES]).toEqual(["super_admin", "support_agent"]);
  });
});

describe("errors", () => {
  it.each([
    [NotFound, "not_found"],
    [Forbidden, "forbidden"],
    [ImpersonationDenied, "impersonation_denied"],
    [LastOwner, "last_owner"],
    [InvalidContext, "invalid_context"],
    [InvalidInput, "invalid_input"],
    [RestoreRejected, "restore_rejected"],
    [MfaRequired, "mfa_required"],
    [RateLimited, "rate_limited"],
    [AgreementRequired, "agreement_required"],
    [TargetLocked, "target_locked"],
  ] as const)("%o has code %s", (Cls, code) => {
    const e = new Cls("msg");
    expect(e).toBeInstanceOf(CdsError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe(code);
    expect(e.name).toBe(Cls.name);
    expect(e.message).toBe("msg");
  });
});

describe("addons feature (ADDON-05, CONTEXT A2-Q4)", () => {
  it("owner may run and read addons", () => {
    expect(() => authorize(subject("owner"), "addons", "run")).not.toThrow();
    expect(() => authorize(subject("owner"), "addons", "read")).not.toThrow();
  });

  it("admin may read but not run addons", () => {
    expect(() => authorize(subject("admin"), "addons", "read")).not.toThrow();
    expect(() => authorize(subject("admin"), "addons", "run")).toThrow(
      Forbidden,
    );
  });

  it("editor may not read addons", () => {
    expect(() => authorize(subject("editor"), "addons", "read")).toThrow(
      Forbidden,
    );
  });

  it("an impersonated owner is denied addons:run", () => {
    expect(() =>
      authorize(
        { role: "owner", grants: [], impersonator: "s1" },
        "addons",
        "run",
      ),
    ).toThrow(ImpersonationDenied);
  });
});

describe("P6 features (D311, CONTEXT A3-Q4, A1-Q5, A2-Q2, ONB-07)", () => {
  it("business: editor reads, owner/admin write, viewer denied", () => {
    expect(can(subject("editor"), "business", "read")).toBe(true);
    expect(can(subject("editor"), "business", "write")).toBe(false);
    expect(can(subject("admin"), "business", "write")).toBe(true);
    expect(can(subject("owner"), "business", "write")).toBe(true);
    expect(can(subject("viewer"), "business", "read")).toBe(false);
  });

  it("intake_send: owner only, denied under impersonation", () => {
    expect(can(subject("owner"), "intake_send", "run")).toBe(true);
    expect(can(subject("admin"), "intake_send", "run")).toBe(false);
    expect(() =>
      authorize(
        { role: "owner", grants: [], impersonator: "s1" },
        "intake_send",
        "run",
      ),
    ).toThrow(ImpersonationDenied);
  });

  it("staff: leads_list for support, fit_review and prices_set super_admin only", () => {
    expect(() => authorizeStaff("support_agent", "leads_list")).not.toThrow();
    expect(() => authorizeStaff("support_agent", "fit_review")).toThrow(
      Forbidden,
    );
    expect(() => authorizeStaff("support_agent", "prices_set")).toThrow(
      Forbidden,
    );
    for (const f of ["fit_review", "prices_set", "leads_list"]) {
      expect(() => authorizeStaff("super_admin", f)).not.toThrow();
    }
  });

  it("staff: media_usage for support, media_takedown super_admin only (T-07-07)", () => {
    expect(() => authorizeStaff("support_agent", "media_usage")).not.toThrow();
    expect(() => authorizeStaff("support_agent", "media_takedown")).toThrow(
      Forbidden,
    );
    for (const f of ["media_usage", "media_takedown"]) {
      expect(() => authorizeStaff("super_admin", f)).not.toThrow();
    }
  });

  it("staff: site_assemble for super_admin and support_agent only (CONTEXT A2-Q1)", () => {
    expect(STAFF_MATRIX.site_assemble).toEqual([
      "super_admin",
      "support_agent",
    ]);
    expect(() => authorizeStaff("super_admin", "site_assemble")).not.toThrow();
    expect(() =>
      authorizeStaff("support_agent", "site_assemble"),
    ).not.toThrow();
    for (const r of ["", null, undefined] as const) {
      expect(() => authorizeStaff(r, "site_assemble")).toThrow(Forbidden);
    }
  });
});

describe("P9 agreements (AGR-02, AGR-04, CONTEXT A2-Q1/A2-Q4/A2-Q5, D287)", () => {
  it("agreements:read is owner and admin only", () => {
    expect(can(subject("owner"), "agreements", "read")).toBe(true);
    expect(can(subject("admin"), "agreements", "read")).toBe(true);
    expect(can(subject("editor"), "agreements", "read")).toBe(false);
    expect(can(subject("viewer"), "agreements", "read")).toBe(false);
    expect(can(subject("owner"), "agreements", "write")).toBe(false);
  });

  it("policy_accept:run is owner-only and impersonation-denied", () => {
    const impersonated: AuthSubject = {
      role: "owner",
      grants: [],
      impersonator: "s1",
    };
    expect(() => authorize(impersonated, "policy_accept", "run")).toThrow(
      ImpersonationDenied,
    );
    expect(() => authorize(subject("admin"), "policy_accept", "run")).toThrow(
      Forbidden,
    );
    expect(() =>
      authorize(subject("owner"), "policy_accept", "run"),
    ).not.toThrow();
    expect(IMPERSONATION_DENY.has("legal_ack:run")).toBe(true);
  });

  it("staff: agreements_verify for super_admin and support_agent only", () => {
    expect(STAFF_MATRIX.agreements_verify).toEqual([
      "super_admin",
      "support_agent",
    ]);
    expect(() =>
      authorizeStaff("super_admin", "agreements_verify"),
    ).not.toThrow();
    expect(() =>
      authorizeStaff("support_agent", "agreements_verify"),
    ).not.toThrow();
    for (const r of ["", null, undefined] as const) {
      expect(() => authorizeStaff(r, "agreements_verify")).toThrow(Forbidden);
    }
  });

  it("AgreementRequired carries the ERR-GATE default message", () => {
    const e = new AgreementRequired();
    expect(e).toBeInstanceOf(CdsError);
    expect(e.code).toBe("agreement_required");
    expect(e.message).toBe("Sign your agreement before you buy anything.");
  });
});

describe("P10 billing (CONTEXT A4, choice 3; TEN-14, TEN-15)", () => {
  it("staff: work_quote and care_log for super_admin and support_agent", () => {
    for (const f of ["work_quote", "care_log"]) {
      expect(() => authorizeStaff("super_admin", f)).not.toThrow();
      expect(() => authorizeStaff("support_agent", f)).not.toThrow();
      for (const r of ["", null, undefined] as const) {
        expect(() => authorizeStaff(r, f)).toThrow(Forbidden);
      }
    }
  });

  it("staff: work_deliver and org_decline are super_admin only", () => {
    for (const f of [
      "work_deliver",
      "org_decline",
      "org_stage",
      "announce_set",
    ]) {
      expect(() => authorizeStaff("super_admin", f)).not.toThrow();
      expect(() => authorizeStaff("support_agent", f)).toThrow(Forbidden);
    }
  });

  it("purchases:run is owner-only", () => {
    expect(can(subject("owner"), "purchases", "run")).toBe(true);
    expect(can(subject("admin"), "purchases", "run")).toBe(false);
  });

  it("an impersonated owner may not buy, connect or change billing", () => {
    const impersonated: AuthSubject = {
      role: "owner",
      grants: [],
      impersonator: "s1",
    };
    for (const [feature, action] of [
      ["purchases", "run"],
      ["connect", "write"],
      ["billing", "write"],
    ] as const) {
      expect(() => authorize(impersonated, feature, action)).toThrow(
        ImpersonationDenied,
      );
      expect(() => authorize(subject("owner"), feature, action)).not.toThrow();
    }
  });
});

describe("P12 support (D93, D100, COMM-07, P12-P11)", () => {
  it("viewer reads support but may not write; editor writes", () => {
    expect(can(subject("viewer"), "support", "read")).toBe(true);
    expect(can(subject("viewer"), "support", "write")).toBe(false);
    expect(can(subject("editor"), "support", "write")).toBe(true);
  });

  it("grants-only roles get no support access (P12-P11)", () => {
    for (const role of ["staff", "renter"] as const) {
      expect(can(subject(role), "support", "read")).toBe(false);
      expect(can(subject(role), "support", "write")).toBe(false);
    }
  });

  it("an impersonated owner may read but not write support (T-12-01-01)", () => {
    const impersonated: AuthSubject = {
      role: "owner",
      grants: [],
      impersonator: "s1",
    };
    expect(() => authorize(impersonated, "support", "read")).not.toThrow();
    expect(() => authorize(impersonated, "support", "write")).toThrow(
      ImpersonationDenied,
    );
  });

  it("service_window_platform is super_admin only (D100, T-12-01-02)", () => {
    expect(() =>
      authorizeStaff("support_agent", "service_window_platform"),
    ).toThrow(Forbidden);
    expect(() =>
      authorizeStaff("super_admin", "service_window_platform"),
    ).not.toThrow();
  });

  it("TargetLocked defaults to the LOCKED-BODY copy", () => {
    const e = new TargetLocked();
    expect(e.code).toBe("target_locked");
    expect(e.message).toBe(
      "You can look around, but changes are paused so nothing clashes with CDS's fix.",
    );
  });
});

describe("P13 staff console keys (13-02; CONTEXT Area 1, T-13-02-01)", () => {
  it("suspend_now is super_admin only", () => {
    expect(STAFF_MATRIX.suspend_now).toEqual(["super_admin"]);
    expect(() => authorizeStaff("super_admin", "suspend_now")).not.toThrow();
    expect(() => authorizeStaff("support_agent", "suspend_now")).toThrow(
      Forbidden,
    );
  });

  it("support_agent may use console and send a suspension notice", () => {
    expect(() =>
      authorizeStaff("support_agent", "suspend_notice"),
    ).not.toThrow();
    expect(() => authorizeStaff("support_agent", "console")).not.toThrow();
  });

  it("demo_reset, staff_roles and suspend_lift are super_admin only", () => {
    for (const f of ["demo_reset", "staff_roles", "suspend_lift"]) {
      expect(() => authorizeStaff("support_agent", f)).toThrow(Forbidden);
      expect(() => authorizeStaff("super_admin", f)).not.toThrow();
    }
  });
});

describe("P14 domains, launch review and leaving (14-03; P14-P12, P14-P13)", () => {
  const impersonated: AuthSubject = {
    role: "owner",
    grants: [],
    impersonator: "s1",
  };

  it("domain: owner writes, admin reads only, editor nothing", () => {
    expect(can(subject("owner"), "domain", "write")).toBe(true);
    expect(can(subject("admin"), "domain", "write")).toBe(false);
    expect(can(subject("admin"), "domain", "read")).toBe(true);
    expect(can(subject("editor"), "domain", "read")).toBe(false);
  });

  it("launch_review: editor reads, only the owner sends", () => {
    expect(can(subject("editor"), "launch_review", "read")).toBe(true);
    expect(can(subject("admin"), "launch_review", "write")).toBe(false);
    expect(can(subject("owner"), "launch_review", "write")).toBe(true);
  });

  it("offboarding: owner runs, admin reads only", () => {
    expect(can(subject("owner"), "offboarding", "run")).toBe(true);
    expect(can(subject("admin"), "offboarding", "run")).toBe(false);
    expect(can(subject("admin"), "offboarding", "read")).toBe(true);
  });

  it("an impersonated owner may change the domain but not send the review or leave (T-14-03-01)", () => {
    expect(() => authorize(impersonated, "domain", "write")).not.toThrow();
    expect(() => authorize(impersonated, "launch_review", "write")).toThrow(
      ImpersonationDenied,
    );
    expect(() => authorize(impersonated, "offboarding", "run")).toThrow(
      ImpersonationDenied,
    );
    expect(() =>
      authorize(impersonated, "launch_review", "read"),
    ).not.toThrow();
  });

  it("staff: domains for both roles; domain_move, domain_override, offboard super_admin only", () => {
    expect(() => authorizeStaff("support_agent", "domains")).not.toThrow();
    for (const f of ["domain_move", "domain_override", "offboard"]) {
      expect(() => authorizeStaff("support_agent", f)).toThrow(Forbidden);
      expect(() => authorizeStaff("super_admin", f)).not.toThrow();
    }
  });
});
