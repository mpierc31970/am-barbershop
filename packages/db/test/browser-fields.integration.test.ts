// BILL-05, D42 (CONTEXT A3): every field of every live collection (core and add-on
// migrations) is classified in BROWSER_FIELDS, and every listed field exists, so a future
// migration cannot silently expose a field to client components.
// Registers add-on collections before anything reads the composed registry (05-04).
import "@cds/addon-registry/server";
import { unclassifiedFields, type LiveCollection } from "@cds/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
const live: Record<string, LiveCollection> = {};

describe("BROWSER_FIELDS matches the live schema", () => {
  beforeAll(async () => {
    inst = await bootPb();
    if (!inst) return;
    resetClientForTests();
    const pb = await superuser();
    for (const c of await pb.collections.getFullList()) {
      if (c.name.startsWith("_")) continue;
      live[c.name] = { type: c.type, fields: c.fields.map((f) => f.name) };
    }
  });

  afterAll(async () => {
    await inst?.stop();
  });

  it("every live field is in allow or serverOnly, and every listed field is live", (ctx) => {
    if (!inst) return ctx.skip();
    expect(Object.keys(live).length).toBeGreaterThan(30);
    expect(unclassifiedFields(live)).toEqual([]);
  });
});
