import { RateLimited } from "@cds/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginSupportAction,
  resetSupportLimitsForTests,
  SUPPORT_MESSAGES_PER_PERSON,
  SUPPORT_RATE_COPY,
  SUPPORT_TICKETS_PER_ORG,
  SUPPORT_UPLOADS_PER_ORG,
  beginCodeRequest,
  beginConfirmSend,
  CONFIRM_SENDS_PER_ADDRESS,
  CONFIRM_SENDS_PER_ORG,
  resetConfirmSendLimitsForTests,
  beginQuoteAction,
  beginSignIn,
  QUOTE_CREATE_PER_IP,
  QUOTE_SAVE_PER_IP,
  QUOTE_UPDATE_PER_IP,
  resetQuoteLimitsForTests,
  resetSignInLimitsForTests,
  resetSubmitLimitsForTests,
  SIGN_IN_PER_ACCOUNT,
  SIGN_IN_PER_ACCOUNT_IP,
  SIGN_IN_PER_IP,
  SIGN_IN_PER_OTP,
  SlidingWindowLimiter,
  SUBMIT_PER_EMAIL,
  SUBMIT_PER_IP,
  FORM_RATE_COPY,
  FORM_SUBMITS_PER_FORM,
  FORM_SUBMITS_PER_IP_FORM,
  resetFormSubmitLimitsForTests,
  takeFormSubmit,
  PAGE_GATE_PER_IP_PAGE,
  PAGE_GATE_PER_PAGE,
  ipBucket,
  pageGateRetryAfterS,
  releasePageGateAttempt,
  resetPageGateLimitsForTests,
  takePageGateAttempt,
  beginReportAction,
  resetReportLimitsForTests,
  REPORT_PER_IP,
  REPORT_RATE_COPY,
  beginContactAction,
  resetContactLimitsForTests,
  CONTACT_PER_IP,
  CONTACT_RATE_COPY,
  beginEdgeAskMiss,
  resetEdgeAskLimitsForTests,
  EDGE_ASK_MISSES_PER_DOMAIN,
} from "./rate-limit";

// WR-01: PB sees only the app server's IP, so sign-in limits live in the app.
describe("SlidingWindowLimiter", () => {
  it("allows max hits per window, then refuses, then recovers", () => {
    let t = 0;
    const l = new SlidingWindowLimiter(3, 1000, () => t);
    expect([l.hit("k"), l.hit("k"), l.hit("k")]).toEqual([true, true, true]);
    expect(l.hit("k")).toBe(false);
    expect(l.isFull("k")).toBe(true);
    expect(l.hit("other")).toBe(true);
    t = 1001;
    expect(l.isFull("k")).toBe(false);
    expect(l.hit("k")).toBe(true);
  });

  it("release gives one slot back; isFull records nothing", () => {
    let t = 0;
    const l = new SlidingWindowLimiter(2, 1000, () => t);
    const a = l.take("k");
    t = 1;
    l.take("k");
    expect(l.isFull("k")).toBe(true);
    l.release("k", a!);
    expect(l.isFull("k")).toBe(false);
    for (let i = 0; i < 5; i++) l.isFull("k");
    expect(l.take("k")).not.toBeNull();
    expect(l.take("k")).toBeNull();
  });
});

