// 07-19 Task 2: the no-JS form status URL contract (CONT-25; RESEARCH line 931, open
// redirect; choices 1-3). Hostile values never throw and never leave the host.
import type { SiteManifest } from "@cds/core/content";
import { describe, expect, it } from "vitest";
import {
  formReturnHref,
  formQueryParams,
  formReturnPathFor,
  pagePathFor,
  parseFieldCodes,
  parseFormResume,
  parseFormStatus,
  safeSamePath,
} from "../lib/form-status";

describe("parseFormStatus", () => {
  it("parses sent, rate, error and fields", () => {
    expect(parseFormStatus({ form: "f1", item: "it-1", sent: "1" })).toEqual({
      formId: "f1",
      status: { itemId: "it-1", kind: "sent" },
    });
    expect(
      parseFormStatus({ form: "f1", item: "a", err: "rate" })?.status.kind,
    ).toBe("rate");
    expect(
      parseFormStatus({ form: "f1", item: "a", err: "error" })?.status.kind,
    ).toBe("error");
    expect(
      parseFormStatus({
        form: "f1",
        item: "a",
        err: "fields",
        f: "email.r,msg.l,bad.x,.r",
      }),
    ).toEqual({
      formId: "f1",
      status: { itemId: "a", kind: "fields", fields: { email: "r", msg: "l" } },
    });
  });

  it("uses the first value of arrays", () => {
    expect(
      parseFormStatus({ form: ["f1", "f2"], item: ["a"], sent: ["1"] })?.formId,
    ).toBe("f1");
  });

  it.each([
    [{}],
    [{ form: "../x", item: "a", sent: "1" }],
    [{ form: "f1", item: "A B", sent: "1" }],
    [{ form: "f1", item: "a", err: "nope" }],
    [{ form: "f1", item: "a" }],
    [null],
  ])("rejects %j", (p) => {
    expect(parseFormStatus(p as never)).toBeNull();
  });

  it("caps field codes at 40", () => {
    const many = Array.from({ length: 60 }, (_, i) => `f${i}.r`).join(",");
    expect(Object.keys(parseFieldCodes(many))).toHaveLength(40);
  });
});

describe("safeSamePath", () => {
  it.each([
    ["/contact", "/contact"],
    ["/", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/a\r\nSet-Cookie: x", "/"],
    ["contact", "/"],
    ["/" + "a".repeat(600), "/"],
  ])("%s -> %s", (input, out) => {
    expect(safeSamePath(input)).toBe(out);
  });
});

describe("formReturnHref", () => {
  it("builds the sent and fields URLs with the item anchor", () => {
    expect(formReturnHref("/contact", "f1", "it-1", { kind: "sent" })).toBe(
      "/contact?form=f1&item=it-1&sent=1#form-it-1",
    );
    expect(
      formReturnHref("/", "f1", "it-1", {
        kind: "fields",
        fields: { email: "r" },
      }),
    ).toBe("/?form=f1&item=it-1&err=fields&f=email.r#form-it-1");
    expect(formReturnHref("/", "f1", null, { kind: "rate" })).toBe(
      "/?form=f1&err=rate",
    );
  });

  it("never leaves the host", () => {
    const href = formReturnHref("//evil.example", "f1", "it-1", {
      kind: "sent",
    });
    expect(href.startsWith("/?form=")).toBe(true);
    expect(href).not.toContain("evil");
  });
});

describe("pagePathFor", () => {
  const manifest = {
    version: 1,
    pages: {
      home: { id: "p1", title: "Home", published_at: "", protected: false },
      contact: {
        id: "p2",
        title: "Contact",
        published_at: "",
        protected: false,
      },
      secret: { id: "p3", title: "S", published_at: "", protected: true },
    },
    redirects: {},
    updated_at: "",
  } as SiteManifest;

  it("maps page ids to paths; protected and unknown are null", () => {
    expect(pagePathFor(manifest, "p1")).toBe("/");
    expect(pagePathFor(manifest, "p2")).toBe("/contact");
    expect(pagePathFor(manifest, "p3")).toBeNull();
    expect(pagePathFor(manifest, "zz")).toBeNull();
    expect(pagePathFor(null, "p1")).toBeNull();
    expect(pagePathFor(manifest, "//x")).toBeNull();
  });

  const with404 = {
    ...manifest,
    pages: {
      ...manifest.pages,
      "system-404": {
        id: "p4",
        title: "Not found",
        published_at: "",
        protected: false,
      },
    },
  } as SiteManifest;

  it("never targets the 404 page or a hidden page; protected only when allowed (WR-C02)", () => {
    expect(pagePathFor(with404, "p4")).toBeNull();
    expect(pagePathFor(with404, "p4", { allowProtected: true })).toBeNull();
    expect(pagePathFor(with404, "p3", { allowProtected: true })).toBe(
      "/secret",
    );
    expect(pagePathFor(with404, "p2", { hiddenPageIds: ["p2"] })).toBeNull();
  });

  it("formReturnPathFor: 404 page -> /system-404, protected -> its own path (WR-C02)", () => {
    expect(formReturnPathFor(with404, "p4")).toBe("/system-404");
    expect(formReturnPathFor(with404, "p3")).toBe("/secret");
    expect(formReturnPathFor(with404, "p2")).toBe("/contact");
    expect(formReturnPathFor(with404, "p2", ["p2"])).toBe("/");
    expect(formReturnPathFor(with404, "zz")).toBe("/");
    expect(formReturnPathFor(null, "p4")).toBe("/");
  });
});

describe("formQueryParams (WR-C02)", () => {
  it("parses the forwarded query for parseFormStatus; junk and oversize are null", () => {
    const q = formQueryParams("?form=f1&item=i-1&sent=1&form=f2");
    expect(q).toEqual({ form: "f1", item: "i-1", sent: "1" });
    expect(parseFormStatus(q)).toEqual({
      formId: "f1",
      status: { itemId: "i-1", kind: "sent" },
    });
    expect(formQueryParams(null)).toBeNull();
    expect(formQueryParams("")).toBeNull();
    expect(formQueryParams("?" + "a".repeat(5000))).toBeNull();
  });
});

// 10-40: save and finish later (saved=1) and resume links (?resume=<token>).
describe("save and resume", () => {
  it("round-trips the saved outcome", () => {
    const href = formReturnHref("/contact", "f1", "it-1", { kind: "saved" });
    expect(href).toBe("/contact?form=f1&item=it-1&saved=1#form-it-1");
    expect(parseFormStatus({ form: "f1", item: "it-1", saved: "1" })).toEqual({
      formId: "f1",
      status: { itemId: "it-1", kind: "saved" },
    });
  });

  it("accepts only a 43-character base64url token", () => {
    const token = "a".repeat(40) + "_-Z";
    expect(parseFormResume({ resume: token })).toBe(token);
    expect(parseFormResume({ resume: [token, "x"] })).toBe(token);
    for (const bad of ["", "short", "a".repeat(44), "a".repeat(42) + "!"]) {
      expect(parseFormResume({ resume: bad })).toBeNull();
    }
    expect(parseFormResume(null)).toBeNull();
    expect(parseFormResume({})).toBeNull();
  });
});
