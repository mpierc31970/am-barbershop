// Quote chokepoint, pure parts (ONB-08; T-06-28, T-06-32). Malformed tokens never reach
// PocketBase; links are platform URLs; unsubscribe tokens are signed and expire late.
import { InvalidInput, NotFound } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pbCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("./client", () => ({
  withSuperuser: vi.fn(() => {
    pbCalls.n += 1;
    return Promise.reject(new Error("PB must not be called"));
  }),
  superuser: vi.fn(() => {
    pbCalls.n += 1;
    return Promise.reject(new Error("PB must not be called"));
  }),
}));

import { verifyLink } from "./email";
import { alwaysPass } from "./human-check";
import {
  describeUnsubscribe,
  quoteLinkState,
  QUOTE_TOKEN_RE,
  QUOTE_TTL_DAYS,
  QUOTE_UNSUB_GRACE_DAYS,
  quoteReopenLink,
  quoteUnsubscribeLink,
  quoteUnsubscribePostUrl,
  readQuoteByToken,
  saveQuoteEmail,
  unsubscribeQuote,
  updateQuote,
} from "./quotes";
import { resetQuoteLimitsForTests } from "./rate-limit";
import type { AddonRegistry } from "@cds/core/addons";

const TOKEN = "A".repeat(43);
const registry = {
  publicList: () => [],
} as unknown as AddonRegistry;

beforeEach(() => {
  pbCalls.n = 0;
  resetQuoteLimitsForTests();
});

describe("token shape (T-06-28)", () => {
  it("QUOTE_TOKEN_RE accepts 43 base64url chars only", () => {
    expect(QUOTE_TOKEN_RE.test(TOKEN)).toBe(true);
    expect(QUOTE_TOKEN_RE.test("A".repeat(42))).toBe(false);
    expect(QUOTE_TOKEN_RE.test("A".repeat(44))).toBe(false);
    expect(QUOTE_TOKEN_RE.test(`${"A".repeat(42)}=`)).toBe(false);
    expect(QUOTE_TOKEN_RE.test(`${"A".repeat(42)}/`)).toBe(false);
    expect(QUOTE_TTL_DAYS).toBe(30);
  });

  it("malformed tokens never reach PocketBase", async () => {
    for (const bad of ["garbage", "", "A".repeat(44), "x'||1=1--"]) {
      expect(await readQuoteByToken(bad)).toBeNull();
      expect(await quoteLinkState(bad)).toBe("expired");
      await expect(
        updateQuote(bad, { selections: {} }, "1.1.1.1", { registry }),
      ).rejects.toBeInstanceOf(NotFound);
      await expect(
        saveQuoteEmail(bad, "a@b.test", "tok", "1.1.1.1", {
          registry,
          humanCheck: alwaysPass(),
        }),
      ).rejects.toBeInstanceOf(NotFound);
    }
    expect(await readQuoteByToken(42 as unknown as string)).toBeNull();
    expect(pbCalls.n).toBe(0);
  });

  it("an invalid email is refused before the bot check or PocketBase", async () => {
    const verify = vi.fn(() => Promise.resolve(true));
    await expect(
      saveQuoteEmail(TOKEN, "not-an-email", "tok", "1.1.1.2", {
        registry,
        humanCheck: { verify },
      }),
    ).rejects.toThrow(/doesn't look like an email address/);
    expect(verify).not.toHaveBeenCalled();
    expect(pbCalls.n).toBe(0);
  });

  it("a failed bot check refuses with ERR-HUMAN before PocketBase", async () => {
    await expect(
      saveQuoteEmail(TOKEN, "a@b.test", "tok", "1.1.1.3", {
        registry,
        humanCheck: { verify: () => Promise.resolve(false) },
      }),
    ).rejects.toThrow(/couldn't confirm you're a person/);
    expect(pbCalls.n).toBe(0);
  });
});

describe("links", () => {
  it("reopen link is /start/q/<token> on the platform URL", () => {
    expect(quoteReopenLink(TOKEN)).toBe(
      `http://localhost:3000/start/q/${TOKEN}`,
    );
    expect(() => quoteReopenLink("nope")).toThrow(InvalidInput);
  });

  it("unsubscribe links carry one signed token valid until expires_at + 90 days", () => {
    const exp = new Date("2026-10-28T12:00:00.000Z");
    const get = new URL(quoteUnsubscribeLink("abc123", exp));
    const post = new URL(quoteUnsubscribePostUrl("abc123", exp));
    expect(get.pathname).toBe("/start/unsubscribe");
    expect(post.pathname).toBe("/api/email/unsubscribe");
    const t = get.searchParams.get("t")!;
    expect(post.searchParams.get("t")).toBe(t);
    const graceEnd = exp.getTime() / 1000 + QUOTE_UNSUB_GRACE_DAYS * 86400;
    const v = verifyLink(t, "unsub", graceEnd - 1);
    expect(v).toEqual({ id: "abc123", exp: graceEnd });
    expect(verifyLink(t, "unsub", graceEnd)).toBeNull();
    expect(verifyLink(t, "confirm", graceEnd - 1)).toBeNull();
    expect(() => quoteUnsubscribeLink("bad id!", exp)).toThrow(InvalidInput);
  });

  it("tampered unsubscribe tokens are refused without PocketBase", async () => {
    expect(await unsubscribeQuote("x.y")).toBe(false);
    expect(await describeUnsubscribe("")).toBeNull();
    expect(pbCalls.n).toBe(0);
  });
});
