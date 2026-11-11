// P8 (08-11): the assembly ledger is read deny-by-default (CONTEXT A2-Q3, ASVS V5;
// T-08-11-01). DB round trip and cross-tenant cases: test/assembly-parts.integration.test.ts.
import { describe, expect, it } from "vitest";
import { emptyLedger, parseLedger } from "./ledger";

const ID = "abcdefghijklmno";
const ID2 = "pqrstuvwxyz0123";

describe("emptyLedger", () => {
  it("is queued, zero attempts, no pages, empty template", () => {
    expect(emptyLedger()).toEqual({
      template_id: "",
      template_version: 0,
      status: "queued",
      attempts: 0,
      pages: {},
    });
  });
});

describe("parseLedger (deny by default)", () => {
  it.each([undefined, null, "x", [], 5, true])(
    "%s reads as an empty ledger",
    (raw) => {
      expect(parseLedger(raw)).toEqual(emptyLedger());
    },
  );

  it("drops unknown keys, clamps status and attempts", () => {
    const out = parseLedger({
      status: "hacked",
      attempts: -2,
      pages: { home: { id: ID, slug: "home", print: "p", extra: 1 } },
      evil: true,
    });
    expect(out.status).toBe("queued");
    expect(out.attempts).toBe(0);
    expect(out.pages.home).toEqual({
      id: ID,
      slug: "home",
      print: "p",
      published: false,
    });
    expect("evil" in out).toBe(false);
  });

  it("keeps a well-formed ledger as is", () => {
    const good = {
      template_id: "standard-v1",
      template_version: 1,
      status: "done",
      attempts: 2,
      started_at: "2026-10-07T19:10:00.000Z",
      assembled_at: "2026-10-07T19:14:00.000Z",
      form_id: ID2,
      failure_emailed: false,
      pages: {
        home: { id: ID, slug: "", print: "abc", published: true },
        about: {
          id: ID2,
          slug: "about",
          print: "def",
          pending: true,
          versionKey: "tenants/x/pages/v1.json",
          published: false,
        },
      },
      error: { code: "PUBLISH_FAILED", page: "about" },
      report: {
        templateId: "standard-v1",
        templateVersion: 1,
        slots: [
          { page: "home", slot: "hero", source: "fallback", note: "n" },
          { page: "home", slot: "intro", source: "provided" },
        ],
        polish: ["Theme: import the impeccable theme (D45)"],
        pages: [{ key: "home", label: "Home", outcome: "created", path: "/" }],
      },
    };
    expect(parseLedger(good)).toEqual(good);
  });

  it("drops pages with bad ids or bad keys, and non-integer attempts", () => {
    const out = parseLedger({
      status: "running",
      attempts: 1.5,
      pages: {
        home: { id: "../etc", slug: "home", print: "p" },
        about: { id: ID, slug: "about", print: "q" },
        "Bad Key!": { id: ID2, slug: "x", print: "r" },
        __proto__: { id: ID2, slug: "x", print: "r" },
      },
    });
    expect(out.status).toBe("running");
    expect(out.attempts).toBe(0);
    expect(Object.keys(out.pages)).toEqual(["about"]);
  });

  it("limits the error code and drops a malformed report", () => {
    const out = parseLedger({
      status: "failed",
      attempts: 3,
      error: { code: "drop table; --", page: "about" },
      report: { slots: [{ page: "home", slot: "hero", source: "evil" }] },
    });
    expect(out.error).toBeUndefined();
    expect(out.report).toBeUndefined();
    const ok = parseLedger({
      status: "failed",
      attempts: 3,
      error: { code: "PUBLISH_FAILED", page: "about", stack: "secret" },
    });
    expect(ok.error).toEqual({ code: "PUBLISH_FAILED", page: "about" });
  });

  it("drops a non-boolean failure_emailed and a non-string timestamp", () => {
    const out = parseLedger({ failure_emailed: "yes", assembled_at: 5 });
    expect(out.failure_emailed).toBeUndefined();
    expect(out.assembled_at).toBeUndefined();
  });

  it("caps attempts at a sane maximum", () => {
    expect(parseLedger({ attempts: 1e9 }).attempts).toBe(0);
  });
});
