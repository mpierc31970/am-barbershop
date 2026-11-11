// 06-15 Task 2: save the quote by email and the JS-off form (ONB-08, D213; CONTEXT A1-Q3;
// 06-UI-SPEC "Save your quote card", Copywriting ERR-EMAIL, ERR-HUMAN, RATE-SAVE,
// "Configurator states" JS off; D-UI-P6-36; T-06-74). The real actions run against mocked
// next/headers, next/navigation and @cds/db; NoScriptQuoteForm renders to static markup.
import { InvalidInput, NotFound, RateLimited } from "@cds/core";
import { EXTRAS, PATHS } from "@cds/core/onboarding";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: (name: string, value: string) => {
      state.jar.set(name, value);
    },
    delete: () => {},
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));

const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));
vi.mock("next/navigation", () => nav);

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));

const db = vi.hoisted(() => ({
  createQuote: vi.fn(),
  updateQuote: vi.fn(),
  readQuoteByToken: vi.fn(),
  saveQuoteEmail: vi.fn(),
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  // 13-32: the quote action checks slugs against the merged catalog view. A failed listing
  // read refuses adding (WR-D09), so the mock lists both manifests as available.
  publicCatalogView: vi.fn(async (manifests: { slug: string }[]) =>
    manifests.map((m) => ({ slug: m.slug, sort: 1, pickable: true })),
  ),
  QUOTE_TOKEN_RE: /^[A-Za-z0-9_-]{43}$/,
}));
vi.mock("@cds/db", () => db);

// The manifests the catalog view reads (ADDON_REGISTRY.list()).
const REGISTRY = vi.hoisted(() => {
  const m = (slug: string) => ({
    slug,
    name: slug,
    summary: slug,
    visibility: "public",
    paths: ["standard", "studio"],
  });
  return {
    publicList: () => [],
    list: () => [m("testimonials"), m("credentials")],
  };
});
vi.mock("@cds/addon-registry/server", () => ({ ADDON_REGISTRY: REGISTRY }));

const { saveQuoteAction, updateQuoteFormAction } =
  await import("../app/actions/quote");
const { QUOTE_FAILED_COPY, QUOTE_RATE_LIMITED_COPY } =
  await import("../lib/action");
const { NoScriptQuoteForm } =
  await import("../app/(platform)/start/_components/NoScriptQuoteForm");

const TOKEN = "a".repeat(43);
const ERR_EMAIL =
  "That doesn't look like an email address. Check it and try again.";
const ERR_HUMAN =
  "We couldn't confirm you're a person. Try again, or refresh the page.";
const IDLE = { status: "idle" as const, email: null, error: null };
const SELECTIONS = {
  addons: [] as string[],
  extras: [] as string[],
  carePlan: false,
  cadence: "monthly" as const,
};

function quote(over: Record<string, unknown> = {}) {
  return {
    id: "q1",
    status: "draft" as const,
    path: "standard" as const,
    businessType: "",
    businessTypeOther: "",
    selections: SELECTIONS,
    totals: null,
    email: "",
    savedAt: null,
    expiresAt: null,
    updatedAt: new Date(0),
    businessName: "",
    description: "",
    ...over,
  };
}

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  }
  return fd;
}

async function redirectedTo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as { url?: string }).url ?? "";
  }
  return "";
}

beforeEach(() => {
  state.jar.clear();
  state.jar.set("cds_quote", TOKEN);
  for (const fn of [
    db.createQuote,
    db.updateQuote,
    db.readQuoteByToken,
    db.saveQuoteEmail,
  ]) {
    fn.mockReset();
  }
  nav.redirect.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveQuoteAction", () => {
  it("without a quote cookie returns ERR-QUOTE and saves nothing", async () => {
    state.jar.clear();
    const res = await saveQuoteAction(IDLE, form({ email: "a@b.test" }));
    expect(res).toEqual({
      status: "idle",
      email: null,
      error: QUOTE_FAILED_COPY,
    });
    expect(db.saveQuoteEmail).not.toHaveBeenCalled();
  });

  it("a bad address gets the ERR-EMAIL copy", async () => {
    db.saveQuoteEmail.mockRejectedValue(new InvalidInput(ERR_EMAIL));
    const res = await saveQuoteAction(IDLE, form({ email: "bad" }));
    expect(res.status).toBe("idle");
    expect(res.error).toBe(ERR_EMAIL);
  });

  it("a failed human check gets the ERR-HUMAN copy", async () => {
    db.saveQuoteEmail.mockRejectedValue(new InvalidInput(ERR_HUMAN));
    const res = await saveQuoteAction(
      IDLE,
      form({ email: "maria@example.com", "cf-turnstile-response": "nope" }),
    );
    expect(res.error).toBe(ERR_HUMAN);
  });

  it("rate limited gets RATE-SAVE", async () => {
    db.saveQuoteEmail.mockRejectedValue(new RateLimited("slow"));
    const res = await saveQuoteAction(
      IDLE,
      form({ email: "maria@example.com" }),
    );
    expect(res.error).toBe(QUOTE_RATE_LIMITED_COPY);
  });

  it("passes the cookie token, email, Turnstile token, client IP and registry, then reports saved", async () => {
    db.saveQuoteEmail.mockResolvedValue(
      quote({ status: "saved", email: "maria@example.com" }),
    );
    const res = await saveQuoteAction(
      IDLE,
      form({
        email: "  maria@example.com ",
        "cf-turnstile-response": "XXXX.DUMMY.TOKEN",
      }),
    );
    expect(res).toEqual({
      status: "saved",
      email: "maria@example.com",
      error: null,
    });
    expect(db.saveQuoteEmail).toHaveBeenCalledWith(
      TOKEN,
      "maria@example.com",
      "XXXX.DUMMY.TOKEN",
      "203.0.113.9",
      { registry: REGISTRY },
    );
  });

  it("an unexpected failure is ERR-QUOTE and the log never carries the address", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.saveQuoteEmail.mockRejectedValue(
      new NotFound("quote maria@example.com gone"),
    );
    const res = await saveQuoteAction(
      IDLE,
      form({ email: "maria@example.com" }),
    );
    expect(res.error).toBe(QUOTE_FAILED_COPY);
    expect(JSON.stringify(log.mock.calls)).not.toContain("maria@example.com");
  });
});

