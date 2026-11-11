// Export fails closed until add-on collections are registered (ADDON-05, T-05-16; RESEARCH
// Pattern 3). Both entry points throw before touching PocketBase or the object store.
import { beforeEach, describe, expect, it } from "vitest";
import { exportTenant, runNightlyExports } from "./export";
import {
  resetAddonCollectionsForTest,
  TENANT_COLLECTIONS,
  type CollectionSpec,
} from "./registry";

const MESSAGE =
  "add-on collections are not registered: import @cds/addon-registry/server first";

describe("export fail-closed guard (T-05-16)", () => {
  beforeEach(() => resetAddonCollectionsForTest());

  it("exportTenant refuses before add-on collections are registered", async () => {
    await expect(
      exportTenant({} as Parameters<typeof exportTenant>[0], "org1"),
    ).rejects.toThrow(MESSAGE);
  });

  it("runNightlyExports refuses before add-on collections are registered", async () => {
    await expect(runNightlyExports()).rejects.toThrow(MESSAGE);
  });
});

// P11 (11-09, D187, Pitfall 15): device keys, invite token hashes, alert source keys and
// download object keys never reach a tenant export, a visitor or a caller's filter.
describe("P11 secrets never leave the server (T-11-09-03)", () => {
  const SPECS = TENANT_COLLECTIONS as Record<string, CollectionSpec>;
  const NEVER_LISTED = [
    "token_hash",
    "endpoint",
    "p256dh",
    "auth",
    "source_key",
    "object_key",
  ];

  it("no export, public or filterable list names a P11 secret field", () => {
    for (const [name, spec] of Object.entries(SPECS)) {
      const lists = [
        spec.export === "never" ? [] : spec.export,
        spec.public ?? [],
        spec.filterable ?? [],
      ];
      for (const list of lists) {
        expect(
          list.filter((f) => NEVER_LISTED.includes(f)),
          name,
        ).toEqual([]);
      }
    }
  });

  it("alerts, push_subscriptions and data_exports are never exported", () => {
    for (const name of ["alerts", "push_subscriptions", "data_exports"]) {
      expect(SPECS[name]?.export, name).toBe("never");
    }
  });

  it("per-person collections are personal with an owner field (Pitfall 6)", () => {
    for (const name of ["member_prefs", "alerts", "push_subscriptions"]) {
      expect(SPECS[name]?.personal, name).toBe(true);
      expect(SPECS[name]?.ownerField, name).toBe("user");
    }
    for (const [name, spec] of Object.entries(SPECS)) {
      if (spec.personal) expect(spec.ownerField, name).toBeTruthy();
    }
  });
});