describe("beginSignIn", () => {
  beforeEach(() => resetSignInLimitsForTests());
  afterEach(() => vi.useRealTimers());

  const fail = (kind: "email" | "otp", ip: string | undefined, a: string) =>
    beginSignIn(kind, ip, a); // never succeeded(): counts as a failure
  const ipN = (i: number) => `10.0.${i >> 8}.${i & 255}`;

  it("limits one (account, IP) pair tightly (case-insensitive)", () => {
    for (let i = 0; i < SIGN_IN_PER_ACCOUNT_IP; i++) {
      fail("email", "10.1.0.1", i % 2 ? " A@x.test" : "a@x.test");
    }
    expect(() => beginSignIn("email", "10.1.0.1", "a@x.test")).toThrow(
      RateLimited,
    );
    // The same account from another IP is not limited by that source.
    expect(() =>
      beginSignIn("email", "10.1.0.2", "a@x.test").succeeded(),
    ).not.toThrow();
  });

  it("limits one account across many IPs (distributed ceiling)", () => {
    for (let i = 0; i < SIGN_IN_PER_ACCOUNT; i++) {
      fail("email", ipN(i), i % 2 ? " B@x.test" : "b@x.test");
    }
    expect(() => beginSignIn("email", "10.9.0.1", "b@x.test")).toThrow(
      RateLimited,
    );
    // The OTP step is a separate key space: an otpId never collides with an email.
    expect(() => beginSignIn("otp", "10.9.0.1", "b@x.test")).not.toThrow();
  });

  it("the distributed ceiling needs many sources", () => {
    expect(SIGN_IN_PER_ACCOUNT / SIGN_IN_PER_ACCOUNT_IP).toBeGreaterThanOrEqual(
      10,
    );
    expect(SIGN_IN_PER_ACCOUNT_IP).toBeLessThanOrEqual(SIGN_IN_PER_IP);
  });

  it("limits one otpId across IPs", () => {
    for (let i = 0; i < SIGN_IN_PER_OTP; i++) fail("otp", ipN(i), "otp1");
    expect(() => beginSignIn("otp", "10.9.9.1", "otp1")).toThrow(RateLimited);
  });

  it("limits one IP across many accounts", () => {
    for (let i = 0; i < SIGN_IN_PER_IP; i++) {
      fail("email", "10.9.9.9", `u${i}@x.test`);
    }
    expect(() => beginSignIn("email", "10.9.9.9", "fresh@x.test")).toThrow(
      RateLimited,
    );
    expect(() =>
      beginSignIn("email", "10.9.9.8", "fresh@x.test"),
    ).not.toThrow();
  });

  // Iteration-3 WR-01: one IP sending 1 wrong password a minute cannot lock the account.
  it("one IP failing once a minute for 30 minutes never locks out the real user", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-09-26T12:00:00Z").getTime();
    for (let m = 0; m < 30; m++) {
      vi.setSystemTime(start + m * 60_000);
      try {
        fail("email", "10.6.6.6", "boss@x.test");
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimited);
      }
      // The real user, from their own IP, signs in every minute.
      expect(() =>
        beginSignIn("email", "10.7.7.7", "boss@x.test").succeeded(),
      ).not.toThrow();
    }
    // A burst from the attacker IP is still slowed, and the real user is still fine.
    for (let i = 0; i < SIGN_IN_PER_ACCOUNT_IP; i++) {
      try {
        fail("email", "10.6.6.6", "boss@x.test");
      } catch {
        // already limited
      }
    }
    expect(() => beginSignIn("email", "10.6.6.6", "boss@x.test")).toThrow(
      RateLimited,
    );
    expect(() =>
      beginSignIn("email", "10.7.7.7", "boss@x.test").succeeded(),
    ).not.toThrow();
  });

  // Iteration-2 WR-02: only failures count, and a refused attempt counts nowhere.
  it("successful attempts never use up the budget", () => {
    for (let i = 0; i < SIGN_IN_PER_ACCOUNT * 3; i++) {
      beginSignIn("email", "10.2.0.1", "real@x.test").succeeded();
    }
    expect(() =>
      beginSignIn("email", "10.2.0.1", "real@x.test").succeeded(),
    ).not.toThrow();
  });

  it("refused attempts from an over-limit IP do not burn the account's budget", () => {
    for (let i = 0; i < SIGN_IN_PER_IP; i++) {
      fail("email", "10.3.3.3", `spray${i}@x.test`);
    }
    for (let i = 0; i < SIGN_IN_PER_ACCOUNT * 2; i++) {
      expect(() => beginSignIn("email", "10.3.3.3", "boss@x.test")).toThrow(
        RateLimited,
      );
    }
    // The real user, from their own IP, still has the full budget.
    for (let i = 0; i < SIGN_IN_PER_ACCOUNT_IP - 1; i++) {
      fail("email", "10.4.4.4", "boss@x.test");
    }
    expect(() =>
      beginSignIn("email", "10.4.4.4", "boss@x.test").succeeded(),
    ).not.toThrow();
  });

  it("concurrent in-flight attempts cannot exceed the account limit", () => {
    const inFlight = [];
    for (let i = 0; i < SIGN_IN_PER_ACCOUNT; i++) {
      inFlight.push(beginSignIn("email", ipN(i), "c@x.test"));
    }
    expect(() => beginSignIn("email", "10.5.1.1", "c@x.test")).toThrow(
      RateLimited,
    );
    inFlight[0]!.succeeded();
    inFlight[0]!.succeeded(); // idempotent: gives back only one slot
    expect(() => fail("email", "10.5.1.1", "c@x.test")).not.toThrow();
    expect(() => beginSignIn("email", "10.5.1.2", "c@x.test")).toThrow(
      RateLimited,
    );
  });

  it("concurrent in-flight attempts from one IP cannot exceed the (account, IP) limit", () => {
    for (let i = 0; i < SIGN_IN_PER_ACCOUNT_IP; i++) {
      beginSignIn("email", "10.5.2.1", "d@x.test");
    }
    expect(() => beginSignIn("email", "10.5.2.1", "d@x.test")).toThrow(
      RateLimited,
    );
  });

  it("a missing IP skips the IP bucket and shares one source per account", () => {
    for (let i = 0; i < SIGN_IN_PER_ACCOUNT_IP; i++)
      fail("email", undefined, "n@x.test");
    expect(() => beginSignIn("email", undefined, "n@x.test")).toThrow(
      RateLimited,
    );
    expect(() =>
      beginSignIn("email", "10.8.8.8", "n@x.test").succeeded(),
    ).not.toThrow();
  });
});

