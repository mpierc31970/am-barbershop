import { describe, expect, it } from "vitest";
import { ORGANIZATION_EXPORT_FIELDS, TENANT_COLLECTIONS } from "./registry";
import { SnapshotForbidden, fromSnapshotRecord, toSnapshot } from "./snapshot";
import { pickPart } from "./content/history/parts";

const PLANTED = {
  password: "P1anted!pw",
  passwordHash: "$2a$10$plantedhash",
  tokenKey: "plantedtokenkey",
  api_key: "sk_live_planted",
  smtp_password: "plantedsmtp",
  stripe_secret: "rk_planted",
};

const membership = {
  id: "mem000000000001",
  user: "usr000000000001",
  organization: "org000000000001",
  role: "owner",
  addon_grants: ["booking"],
  created: "2026-09-26 04:10:00.000Z",
  updated: "2026-09-26 04:10:00.000Z",
  collectionId: "pbc_123",
  collectionName: "memberships",
  expand: { user: { email: "x@example.com", ...PLANTED } },
  ...PLANTED,
};

describe("toSnapshot (TEN-13, D187)", () => {
  it("never emits planted secrets", () => {
    const json = JSON.stringify(toSnapshot("memberships", membership));
    for (const value of Object.values(PLANTED)) {
      expect(json).not.toContain(value);
    }
    expect(json).not.toContain("x@example.com");
  });

  it("emits exactly the export keys, in export-list order", () => {
    const snap = toSnapshot("memberships", membership);
    expect(Object.keys(snap)).toEqual([
      ...TENANT_COLLECTIONS.memberships.export,
    ]);
    expect(snap.role).toBe("owner");
    expect(snap.addon_grants).toEqual(["booking"]);
  });

  it("emits missing export fields as null", () => {
    const snap = toSnapshot("org_hosts", { id: "h1", hostname: "a.example" });
    expect(Object.keys(snap)).toEqual([...TENANT_COLLECTIONS.org_hosts.export]);
    expect(snap.primary).toBeNull();
    expect(snap.organization).toBeNull();
  });

  it("keeps falsy values that are present", () => {
    const snap = toSnapshot("org_hosts", { primary: false, hostname: "" });
    expect(snap.primary).toBe(false);
    expect(snap.hostname).toBe("");
  });

  it("organizations keeps only ORGANIZATION_EXPORT_FIELDS", () => {
    const snap = toSnapshot("organizations", {
      id: "org1",
      name: "Acme",
      slug: "acme",
      status: "active",
      design: { color: "#000" },
      created: "c",
      updated: "u",
      stripe_customer: "cus_x",
      ...PLANTED,
    });
    expect(Object.keys(snap)).toEqual([...ORGANIZATION_EXPORT_FIELDS]);
    const json = JSON.stringify(snap);
    expect(json).not.toContain("cus_x");
    for (const value of Object.values(PLANTED)) {
      expect(json).not.toContain(value);
    }
  });

  it.each(["end_users", "users", "_superusers", "_otps", "_mfas", "nope", ""])(
    "refuses %j",
    (name) => {
      expect(() => toSnapshot(name, { id: "x", ...PLANTED })).toThrow(
        SnapshotForbidden,
      );
    },
  );

  it("SnapshotForbidden carries a stable code", () => {
    try {
      toSnapshot("end_users", {});
    } catch (err) {
      expect((err as SnapshotForbidden).code).toBe("snapshot_forbidden");
    }
    expect.assertions(1);
  });

  it("output is deterministic JSON regardless of input key order", () => {
    const a = toSnapshot("org_hosts", {
      hostname: "a",
      id: "1",
      kind: "custom",
    });
    const b = toSnapshot("org_hosts", {
      kind: "custom",
      id: "1",
      hostname: "a",
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("fromSnapshotRecord keeps only approved fields that are present", () => {
    const row = fromSnapshotRecord("org_hosts", {
      id: "h1",
      hostname: "a.example",
      ...PLANTED,
    });
    expect(row).toEqual({ id: "h1", hostname: "a.example" });
    expect(() => fromSnapshotRecord("org_hosts", [1])).toThrow(
      SnapshotForbidden,
    );
    expect(() => fromSnapshotRecord("end_users", {})).toThrow(
      SnapshotForbidden,
    );
  });
});

describe("org_addons.settings never reaches a snapshot (A-WR-05, D187)", () => {
  it("drops the settings bag, nested credentials included", () => {
    const snap = toSnapshot("org_addons", {
      id: "a1",
      organization: "o1",
      addon: "booking",
      status: "active",
      settings: { apiKey: "sk_live_x", gateway: { secret: "y" } },
    });
    expect(snap).not.toHaveProperty("settings");
    expect(JSON.stringify(snap)).not.toContain("sk_live_x");
    expect(TENANT_COLLECTIONS.org_addons.export).not.toContain("settings");
  });
});

describe("site_settings snapshots carry no secrets (07-29, D187, T-07-29-04)", () => {
  it("keeps exactly the export fields and narrows to the part", () => {
    const planted = {
      password_hash: "PLANT_hash",
      token: "PLANT_token",
      api_key: "PLANT_key",
      secret: "PLANT_secret",
      smtp_password: "PLANT_smtp",
      email: "PLANT@example.com",
      expand: { organization: { name: "PLANT_org" } },
    };
    const snap = toSnapshot("site_settings", {
      id: "s1",
      organization: "o1",
      nav: { items: [] },
      footer: null,
      banner: null,
      seo: { allow_ai_crawlers: false },
      settings: { show_translate: true },
      language: "es",
      ...planted,
    });
    expect(Object.keys(snap).sort()).toEqual(
      [...TENANT_COLLECTIONS.site_settings.export].sort(),
    );
    expect(JSON.stringify(snap)).not.toContain("PLANT");
    expect(Object.keys(pickPart("settings", snap)).sort()).toEqual([
      "language",
      "seo",
      "settings",
    ]);
    expect(Object.keys(pickPart("nav", snap))).toEqual(["nav"]);
  });
});

describe("toSnapshot row filter (12-04, T-12-04-01)", () => {
  const base = {
    id: "msg000000000001",
    organization: "org000000000001",
    thread: "thr000000000001",
    author_kind: "staff",
    author_staff: "stf000000000001",
    author_name: "CDS",
    body: "INTERNAL-ONLY note",
    created: "2026-10-12 04:10:00.000Z",
  };

  it("refuses a row outside the spec's rowFilter, so an internal note is never snapshotted", () => {
    expect(() =>
      toSnapshot("support_messages", { ...base, visibility: "internal" }),
    ).toThrow(SnapshotForbidden);
    expect(() => toSnapshot("support_messages", { ...base })).toThrow(
      SnapshotForbidden,
    );
  });

  it("snapshots a public message without the staff id", () => {
    const snap = toSnapshot("support_messages", {
      ...base,
      body: "Public reply",
      visibility: "public",
    });
    expect(snap.body).toBe("Public reply");
    expect(snap).not.toHaveProperty("author_staff");
  });
});
