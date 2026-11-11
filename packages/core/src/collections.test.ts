// P9 RESEARCH Pitfall 2: append-only legal evidence declares restore: "skip". The real check
// is the typecheck of this file; the runtime assertion keeps vitest honest.
import { describe, expect, it } from "vitest";
import type { CollectionSpec } from "./collections";

describe("CollectionSpec.restore", () => {
  it('accepts "skip"', () => {
    const spec: CollectionSpec = {
      kind: "append-only",
      feature: "agreements",
      export: "never",
      writes: "custom",
      restore: "skip",
    };
    expect(spec.restore).toBe("skip");
  });
});