describe("updateQuoteFormAction (JS off)", () => {
  it("parses addons[] / extras[] / Care Plan / cadence, applies them and redirects to /start", async () => {
    db.updateQuote.mockResolvedValue({ quote: quote(), removed: [] });
    const url = await redirectedTo(
      updateQuoteFormAction(
        form({
          path: "standard",
          businessType: "therapist",
          businessTypeOther: "ignored",
          hasSelections: "1",
          addons: ["testimonials", "credentials"],
          extras: ["copywriting"],
          carePlan: "on",
          cadence: "yearly",
        }),
      ),
    );
    expect(url).toBe("/start");
    expect(db.updateQuote).toHaveBeenCalledWith(
      TOKEN,
      {
        path: "standard",
        businessType: "therapist",
        selections: {
          addons: ["testimonials", "credentials"],
          extras: ["copywriting"],
          carePlan: true,
          cadence: "yearly",
        },
      },
      "203.0.113.9",
      { registry: REGISTRY },
    );
  });

  it("an early step never sends selections; 'Something else' without text is left out", async () => {
    db.updateQuote.mockResolvedValue({ quote: quote(), removed: [] });
    await redirectedTo(
      updateQuoteFormAction(
        form({ path: "studio", businessType: "other", businessTypeOther: "" }),
      ),
    );
    expect(db.updateQuote.mock.calls[0]![1]).toEqual({ path: "studio" });
  });

  it("a first path with no cookie creates the quote; an unknown path is ignored", async () => {
    state.jar.clear();
    db.createQuote.mockResolvedValue({ token: "c".repeat(43), quote: quote() });
    await redirectedTo(updateQuoteFormAction(form({ path: "standard" })));
    expect(db.createQuote).toHaveBeenCalledTimes(1);
    const url = await redirectedTo(
      updateQuoteFormAction(form({ path: "shop-x" })),
    );
    expect(url).toBe("/start");
    expect(db.updateQuote).not.toHaveBeenCalled();
  });

  it("a failed save comes back as ?e=quote", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.updateQuote.mockRejectedValue(new Error("boom"));
    const url = await redirectedTo(
      updateQuoteFormAction(form({ businessType: "therapist" })),
    );
    expect(url).toBe("/start?e=quote");
  });
});

describe("NoScriptQuoteForm", () => {
  function html(props: Record<string, unknown>) {
    return renderToStaticMarkup(
      createElement(NoScriptQuoteForm, {
        quote: null,
        catalog: [],
        addons: [],
        paths: PATHS,
        extras: EXTRAS,
        ...props,
      } as Parameters<typeof NoScriptQuoteForm>[0]),
    );
  }

  it("renders real inputs, one Update my quote submit and the server receipt", () => {
    const out = html({
      quote: quote({ businessType: "therapist" }),
      catalog: [
        {
          itemKind: "plan",
          itemKey: "base",
          path: "standard",
          monthlyCents: 3900,
          oneTimeCents: null,
          installments: null,
        },
        {
          itemKind: "build_fee",
          itemKey: "base",
          path: "standard",
          monthlyCents: null,
          oneTimeCents: 150000,
          installments: 6,
        },
      ],
    });
    expect(out).toContain("<form");
    expect(out.match(/Update my quote/g)).toHaveLength(1);
    expect(out).toMatch(/type="radio"[^>]*name="path"[^>]*value="standard"/);
    expect(out).toMatch(/name="businessType" checked="" value="therapist"/);
    expect(out).toContain('name="hasSelections"');
    expect(out).toMatch(/name="cadence" value="yearly"/);
    expect(out).toContain("Due at checkout");
    expect(out).toContain("$1,539");
    expect(out).not.toContain('role="switch"');
  });

  it("first visit: only the path choice and the empty receipt; ?e=quote shows ERR-QUOTE", () => {
    const out = html({ failed: true });
    expect(out).not.toContain('name="businessType"');
    expect(out).not.toContain('name="hasSelections"');
    expect(out).toContain(
      "Pick a path to see your price. Every figure here is the real price, before you commit.",
    );
    expect(out).toContain(QUOTE_FAILED_COPY.replaceAll("'", "&#x27;"));
  });
});
