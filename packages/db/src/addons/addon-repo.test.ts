// addonRepo refusals that need no PocketBase (ADDON-06; CONTEXT A1-Q4). The real record
// writes are exercised by the add-on integration suites.
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { composeAddonRegistry } from "@cds/core/addons";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureManifest } from "../../../core/src/addons/__fixtures__/manifests";
import * as client from "../client";
import { recordingInvalidator } from "../content/ports";
import { mintOrgContext } from "../context";
import { addonRepo } from "./addon-repo";
import type { AddonDeps } from "./types";

const ROWS = fixtureManifest({
  slug: "fixture-rows",
  collections: {
    fixture_rows: {
      kind: "base",
      feature: "addon:fixture-rows",
      export: ["id", "organization", "title", "is_published", "sort_order"],
      writes: "custom",
      public: ["title"],
    },
  },
  records: {
    fixture_rows: {
      singular: "row",
      plural: "rows",
      validate: (raw) => raw as Record<string, unknown>,
      textsOf: () => [],
      urlsOf: () => [],
      title: () => "row",
      publishedField: "is_published",
      orderField: "sort_order",
    },
  },
});

const deps: AddonDeps = {
  sections: composeSectionRegistry(CORE_SECTIONS, []),
  invalidator: recordingInvalidator(),
  addons: composeAddonRegistry([ROWS], { fileExists: () => true }),
};

const ctx = (role: "owner" | "editor" | "renter", grants: string[] = []) =>
  mintOrgContext({
    orgId: "orgaaaaaaaaaaaa",
    actor: "useraaaaaaaaaaa",
    role,
    grants,
    ip: "127.0.0.1",
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("addonRepo (ADDON-06)", () => {
  it("refuses a collection the manifest does not declare, before any PB call", () => {
    const spy = vi.spyOn(client, "withSuperuser");
    const repo = addonRepo(ctx("owner"), deps, "fixture-rows");
    expect(() => repo.collection("pages")).toThrow(InvalidInput);
    expect(() => repo.collection("org_addons")).toThrow(
      /unknown collection for fixture-rows/,
    );
    expect(() => repo.collection("__proto__")).toThrow(InvalidInput);
    expect(() => repo.collection("toString")).toThrow(InvalidInput);
    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves a declared collection", () => {
    const repo = addonRepo(ctx("owner"), deps, "fixture-rows");
    expect(typeof repo.collection("fixture_rows").list).toBe("function");
  });

  it("an unknown add-on slug is NotFound", () => {
    expect(() => addonRepo(ctx("owner"), deps, "nope-addon")).toThrow(NotFound);
  });

  it("a grant-less editor is refused addon read and write", async () => {
    const spy = vi.spyOn(client, "withSuperuser");
    const rows = addonRepo(ctx("editor"), deps, "fixture-rows").collection(
      "fixture_rows",
    );
    await expect(rows.list()).rejects.toThrow(Forbidden);
    await expect(rows.save({ title: "x" })).rejects.toThrow(Forbidden);
    await expect(rows.remove("abc")).rejects.toThrow(Forbidden);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a renter is refused even with the add-on grant (fail closed)", async () => {
    const rows = addonRepo(
      ctx("renter", ["fixture-rows"]),
      deps,
      "fixture-rows",
    ).collection("fixture_rows");
    await expect(rows.list()).rejects.toThrow(Forbidden);
  });

  it("a plain object is not a context", () => {
    expect(() =>
      addonRepo(
        { orgId: "x" } as unknown as Parameters<typeof addonRepo>[0],
        deps,
        "fixture-rows",
      ),
    ).toThrow();
  });
});
