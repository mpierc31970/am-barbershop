// 06-17 Task 2: Submit actions and the /start/submit page (ONB-08, ONB-12; D213, D215,
// D286; 06-UI-SPEC "Submit"; D-UI-P6-9; T-06-82..T-06-86). The real actions and page run
// against mocked next/headers, next/navigation, @cds/db and the catalog.
import { InvalidInput, RateLimited } from "@cds/core";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CookieOpts = Record<string, unknown>;

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sets: [] as { name: string; value: string; opts: CookieOpts }[],
  deletes: [] as string[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: (name: string, value: string, opts: CookieOpts) => {
      state.sets.push({ name, value, opts });
      state.jar.set(name, value);
    },
    delete: (arg: string | { name: string }) => {
      const name = typeof arg === "string" ? arg : arg.name;
      state.deletes.push(name);
      state.jar.delete(name);
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT:${to}`), {
      digest: `NEXT_REDIRECT;replace;${to};307;`,
    });
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));

const ERR_EMAIL =
  "That doesn't look like an email address. Check it and try again.";

const db = vi.hoisted(() => ({
  startSubmit: vi.fn(),
  completeSubmit: vi.fn(),
  requestMemberCode: vi.fn(),
  readQuoteByToken: vi.fn(),
  updateQuote: vi.fn(),
  publicCatalogView: vi.fn(),
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  QUOTE_TOKEN_RE: /^[A-Za-z0-9_-]{43}$/,
  ERR_CODE:
    "That code didn't match. Check the six digits and try again, or request a new one.",
  ERR_CODE_EXPIRED:
    "That code has expired. Codes last 5 minutes. Request a new one.",
  ERR_CREATE:
    "We couldn't create your account just now. Your quote is saved. Try again in a minute.",
  SUBMIT_RATE_COPY:
    "We've sent several codes to this address. Wait a minute, then try again.",
  ERR_HUMAN:
    "We couldn't confirm you're a person. Try again, or refresh the page.",
  SUBMIT_SUPPRESSED_COPY:
    "Emails to this address bounced before. Check the spelling, or use another address.",
}));
vi.mock("@cds/db", async () => {
  const { CdsError } = await import("@cds/core");
  class SubmitCodeInvalid extends CdsError {
    override readonly code = "submit_code_invalid";
  }
  class SubmitCodeExpired extends CdsError {
    override readonly code = "submit_code_expired";
  }
  class SubmitFailed extends CdsError {
    override readonly code = "submit_failed";
  }
  return {
    ...db,
    linkSecret: () => "t".repeat(40),
    SubmitCodeInvalid,
    SubmitCodeExpired,
    SubmitFailed,
  };
});

const REGISTRY = vi.hoisted(() => ({
  publicList: () => [],
  list: () => [], // 13-32: getCatalogView reads the manifests from list()
  get: () => undefined,
}));
vi.mock("@cds/addon-registry/server", () => ({ ADDON_REGISTRY: REGISTRY }));

const catalog = vi.hoisted(() => ({ getCatalog: vi.fn() }));
vi.mock("../lib/catalog", () => catalog);

const { startSubmitAction, completeSubmitAction, resendSubmitCodeAction } =
  await import("../app/actions/submit");
const { SEND_CODE_FAILED_COPY, SUBMIT_ADDON_CHANGED_COPY, SUBMIT_NAME_COPY } =
  await import("../lib/action");
const { CATALOG_UNAVAILABLE_COPY } = await import("../lib/catalog-view");
const { encodePendingCode, decodePendingCode } =
  await import("../lib/submit-cookie");
const dbMod = (await import("@cds/db")) as unknown as Record<
  string,
  new () => Error
>;
const SubmitCodeInvalid = dbMod.SubmitCodeInvalid!;
const SubmitCodeExpired = dbMod.SubmitCodeExpired!;
const SubmitFailed = dbMod.SubmitFailed!;
const { default: SubmitPage } =
  await import("../app/(platform)/start/submit/page");

const TOKEN = "a".repeat(43);
const DETAILS = { step: "details" as const, email: "", error: null };
const CODE = { step: "code" as const, email: "maria@example.com", error: null };

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const GOOD = {
  businessName: "Rivera Bakery",
  description: "Family bakery in Austin, known for sourdough.",
  email: "Maria@Example.com",
};

function withQuote() {
  state.jar.set("cds_quote", TOKEN);
}
function withPending(otpId = "otp123", email = "maria@example.com") {
  state.jar.set("cds_submit", encodePendingCode({ otpId, email }));
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const m = /^REDIRECT:(.*)$/.exec((err as Error).message);
    if (m) return m[1]!;
    throw err;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  state.jar.clear();
  state.sets.length = 0;
  state.deletes.length = 0;
  for (const fn of [
    db.startSubmit,
    db.completeSubmit,
    db.requestMemberCode,
    db.readQuoteByToken,
    db.updateQuote,
    db.publicCatalogView,
    catalog.getCatalog,
  ]) {
    fn.mockReset();
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("startSubmitAction (Step A)", () => {
  it("sends the code with the quote cookie and client IP, then sets cds_submit", async () => {
    withQuote();
    db.startSubmit.mockResolvedValue({
      otpId: "otp123",
      email: "maria@example.com",
    });
    const next = await startSubmitAction(
      DETAILS,
      form({ ...GOOD, "cf-turnstile-response": "human-token" }),
    );
    expect(db.startSubmit).toHaveBeenCalledWith({
      quoteToken: TOKEN,
      businessName: "Rivera Bakery",
      description: "Family bakery in Austin, known for sourdough.",
      email: "Maria@Example.com",
      ip: "203.0.113.9",
      humanToken: "human-token",
    });
    expect(next).toEqual({
      step: "code",
      email: "maria@example.com",
      error: null,
    });
    const set = state.sets.find((s) => s.name === "cds_submit")!;
    expect(set.opts).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      secure: false,
      maxAge: 600,
    });
    expect(decodePendingCode(set.value)).toEqual({
      otpId: "otp123",
      email: "maria@example.com",
    });
  });

  it("allow-lists the fields: an organization id in the form never reaches the chokepoint", async () => {
    withQuote();
    db.startSubmit.mockResolvedValue({ otpId: "o1", email: "m@example.com" });
    await startSubmitAction(
      DETAILS,
      form({ ...GOOD, organization: "orgX", orgId: "orgY", quoteToken: "x" }),
    );
    const arg = db.startSubmit.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(arg).sort()).toEqual(
      [
        "businessName",
        "description",
        "email",
        "humanToken",
        "ip",
        "quoteToken",
      ].sort(),
    );
    expect(arg.quoteToken).toBe(TOKEN);
  });

  it("gives the same state shape for a new and an existing address (T-06-82)", async () => {
    withQuote();
    db.startSubmit.mockResolvedValueOnce({ otpId: "new1", email: "a@x.com" });
    const a = await startSubmitAction(
      DETAILS,
      form({ ...GOOD, email: "a@x.com" }),
    );
    db.startSubmit.mockResolvedValueOnce({ otpId: "old1", email: "b@x.com" });
    const b = await startSubmitAction(
      DETAILS,
      form({ ...GOOD, email: "b@x.com" }),
    );
    expect(Object.keys(a)).toEqual(Object.keys(b));
    expect({ ...a, email: "" }).toEqual({ ...b, email: "" });
  });

  it("sends a visitor with no quote cookie back to /start", async () => {
    expect(await redirectOf(startSubmitAction(DETAILS, form(GOOD)))).toBe(
      "/start",
    );
    expect(db.startSubmit).not.toHaveBeenCalled();
  });

  it("shows ERR-EMAIL for a bad address", async () => {
    withQuote();
    db.startSubmit.mockRejectedValue(new InvalidInput(ERR_EMAIL));
    const next = await startSubmitAction(DETAILS, form(GOOD));
    expect(next).toMatchObject({
      step: "details",
      error: ERR_EMAIL,
      field: "email",
    });
    expect(state.sets.some((s) => s.name === "cds_submit")).toBe(false);
  });

  it("a failed human check shows ERR-HUMAN above the button; a suppressed address sits on the email field (A-WR-02)", async () => {
    withQuote();
    db.startSubmit.mockRejectedValue(new InvalidInput(db.ERR_HUMAN));
    const human = await startSubmitAction(DETAILS, form(GOOD));
    expect(human).toMatchObject({ step: "details", error: db.ERR_HUMAN });
    expect(human.field).toBeUndefined();
    db.startSubmit.mockRejectedValue(
      new InvalidInput(db.SUBMIT_SUPPRESSED_COPY),
    );
    expect(await startSubmitAction(DETAILS, form(GOOD))).toMatchObject({
      step: "details",
      error: db.SUBMIT_SUPPRESSED_COPY,
      field: "email",
    });
  });

  it("shows ERR-CODE-RATE when rate limited", async () => {
    withQuote();
    db.startSubmit.mockRejectedValue(new RateLimited(db.SUBMIT_RATE_COPY));
    const next = await startSubmitAction(DETAILS, form(GOOD));
    expect(next.error).toBe(db.SUBMIT_RATE_COPY);
  });

  it("checks the business name before calling the chokepoint", async () => {
    withQuote();
    const next = await startSubmitAction(
      DETAILS,
      form({ ...GOOD, businessName: "  " }),
    );
    expect(next).toMatchObject({
      error: SUBMIT_NAME_COPY,
      field: "businessName",
    });
    expect(db.startSubmit).not.toHaveBeenCalled();
  });

  it("shows ERR-SEND-CODE for anything else", async () => {
    withQuote();
    db.startSubmit.mockRejectedValue(new Error("pb down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const next = await startSubmitAction(DETAILS, form(GOOD));
    spy.mockRestore();
    expect(next.error).toBe(SEND_CODE_FAILED_COPY);
  });
});

describe("completeSubmitAction (Step B)", () => {
  it("created: sets the session, clears the submit and quote cookies, goes to /hub/setup", async () => {
    withQuote();
    withPending();
    db.completeSubmit.mockResolvedValue({
      outcome: "created",
      token: "pbtoken",
      orgId: "org1",
      stage: "intake",
    });
    const to = await redirectOf(
      completeSubmitAction(CODE, form({ code: "123 456" })),
    );
    expect(to).toBe("/hub/setup");
    expect(db.completeSubmit).toHaveBeenCalledWith(
      { quoteToken: TOKEN, otpId: "otp123", code: "123456", ip: "203.0.113.9" },
      { registry: REGISTRY },
    );
    expect(state.jar.get("cds_session")).toBe("pbtoken");
    expect(state.jar.get("cds_auth_method")).toMatch(
      /^otp\.[A-Za-z0-9_-]{43}$/,
    );
    expect(state.deletes).toEqual(
      expect.arrayContaining(["cds_submit", "cds_quote"]),
    );
  });

  it("held (fit_review) also lands in /hub/setup", async () => {
    withQuote();
    withPending();
    db.completeSubmit.mockResolvedValue({
      outcome: "created",
      token: "t",
      orgId: "o",
      stage: "fit_review",
    });
    expect(
      await redirectOf(completeSubmitAction(CODE, form({ code: "123456" }))),
    ).toBe("/hub/setup");
  });

  it("existing owner: signs in and goes to /hub?notice=existing-owner", async () => {
    withQuote();
    withPending();
    db.completeSubmit.mockResolvedValue({
      outcome: "existing_owner",
      token: "owner-token",
      orgId: "org9",
    });
    expect(
      await redirectOf(completeSubmitAction(CODE, form({ code: "123456" }))),
    ).toBe("/hub?notice=existing-owner");
    expect(state.jar.get("cds_session")).toBe("owner-token");
  });

  it("blocked: stays with the category and no session cookie", async () => {
    withQuote();
    withPending();
    db.completeSubmit.mockResolvedValue({
      outcome: "blocked",
      category: "Adult content",
    });
    const next = await completeSubmitAction(CODE, form({ code: "123456" }));
    expect(next).toEqual({
      step: "blocked",
      email: "maria@example.com",
      category: "Adult content",
      error: null,
    });
    expect(state.jar.has("cds_session")).toBe(false);
    expect(state.deletes).toContain("cds_submit");
  });

  it.each([
    ["SubmitCodeInvalid", () => new SubmitCodeInvalid(), db.ERR_CODE],
    ["SubmitCodeExpired", () => new SubmitCodeExpired(), db.ERR_CODE_EXPIRED],
    [
      "RateLimited",
      () => new RateLimited(db.SUBMIT_RATE_COPY),
      db.SUBMIT_RATE_COPY,
    ],
    ["SubmitFailed", () => new SubmitFailed(), db.ERR_CREATE],
    ["anything else", () => new Error("boom"), db.ERR_CREATE],
  ])("maps %s to its copy", async (_name, make, copy) => {
    withQuote();
    withPending();
    db.completeSubmit.mockRejectedValue(make());
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const next = await completeSubmitAction(CODE, form({ code: "123456" }));
    spy.mockRestore();
    expect(next).toMatchObject({ step: "code", error: copy });
    expect(state.jar.has("cds_session")).toBe(false);
  });

  it("refuses a code that is not six digits without spending an attempt", async () => {
    withQuote();
    withPending();
    const next = await completeSubmitAction(CODE, form({ code: "12a4" }));
    expect(next.error).toBe(db.ERR_CODE);
    expect(db.completeSubmit).not.toHaveBeenCalled();
  });

  it("treats a missing pending cookie as an expired code", async () => {
    withQuote();
    const next = await completeSubmitAction(CODE, form({ code: "123456" }));
    expect(next.error).toBe(db.ERR_CODE_EXPIRED);
    expect(db.completeSubmit).not.toHaveBeenCalled();
  });
});

describe("resendSubmitCodeAction", () => {
  it("asks for a fresh code for the pending address and stores the new otpId", async () => {
    withQuote();
    withPending();
    db.requestMemberCode.mockResolvedValue({ otpId: "otp999" });
    expect(await resendSubmitCodeAction()).toEqual({ error: null });
    expect(db.requestMemberCode).toHaveBeenCalledWith(
      "maria@example.com",
      "203.0.113.9",
    );
    expect(decodePendingCode(state.jar.get("cds_submit"))?.otpId).toBe(
      "otp999",
    );
  });

  it("a failed human check shows ERR-HUMAN above the button; a suppressed address sits on the email field (A-WR-02)", async () => {
    withQuote();
    db.startSubmit.mockRejectedValue(new InvalidInput(db.ERR_HUMAN));
    const human = await startSubmitAction(DETAILS, form(GOOD));
    expect(human).toMatchObject({ step: "details", error: db.ERR_HUMAN });
    expect(human.field).toBeUndefined();
    db.startSubmit.mockRejectedValue(
      new InvalidInput(db.SUBMIT_SUPPRESSED_COPY),
    );
    expect(await startSubmitAction(DETAILS, form(GOOD))).toMatchObject({
      step: "details",
      error: db.SUBMIT_SUPPRESSED_COPY,
      field: "email",
    });
  });

  it("shows ERR-CODE-RATE when rate limited", async () => {
    withQuote();
    withPending();
    db.requestMemberCode.mockRejectedValue(
      new RateLimited(db.SUBMIT_RATE_COPY),
    );
    expect(await resendSubmitCodeAction()).toEqual({
      error: db.SUBMIT_RATE_COPY,
    });
  });
});

describe("/start/submit page", () => {
  const QUOTE = {
    id: "q1",
    status: "saved",
    path: "standard",
    businessType: "bakery",
    businessTypeOther: "",
    selections: { addons: [], extras: [], carePlan: false, cadence: "monthly" },
    totals: null,
    email: "maria@example.com",
    savedAt: null,
    expiresAt: null,
    updatedAt: new Date(0),
    businessName: "",
    description: "",
  };

  it("sends a visitor without a quote back to /start", async () => {
    expect(await redirectOf(SubmitPage())).toBe("/start");
  });

  it("renders Step A with the saved email, the no-terms line and the read-only receipt", async () => {
    withQuote();
    db.readQuoteByToken.mockResolvedValue(QUOTE);
    catalog.getCatalog.mockResolvedValue([]);
    const html = renderToStaticMarkup(await SubmitPage());
    expect(html).toContain("Almost there");
    expect(html).toContain(
      "Tell us who you are. We&#x27;ll email you a code to create your account. Nothing is charged today.",
    );
    expect(html).toContain('value="maria@example.com"');
    expect(html).toContain("Email me a code");
    expect(html).toContain(
      "You&#x27;ll see the agreement and pay only at checkout, after CDS has confirmed your site.",
    );
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("Change your quote");
    expect(html).toContain("<details");
    expect(html).not.toContain("Review and submit");
  });

  it("opens on the code step when a code is pending (reload)", async () => {
    withQuote();
    withPending("otp1", "maria@example.com");
    db.readQuoteByToken.mockResolvedValue(QUOTE);
    catalog.getCatalog.mockResolvedValue([]);
    const html = renderToStaticMarkup(await SubmitPage());
    expect(html).toContain(
      "We sent a 6-digit code to maria@example.com. It expires in 5 minutes.",
    );
  });
});

describe("coming-soon and hidden add-ons in a stored quote (CR-D01)", () => {
  const listed = (slug: string, pickable: boolean) => ({
    slug,
    name: slug,
    tagline: "",
    description: "",
    screenshots: [],
    availability: pickable ? "available" : "coming_soon",
    sort: 1,
    pickable,
    private: false,
    path: "standard",
    premium: false,
  });
  const STORED = {
    id: "q1",
    status: "saved",
    path: "standard",
    businessType: "bakery",
    businessTypeOther: "",
    selections: {
      addons: ["fixture-open", "fixture-soon"],
      extras: [],
      carePlan: false,
      cadence: "monthly",
    },
    totals: null,
    email: "maria@example.com",
    savedAt: null,
    expiresAt: null,
    updatedAt: new Date(0),
    businessName: "",
    description: "",
  };

  it("Step A refuses a quote whose add-on is now coming soon; no code is sent", async () => {
    withQuote();
    db.readQuoteByToken.mockResolvedValue(STORED);
    db.publicCatalogView.mockResolvedValue([
      listed("fixture-open", true),
      listed("fixture-soon", false),
    ]);
    const next = await startSubmitAction(DETAILS, form(GOOD));
    expect(next.error).toBe(SUBMIT_ADDON_CHANGED_COPY);
    expect(db.startSubmit).not.toHaveBeenCalled();
  });

  it("Step A fails closed while the listing can't be read (WR-D09)", async () => {
    withQuote();
    db.readQuoteByToken.mockResolvedValue(STORED);
    db.publicCatalogView.mockRejectedValue(new TypeError("down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const next = await startSubmitAction(DETAILS, form(GOOD));
    log.mockRestore();
    expect(next.error).toBe(CATALOG_UNAVAILABLE_COPY);
    expect(db.startSubmit).not.toHaveBeenCalled();
  });

  it("Step B refuses a hidden add-on (absent from the view) before creating anything", async () => {
    withQuote();
    withPending();
    db.readQuoteByToken.mockResolvedValue(STORED);
    db.publicCatalogView.mockResolvedValue([listed("fixture-open", true)]);
    const next = await completeSubmitAction(CODE, form({ code: "123456" }));
    expect(next).toMatchObject({
      step: "code",
      error: SUBMIT_ADDON_CHANGED_COPY,
    });
    expect(db.completeSubmit).not.toHaveBeenCalled();
  });

  it("the page drops the add-on from the stored quote and sends the visitor to /start", async () => {
    withQuote();
    db.readQuoteByToken.mockResolvedValue(STORED);
    db.publicCatalogView.mockResolvedValue([
      listed("fixture-open", true),
      listed("fixture-soon", false),
    ]);
    catalog.getCatalog.mockResolvedValue([]);
    expect(await redirectOf(SubmitPage())).toBe("/start");
    expect(db.updateQuote).toHaveBeenCalledTimes(1);
    const [token, patch] = db.updateQuote.mock.calls[0]!;
    expect(token).toBe(TOKEN);
    expect(patch).toEqual({
      selections: { ...STORED.selections, addons: ["fixture-open"] },
    });
  });
});
