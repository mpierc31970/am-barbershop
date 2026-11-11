// Review 11 IN-C04: the bell's inbox cap mirrors @cds/db's Needs-you inbox cap. If they drift,
// unread-message alerts past the cap clear wrongly or never clear.
// 12-24 (COMM-03, COMM-10): the support provider (named `cds`) keys its items `support:`; a
// failed support provider keeps those bell rows, while `cds:` plain alerts are never kept.
import { NEEDS_YOU_INBOX_MAX } from "@cds/db";
import { describe, expect, it } from "vitest";
import { INBOX_NEEDS_YOU_CAP, bellKeysFrom } from "../lib/bell";

describe("bell inbox cap (IN-C04)", () => {
  it("matches @cds/db NEEDS_YOU_INBOX_MAX", () => {
    expect(INBOX_NEEDS_YOU_CAP).toBe(NEEDS_YOU_INBOX_MAX);
  });
});

describe("support bell keys (12-24)", () => {
  it("a support key is present only while its Needs-you item is", () => {
    const keys = bellKeysFrom({
      items: [{ key: "support:ticket:1042" }],
      failed: [],
    });
    expect(keys.has("support:ticket:1042")).toBe(true);
    expect(keys.has("support:ticket:1043")).toBe(false);
    expect(keys.has("support:messages")).toBe(false);
  });

  it("a failed support provider keeps every support key", () => {
    const keys = bellKeysFrom({ items: [], failed: ["cds"] });
    expect(keys.has("support:ticket:1042")).toBe(true);
    expect(keys.has("support:messages")).toBe(true);
    // Plain CDS alerts and other providers are not kept by it.
    expect(keys.has("cds:document:abc")).toBe(false);
    expect(keys.has("inbox:abc")).toBe(false);
  });

  it("a failed add-on list does not keep support keys", () => {
    const keys = bellKeysFrom({ items: [], failed: ["addons"] });
    expect(keys.has("support:ticket:1042")).toBe(false);
    expect(keys.has("cds:notice:abc")).toBe(false);
    expect(keys.has("booking:x")).toBe(true);
  });
});