// PD-10 (06-07): per-IP quote buckets, create 30 / update 300 / save 5 per 10 minutes.
describe("beginQuoteAction", () => {
  beforeEach(() => resetQuoteLimitsForTests());

  it("allows QUOTE_SAVE_PER_IP saves per IP, then throws RateLimited", () => {
    expect(QUOTE_SAVE_PER_IP).toBe(5);
    for (let i = 0; i < QUOTE_SAVE_PER_IP; i++) {
      expect(() => beginQuoteAction("save", "10.9.0.1")).not.toThrow();
    }
    expect(() => beginQuoteAction("save", "10.9.0.1")).toThrow(RateLimited);
    expect(() => beginQuoteAction("save", "10.9.0.2")).not.toThrow();
  });

  it("buckets are separate per kind with the PD-10 limits", () => {
    expect(QUOTE_CREATE_PER_IP).toBe(30);
    expect(QUOTE_UPDATE_PER_IP).toBe(300);
    for (let i = 0; i < QUOTE_CREATE_PER_IP; i++)
      beginQuoteAction("create", "10.9.1.1");
    expect(() => beginQuoteAction("create", "10.9.1.1")).toThrow(RateLimited);
    expect(() => beginQuoteAction("update", "10.9.1.1")).not.toThrow();
    expect(() => beginQuoteAction("save", "10.9.1.1")).not.toThrow();
  });

  it("a missing IP shares one bucket", () => {
    for (let i = 0; i < QUOTE_SAVE_PER_IP; i++) beginQuoteAction("save", "");
    expect(() => beginQuoteAction("save", "")).toThrow(RateLimited);
  });

  it("the reset helper is test-only", () => {
    vi.stubEnv("VITEST", "");
    try {
      expect(() => resetQuoteLimitsForTests()).toThrow(/test-only/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// 06-08: Submit step A / member code requests, 10 per IP and 5 per email per 10 minutes.
describe("beginCodeRequest", () => {
  beforeEach(() => resetSubmitLimitsForTests());

  it("allows SUBMIT_PER_EMAIL requests per email across IPs, then throws", () => {
    expect(SUBMIT_PER_EMAIL).toBe(5);
    for (let i = 0; i < SUBMIT_PER_EMAIL; i++) {
      expect(() => beginCodeRequest(`10.7.0.${i}`, "A@x.test")).not.toThrow();
    }
    expect(() => beginCodeRequest("10.7.1.1", "a@x.test")).toThrow(RateLimited);
    expect(() => beginCodeRequest("10.7.1.1", "b@x.test")).not.toThrow();
  });

  it("allows SUBMIT_PER_IP requests per IP; a full IP burns no email budget", () => {
    expect(SUBMIT_PER_IP).toBe(10);
    for (let i = 0; i < SUBMIT_PER_IP; i++) {
      beginCodeRequest("10.7.2.1", `u${i}@x.test`);
    }
    for (let i = 0; i < 3; i++) {
      expect(() => beginCodeRequest("10.7.2.1", "v@x.test")).toThrow(
        RateLimited,
      );
    }
    for (let i = 0; i < SUBMIT_PER_EMAIL; i++) {
      expect(() => beginCodeRequest(`10.7.3.${i}`, "v@x.test")).not.toThrow();
    }
  });
});

// A-WR-01 / B-WR-03: route confirm emails go to caller-chosen addresses.
describe("beginConfirmSend", () => {
  beforeEach(() => resetConfirmSendLimitsForTests());

  it("allows CONFIRM_SENDS_PER_ORG sends per org, then throws; other orgs are unaffected", () => {
    expect(CONFIRM_SENDS_PER_ORG).toBe(10);
    for (let i = 0; i < CONFIRM_SENDS_PER_ORG; i++) {
      expect(() => beginConfirmSend("org1", `r${i}@x.test`)).not.toThrow();
    }
    expect(() => beginConfirmSend("org1", "new@x.test")).toThrow(RateLimited);
    expect(() => beginConfirmSend("org2", "new@x.test")).not.toThrow();
  });

  it("allows CONFIRM_SENDS_PER_ADDRESS sends per address across orgs; a full org burns no address budget", () => {
    expect(CONFIRM_SENDS_PER_ADDRESS).toBe(5);
    for (let i = 0; i < CONFIRM_SENDS_PER_ADDRESS; i++) {
      expect(() => beginConfirmSend(`o${i}`, "Victim@X.test")).not.toThrow();
    }
    expect(() => beginConfirmSend("o9", "victim@x.test")).toThrow(RateLimited);
    for (let i = 0; i < CONFIRM_SENDS_PER_ORG; i++) {
      beginConfirmSend("full", `f${i}@x.test`);
    }
    expect(() => beginConfirmSend("full", "spare@x.test")).toThrow(RateLimited);
    expect(() => beginConfirmSend("other", "spare@x.test")).not.toThrow();
  });
});

// CONT-25, Pitfall 8 (07-15): form submit buckets.
describe("takeFormSubmit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    resetFormSubmitLimitsForTests();
  });
  afterEach(() => vi.useRealTimers());

  it("allows 5 per (org, form, IP) per 10 minutes with the FORM-RATE copy", () => {
    expect(FORM_SUBMITS_PER_IP_FORM).toBe(5);
    for (let i = 0; i < 5; i++) takeFormSubmit("o", "f", "1.1.1.1");
    expect(() => takeFormSubmit("o", "f", "1.1.1.1")).toThrow(RateLimited);
    expect(() => takeFormSubmit("o", "f", "1.1.1.1")).toThrow(FORM_RATE_COPY);
    expect(() => takeFormSubmit("o", "f2", "1.1.1.1")).not.toThrow();
    expect(() => takeFormSubmit("o2", "f", "1.1.1.1")).not.toThrow();
    expect(() => takeFormSubmit("o", "f", "2.2.2.2")).not.toThrow();
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(() => takeFormSubmit("o", "f", "1.1.1.1")).not.toThrow();
  });

  it("allows 50 per (org, form) per hour across IPs", () => {
    expect(FORM_SUBMITS_PER_FORM).toBe(50);
    for (let i = 0; i < 50; i++) {
      takeFormSubmit("o", "f", `10.0.0.${i}`);
      vi.advanceTimersByTime(1000);
    }
    expect(() => takeFormSubmit("o", "f", "9.9.9.9")).toThrow(RateLimited);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(() => takeFormSubmit("o", "f", "9.9.9.9")).not.toThrow();
  });

  it("release gives both slots back; a refused take records nothing", () => {
    for (let i = 0; i < 20; i++) takeFormSubmit("o", "f", "1.1.1.1").release();
    expect(() => takeFormSubmit("o", "f", "1.1.1.1")).not.toThrow();
    for (let i = 0; i < 4; i++) takeFormSubmit("o", "f", "1.1.1.1");
    for (let i = 0; i < 10; i++) {
      expect(() => takeFormSubmit("o", "f", "1.1.1.1")).toThrow(RateLimited);
    }
    // 5 taken in the form bucket, the 10 refused took none: 45 more fit.
    for (let i = 0; i < 45; i++) takeFormSubmit("o", "f", `10.1.0.${i}`);
    expect(() => takeFormSubmit("o", "f", "8.8.8.8")).toThrow(RateLimited);
  });

  it("releaseForm gives back only the form-wide slot (WR-A03)", () => {
    for (let i = 0; i < 60; i++) {
      const ip = `10.2.0.${Math.floor(i / 5)}`;
      takeFormSubmit("o", "f", ip).releaseForm();
    }
    // Each spamming IP is still at its own limit...
    expect(() => takeFormSubmit("o", "f", "10.2.0.0")).toThrow(RateLimited);
    // ...but the form-wide budget is untouched: a real visitor gets through.
    expect(() => takeFormSubmit("o", "f", "8.8.4.4")).not.toThrow();
    const s = takeFormSubmit("o", "f", "8.8.8.8");
    s.releaseForm();
    s.release(); // gives back the per-IP slot; the form slot is not released twice
    for (let i = 0; i < 5; i++) takeFormSubmit("o", "f", "8.8.8.8");
    expect(() => takeFormSubmit("o", "f", "8.8.8.8")).toThrow(RateLimited);
  });

  it("IPv6 senders share one per-IP bucket per /64 (WR-A03)", () => {
    for (let i = 0; i < 5; i++)
      takeFormSubmit("o", "f", `2001:db8:5:6::${i + 1}`);
    expect(() => takeFormSubmit("o", "f", "2001:db8:5:6:a::1")).toThrow(
      RateLimited,
    );
    expect(() => takeFormSubmit("o", "f", "2001:db8:5:7::1")).not.toThrow();
  });

  it("a missing IP shares the '-' bucket", () => {
    for (let i = 0; i < 5; i++) takeFormSubmit("o", "f", "");
    expect(() => takeFormSubmit("o", "f", "")).toThrow(RateLimited);
  });
});

// CONT-28 (07-32): retryAfterMs and the page-gate bucket.
describe("SlidingWindowLimiter.retryAfterMs", () => {
  it("is 0 when not full, else ms until the oldest hit leaves the window", () => {
    let now = 1_000;
    const l = new SlidingWindowLimiter(2, 100, () => now);
    expect(l.retryAfterMs("k")).toBe(0);
    l.take("k");
    now = 1_030;
    l.take("k");
    expect(l.retryAfterMs("k")).toBe(70);
    now = 1_101;
    expect(l.retryAfterMs("k")).toBe(0);
  });
});

describe("ipBucket", () => {
  it("cuts IPv6 to its /64 and keeps IPv4 whole", () => {
    expect(ipBucket("1.2.3.4")).toBe("1.2.3.4");
    expect(ipBucket("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(ipBucket("2001:DB8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe(
      "2001:db8:1:2::/64",
    );
    expect(ipBucket("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipBucket("")).toBe("");
    expect(ipBucket(undefined)).toBe("");
    expect(ipBucket("not:an:ip:::")).toBe("not:an:ip:::");
  });
});

describe("page gate attempts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
    resetPageGateLimitsForTests();
  });
  afterEach(() => vi.useRealTimers());

  it("takes 10 per (org, page, IP) per 15 minutes; release gives one back", () => {
    expect(PAGE_GATE_PER_IP_PAGE).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(takePageGateAttempt("o", "p", "1.1.1.1")).not.toBeNull();
    }
    expect(takePageGateAttempt("o", "p", "1.1.1.1")).toBeNull();
    const wait = pageGateRetryAfterS("o", "p", "1.1.1.1");
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(900);
    expect(takePageGateAttempt("o", "p2", "1.1.1.1")).not.toBeNull();
    expect(takePageGateAttempt("o2", "p", "1.1.1.1")).not.toBeNull();
    expect(takePageGateAttempt("o", "p", "2.2.2.2")).not.toBeNull();
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(pageGateRetryAfterS("o", "p", "1.1.1.1")).toBe(0);
    const t = takePageGateAttempt("o", "p", "1.1.1.1");
    expect(t).not.toBeNull();
    releasePageGateAttempt("o", "p", "1.1.1.1", t!);
    for (let i = 0; i < 10; i++) takePageGateAttempt("o", "p", "1.1.1.1");
    expect(takePageGateAttempt("o", "p", "1.1.1.1")).toBeNull();
  });

  it("a missing IP skips the per-IP bucket; only the per-page ceiling applies (WR-A02)", () => {
    for (let i = 0; i < 10; i++) takePageGateAttempt("o", "p", "");
    expect(takePageGateAttempt("o", "p", "")).not.toBeNull();
  });

  it("caps guesses per page across rotating IPs (WR-A02)", () => {
    expect(PAGE_GATE_PER_PAGE).toBe(100);
    for (let i = 0; i < PAGE_GATE_PER_PAGE; i++) {
      expect(
        takePageGateAttempt("o", "p", `10.0.${i >> 8}.${i & 255}`),
      ).not.toBeNull();
    }
    // A fresh IP is refused once the page-wide ceiling is reached; other pages are not.
    expect(takePageGateAttempt("o", "p", "9.9.9.9")).toBeNull();
    expect(pageGateRetryAfterS("o", "p", "9.9.9.9")).toBeGreaterThanOrEqual(1);
    expect(takePageGateAttempt("o", "p2", "9.9.9.9")).not.toBeNull();
  });

  it("a right password gives back both slots (WR-A02)", () => {
    for (let i = 0; i < PAGE_GATE_PER_PAGE + 5; i++) {
      const ip = `10.1.${i >> 8}.${i & 255}`;
      const t = takePageGateAttempt("o", "p", ip);
      expect(t).not.toBeNull();
      releasePageGateAttempt("o", "p", ip, t!);
    }
  });

  it("buckets IPv6 by /64 (WR-A02)", () => {
    for (let i = 0; i < PAGE_GATE_PER_IP_PAGE; i++) {
      expect(
        takePageGateAttempt("o", "p", `2001:db8:1:2::${i + 1}`),
      ).not.toBeNull();
    }
    expect(takePageGateAttempt("o", "p", "2001:db8:1:2:ffff::9")).toBeNull();
    expect(takePageGateAttempt("o", "p", "2001:db8:1:3::1")).not.toBeNull();
  });

  it("reset refuses outside VITEST", () => {
    const saved = process.env.VITEST;
    delete process.env.VITEST;
    try {
      expect(() => resetPageGateLimitsForTests()).toThrow(/test-only/);
    } finally {
      process.env.VITEST = saved;
    }
  });
});

// 12-01: support limiters (CONTEXT Area 6; T-12-01-03). Tickets and uploads per org per day,
// messages per person per hour.
describe("beginSupportAction", () => {
  beforeEach(() => resetSupportLimitsForTests());

  it("allows 20 tickets per org per day, then throws RATE-TICKETS; other orgs unaffected", () => {
    expect(SUPPORT_TICKETS_PER_ORG).toBe(20);
    for (let i = 0; i < SUPPORT_TICKETS_PER_ORG; i++) {
      expect(() =>
        beginSupportAction("ticket", { orgId: "orga" }),
      ).not.toThrow();
    }
    let err: unknown;
    try {
      beginSupportAction("ticket", { orgId: "orga" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RateLimited);
    expect((err as Error).message).toBe(SUPPORT_RATE_COPY.ticket);
    expect(SUPPORT_RATE_COPY.ticket).toBe(
      "Your site has sent a lot of tickets today. Add to an open ticket, or try again tomorrow.",
    );
    expect(() => beginSupportAction("ticket", { orgId: "orgb" })).not.toThrow();
  });

  it("allows 60 messages per person per hour, then throws RATE-MESSAGES", () => {
    expect(SUPPORT_MESSAGES_PER_PERSON).toBe(60);
    const who = { orgId: "orga", actorId: "u1" };
    for (let i = 0; i < SUPPORT_MESSAGES_PER_PERSON; i++) {
      expect(() => beginSupportAction("message", who)).not.toThrow();
    }
    expect(() => beginSupportAction("message", who)).toThrow(
      SUPPORT_RATE_COPY.message,
    );
    // Another person in the same org, and the same person in another org, are separate.
    expect(() =>
      beginSupportAction("message", { orgId: "orga", actorId: "u2" }),
    ).not.toThrow();
    expect(() =>
      beginSupportAction("message", { orgId: "orgb", actorId: "u1" }),
    ).not.toThrow();
  });

  it("allows 50 uploads per org per day, then throws RATE-UPLOADS", () => {
    expect(SUPPORT_UPLOADS_PER_ORG).toBe(50);
    for (let i = 0; i < SUPPORT_UPLOADS_PER_ORG; i++) {
      beginSupportAction("upload", { orgId: "orga", actorId: `u${i}` });
    }
    expect(() =>
      beginSupportAction("upload", { orgId: "orga", actorId: "other" }),
    ).toThrow(SUPPORT_RATE_COPY.upload);
  });

  it("windows expire: a day for tickets, an hour for messages", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < SUPPORT_TICKETS_PER_ORG; i++)
        beginSupportAction("ticket", { orgId: "orgt" });
      const who = { orgId: "orgt", actorId: "u1" };
      for (let i = 0; i < SUPPORT_MESSAGES_PER_PERSON; i++)
        beginSupportAction("message", who);
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);
      expect(() => beginSupportAction("message", who)).not.toThrow();
      expect(() => beginSupportAction("ticket", { orgId: "orgt" })).toThrow(
        RateLimited,
      );
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      expect(() =>
        beginSupportAction("ticket", { orgId: "orgt" }),
      ).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a message without an actor, or an unknown kind, fails closed", () => {
    expect(() => beginSupportAction("message", { orgId: "orga" })).toThrow(
      RateLimited,
    );
    expect(() =>
      beginSupportAction("bogus" as "ticket", { orgId: "orga" }),
    ).toThrow(RateLimited);
    expect(() => beginSupportAction("ticket", { orgId: "" })).toThrow(
      RateLimited,
    );
  });

  it("the reset helper is test-only", () => {
    vi.stubEnv("VITEST", "");
    try {
      expect(() => resetSupportLimitsForTests()).toThrow(/test-only/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("beginReportAction (13-30, P13-P24)", () => {
  beforeEach(() => resetReportLimitsForTests());

  it("allows 5 reports per IP per hour, then throws RATE-REPORT; another IP is unaffected", () => {
    expect(REPORT_PER_IP).toBe(5);
    expect(REPORT_RATE_COPY).toBe(
      "Too many reports from this connection. Try again in an hour, or email abuse@connectionsdesignstudios.com.",
    );
    for (let i = 0; i < REPORT_PER_IP; i++) {
      expect(() => beginReportAction("203.0.113.9")).not.toThrow();
    }
    let err: unknown;
    try {
      beginReportAction("203.0.113.9");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RateLimited);
    expect((err as Error).message).toBe(REPORT_RATE_COPY);
    expect(() => beginReportAction("198.51.100.7")).not.toThrow();
  });

  it("buckets an IPv6 /64 together and an empty IP into one shared bucket", () => {
    for (let i = 0; i < REPORT_PER_IP; i++) {
      beginReportAction(`2001:db8:1:2::${i + 1}`);
    }
    expect(() => beginReportAction("2001:db8:1:2::ff")).toThrow(
      REPORT_RATE_COPY,
    );
    for (let i = 0; i < REPORT_PER_IP; i++) beginReportAction("");
    expect(() => beginReportAction("")).toThrow(REPORT_RATE_COPY);
  });

  it("the window is an hour", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < REPORT_PER_IP; i++) beginReportAction("203.0.113.9");
      expect(() => beginReportAction("203.0.113.9")).toThrow(REPORT_RATE_COPY);
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);
      expect(() => beginReportAction("203.0.113.9")).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the reset is test-only", () => {
    vi.stubEnv("VITEST", "");
    try {
      expect(() => resetReportLimitsForTests()).toThrow(/test-only/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("beginContactAction (15-03, A3-Q2)", () => {
  beforeEach(() => {
    resetContactLimitsForTests();
    resetReportLimitsForTests();
  });

  it("allows 5 messages per IP per hour, then throws the UI-SPEC rate-limit copy", () => {
    expect(CONTACT_PER_IP).toBe(5);
    expect(CONTACT_RATE_COPY).toBe(
      "Too many messages from this connection. Try again in an hour, or email hello@connectionsdesignstudios.com.",
    );
    for (let i = 0; i < CONTACT_PER_IP; i++) {
      expect(() => beginContactAction("203.0.113.9")).not.toThrow();
    }
    let err: unknown;
    try {
      beginContactAction("203.0.113.9");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RateLimited);
    expect((err as Error).message).toBe(CONTACT_RATE_COPY);
    expect(() => beginContactAction("198.51.100.7")).not.toThrow();
  });

  it("buckets an IPv6 /64 together and leaves the report limiter alone", () => {
    for (let i = 0; i < CONTACT_PER_IP; i++) {
      beginContactAction(`2001:db8:1:2::${i + 1}`);
    }
    expect(() => beginContactAction("2001:db8:1:2:ffff::9")).toThrow(
      CONTACT_RATE_COPY,
    );
    expect(() => beginContactAction("2001:db8:1:3::1")).not.toThrow();
    expect(() => beginReportAction("2001:db8:1:2::1")).not.toThrow();
  });

  it("the window is an hour", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < CONTACT_PER_IP; i++)
        beginContactAction("203.0.113.9");
      expect(() => beginContactAction("203.0.113.9")).toThrow(
        CONTACT_RATE_COPY,
      );
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);
      expect(() => beginContactAction("203.0.113.9")).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the reset is test-only", () => {
    vi.stubEnv("VITEST", "");
    try {
      expect(() => resetContactLimitsForTests()).toThrow(/test-only/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("beginEdgeAskMiss (14-17, DOM-06; WR-A11)", () => {
  beforeEach(() => resetEdgeAskLimitsForTests());

  it("allows 120 misses per registrable domain per minute; another domain is unaffected", () => {
    expect(EDGE_ASK_MISSES_PER_DOMAIN).toBe(120);
    for (let i = 0; i < EDGE_ASK_MISSES_PER_DOMAIN; i++) {
      expect(() => beginEdgeAskMiss(`r${i}.attacker.example`)).not.toThrow();
    }
    expect(() => beginEdgeAskMiss("x.attacker.example")).toThrow(RateLimited);
    expect(() => beginEdgeAskMiss("ATTACKER.example.")).toThrow(RateLimited);
    expect(() => beginEdgeAskMiss("rivera-bakery.com")).not.toThrow();
  });

  it("the window is a minute", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < EDGE_ASK_MISSES_PER_DOMAIN; i++) {
        beginEdgeAskMiss(`r${i}.flood.example`);
      }
      expect(() => beginEdgeAskMiss("y.flood.example")).toThrow(RateLimited);
      vi.advanceTimersByTime(60 * 1000 + 1);
      expect(() => beginEdgeAskMiss("y.flood.example")).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the reset is test-only", () => {
    vi.stubEnv("VITEST", "");
    try {
      expect(() => resetEdgeAskLimitsForTests()).toThrow(/test-only/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
