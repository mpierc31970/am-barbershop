import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import { SUPPORT_COPY } from "./copy";
import {
  SITE_PARTS,
  WHOLE_SITE,
  buildTargetOptions,
  ticketTypesFor,
  validateTarget,
} from "./targets";

describe("ticketTypesFor", () => {
  it("offers billing to owner and admin only", () => {
    expect(ticketTypesFor("owner")).toContain("billing");
    expect(ticketTypesFor("admin")).toContain("billing");
    expect(ticketTypesFor("editor")).not.toContain("billing");
    expect(ticketTypesFor("editor")).toContain("suggestion");
  });

  it("gives viewers and grants-only roles none (P12-P11)", () => {
    expect(ticketTypesFor("viewer")).toEqual([]);
    expect(ticketTypesFor("staff")).toEqual([]);
    expect(ticketTypesFor("renter")).toEqual([]);
    expect(ticketTypesFor(null)).toEqual([]);
  });
});

describe("target options", () => {
  const options = buildTargetOptions({
    pages: [{ id: "p1", title: "About us" }],
    addons: [{ slug: "appointments", name: "Appointments" }],
  });

  it("groups Your site / Pages / Add-ons / Site parts", () => {
    expect(options.map((g) => g.label)).toEqual([
      "Your site",
      "Pages",
      "Add-ons",
      "Site parts",
    ]);
    expect(options[3]!.options).toHaveLength(SITE_PARTS.length);
  });

  it("omits empty groups", () => {
    const g = buildTargetOptions({ pages: [], addons: [] });
    expect(g.map((x) => x.label)).toEqual(["Your site", "Site parts"]);
  });

  it("validates against the server-built options", () => {
    expect(validateTarget(undefined, options)).toEqual(WHOLE_SITE);
    expect(validateTarget("page:p1", options)).toEqual({
      kind: "page",
      id: "p1",
      label: "About us",
    });
    expect(
      validateTarget({ kind: "part", id: "footer", label: "forged" }, options),
    ).toEqual({ kind: "part", id: "footer", label: "Footer" });
  });

  it("rejects a page id not in the options", () => {
    expect(() => validateTarget("page:p2", options)).toThrow(InvalidInput);
    expect(() =>
      validateTarget({ kind: "addon", id: "store" }, options),
    ).toThrow(InvalidInput);
    expect(() => validateTarget("junk", options)).toThrow(InvalidInput);
    expect(() => validateTarget(42, options)).toThrow(InvalidInput);
    // The message reaches the ticket form word for word (WR-B02).
    for (const raw of ["page:p2", "junk", 42]) {
      expect(() => validateTarget(raw, options)).toThrow(
        SUPPORT_COPY.TARGET_UNKNOWN,
      );
    }
  });
});
