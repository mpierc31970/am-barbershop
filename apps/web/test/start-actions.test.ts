// 06-14 Task 1: the /start quote cookie and chooseQuoteAction (ONB-06, ONB-08; CONTEXT A1-Q2;
// UI-SPEC ERR-QUOTE, RATE-QUOTE; T-06-69..T-06-73). The real cookie module and action run
// against mocked next/headers and @cds/db; the registry is a stand-in object (the action
// only passes it through to the chokepoint).
import { InvalidInput, NotFound, RateLimited } from "@cds/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SetCall = { name: string; value: string; opts: Record<string, unknown> };

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sets: [] as SetCall[],
  deletes: [] as unknown[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: (name: string, value: string, opts: Record<string, unknown>) => {
      state.sets.push({ name, value, opts });
      state.jar.set(name, value);
    },
    delete: (arg: unknown) => {
      state.deletes.push(arg);
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const db = vi.hoisted(() => ({
  createQuote: vi.fn(),
  updateQuote: vi.fn(),
  readQuoteByToken: vi.fn(),
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  QUOTE_TOKEN_RE: /^[A-Za-z0-9_-]{43}$/,
}));
vi.mock("@cds/db", () => db);

const REGISTRY = vi.hoisted(() => ({ publicList: () => [] }));
vi.mock("@cds/addon-registry/server", () => ({ ADDON_REGISTRY: REGISTRY }));

const { chooseQuoteAction } = await import("../app/actions/quote");
const { quoteCookieName, readQuoteCookie } =
  await import("../lib/quote-cookie");
const { QUOTE_FAILED_COPY, QUOTE_RATE_LIMITED_COPY } =
  await import("../lib/action");

const TOKEN = "a".repeat(43);
const FRESH = "b".repeat(43);
const QUOTE = {
  id: "q1",
  status: "draft",
  path: "standard",
  businessType: "",
  businessTypeOther: "",
  selections: { addons: [], extras: [], carePlan: false, cadence: "monthly" },
  totals: null,
};

beforeEach(() => {
  state.jar.clear();
  state.sets.length = 0;
  state.deletes.length = 0;
  for (const fn of [db.createQuote, db.updateQuote, db.readQuoteByToken]) {
    fn.mockReset();
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("quote cookie", () => {
  it("is cds_quote outside production and __Host-cds_quote in production", () => {
    expect(quoteCookieName()).toBe("cds_quote");
    vi.stubEnv("NODE_ENV", "production");
    expect(quoteCookieName()).toBe("__Host-cds_quote");
  });

  it("ignores a cookie that is not a well-shaped token", async () => {
    state.jar.set("cds_quote", "junk");
    expect(await readQuoteCookie()).toBeNull();
    state.jar.set("cds_quote", TOKEN);
    expect(await readQuoteCookie()).toBe(TOKEN);
  });
});

describe("chooseQuoteAction", () => {
  it("no cookie + a path: creates the quote with the client IP and sets the cookie", async () => {
    db.createQuote.mockResolvedValue({ token: FRESH, quote: QUOTE });
    const res = await chooseQuoteAction({ path: "standard" });
    expect(db.createQuote).toHaveBeenCalledWith(
      { path: "standard", ip: "203.0.113.9" },
      { registry: REGISTRY },
    );
    expect(res).toEqual({ quote: QUOTE, removed: [], error: null });
    expect(state.sets).toHaveLength(1);
    expect(state.sets[0]).toMatchObject({
      name: "cds_quote",
      value: FRESH,
      opts: { httpOnly: true, sameSite: "lax", path: "/", secure: false },
    });
    expect(state.sets[0]!.opts.maxAge).toBe(30 * 24 * 60 * 60);
    // The raw token never comes back to the browser.
    expect(JSON.stringify(res)).not.toContain(FRESH);
  });

  it("in production the cookie is __Host- prefixed and Secure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    db.createQuote.mockResolvedValue({ token: FRESH, quote: QUOTE });
    await chooseQuoteAction({ path: "studio" });
    expect(state.sets[0]).toMatchObject({
      name: "__Host-cds_quote",
      opts: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
    });
  });

  it("a valid cookie updates the quote and returns removed add-ons", async () => {
    state.jar.set("cds_quote", TOKEN);
    db.updateQuote.mockResolvedValue({
      quote: { ...QUOTE, path: "studio" },
      removed: ["fixture-appointments"],
    });
    const res = await chooseQuoteAction({ path: "studio" });
    expect(db.updateQuote).toHaveBeenCalledWith(
      TOKEN,
      { path: "studio" },
      "203.0.113.9",
      { registry: REGISTRY },
    );
    expect(db.createQuote).not.toHaveBeenCalled();
    expect(res.removed).toEqual(["fixture-appointments"]);
    expect(res.error).toBeNull();
    expect(state.sets).toHaveLength(0);
  });

  it("an expired cookie with a path starts a new quote and replaces the cookie", async () => {
    state.jar.set("cds_quote", TOKEN);
    db.updateQuote.mockRejectedValue(new NotFound("This quote has expired."));
    db.createQuote.mockResolvedValue({ token: FRESH, quote: QUOTE });
    const res = await chooseQuoteAction({ path: "standard" });
    expect(db.createQuote).toHaveBeenCalledOnce();
    expect(state.sets[0]?.value).toBe(FRESH);
    expect(res.quote).toEqual(QUOTE);
  });

  it("a new quote that carries more than the path applies the rest to it", async () => {
    db.createQuote.mockResolvedValue({ token: FRESH, quote: QUOTE });
    db.updateQuote.mockResolvedValue({
      quote: { ...QUOTE, businessType: "coach" },
      removed: [],
    });
    const res = await chooseQuoteAction({
      path: "standard",
      businessType: "coach",
    });
    expect(db.updateQuote).toHaveBeenCalledWith(
      FRESH,
      { businessType: "coach" },
      "203.0.113.9",
      { registry: REGISTRY },
    );
    expect(res.quote?.businessType).toBe("coach");
  });

  it("an expired cookie without a path returns ERR-QUOTE and creates nothing", async () => {
    state.jar.set("cds_quote", TOKEN);
    db.updateQuote.mockRejectedValue(new NotFound("This quote has expired."));
    const res = await chooseQuoteAction({ businessType: "coach" });
    expect(db.createQuote).not.toHaveBeenCalled();
    expect(res).toEqual({ quote: null, removed: [], error: QUOTE_FAILED_COPY });
  });

  it("no cookie and no path returns ERR-QUOTE", async () => {
    const res = await chooseQuoteAction({ selections: { addons: [] } });
    expect(res.error).toBe(QUOTE_FAILED_COPY);
    expect(db.createQuote).not.toHaveBeenCalled();
  });

  it("a submitted quote in the cookie starts a new quote on a path choice", async () => {
    state.jar.set("cds_quote", TOKEN);
    db.updateQuote.mockRejectedValue(
      new InvalidInput("This quote has been submitted and can't be changed."),
    );
    db.readQuoteByToken.mockResolvedValue({ ...QUOTE, status: "submitted" });
    db.createQuote.mockResolvedValue({ token: FRESH, quote: QUOTE });
    const res = await chooseQuoteAction({ path: "standard" });
    expect(db.createQuote).toHaveBeenCalledOnce();
    expect(res.error).toBeNull();
  });

  it("RateLimited maps to RATE-QUOTE copy", async () => {
    db.createQuote.mockRejectedValue(new RateLimited("x"));
    const res = await chooseQuoteAction({ path: "standard" });
    expect(QUOTE_RATE_LIMITED_COPY).toBe(
      "You're going a little fast. Wait a minute, then try again.",
    );
    expect(res.error).toBe(QUOTE_RATE_LIMITED_COPY);
  });

  it("InvalidInput passes its message through", async () => {
    state.jar.set("cds_quote", TOKEN);
    db.updateQuote.mockRejectedValue(
      new InvalidInput("Pick a business type from the list."),
    );
    const res = await chooseQuoteAction({ businessType: "nope" });
    expect(res.error).toBe("Pick a business type from the list.");
  });

  it("any other failure is ERR-QUOTE and the log never holds the token", async () => {
    state.jar.set("cds_quote", TOKEN);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.updateQuote.mockRejectedValue(new Error(`boom ${TOKEN}`));
    const res = await chooseQuoteAction({ businessType: "coach" });
    expect(res.error).toBe(QUOTE_FAILED_COPY);
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it("refuses unknown patch keys and non-object patches without touching the database", async () => {
    for (const bad of [
      { orgId: "org1", path: "standard" },
      null,
      "standard",
      { path: 7 },
      { businessTypeOther: 12 },
    ]) {
      const res = await chooseQuoteAction(bad as never);
      expect(res.error).toBe(
        "That quote doesn't look right. Refresh the page and try again.",
      );
    }
    expect(db.createQuote).not.toHaveBeenCalled();
    expect(db.updateQuote).not.toHaveBeenCalled();
  });
});
