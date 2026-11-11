// 10-30 Task 1: the owner's quote page and its Server Actions (BILL-20; D297, D299;
// T-10-30-01..03). The page renders with a mocked session and @cds/db; the actions run the real
// session module against mocked next/headers and @cds/db.
import { NotFound, Forbidden, InvalidInput } from "@cds/core";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  pageSession: null as unknown,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  usePathname: () => "/hub/settings/quotes/x",
}));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  readWorkOrder: vi.fn(),
  acceptWorkOrder: vi.fn(),
  declineWorkOrder: vi.fn(),
  billingTabCounts: vi.fn(),
}));
vi.mock("@cds/db", () => db);

// The page test controls the session directly; the action test uses the real module.
vi.mock("../lib/session", async (orig) => {
  const real = await orig<typeof import("../lib/session")>();
  return {
    ...real,
    requireHubSession: async () => {
      if (!state.pageSession) throw new Error("no page session");
      return state.pageSession;
    },
  };
});

// SettingsFrame / GuardedLink need the hub's save scope and router; not under test here.
vi.mock("../app/(platform)/hub/settings/SettingsPanels", () => ({
  SettingsFrame: ({
    tabBar,
    children,
  }: {
    tabBar: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      {tabBar}
      {children}
    </div>
  ),
}));
vi.mock("../app/(platform)/hub/GuardedLink", () => ({
  GuardedLink: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { default: QuotePage } =
  await import("../app/(platform)/hub/settings/quotes/[id]/page");
const { acceptAndOpen } =
  await import("../app/(platform)/hub/settings/quotes/[id]/QuotePanel");
const { acceptQuoteAction, declineQuoteAction } =
  await import("../app/actions/work-orders");

const ID = "wo0000000000001";
const OWNER = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const ORG = { id: "org1", name: "Palm", primaryHost: "palm.example" };

function view(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    title: "Homepage design polish",
    status: "sent",
    metaLine: "Quote from CDS · Sent 8 Oct 2026 · Valid until 7 Nov 2026",
    scopeHtml: "<p>Tighten the hero.</p>",
    kind: "polish",
    priceRows: [
      {
        label: "Design polish, 3-hour block · 3 h × $120",
        amountLabel: "$360",
      },
    ],
    payNowCents: 36000,
    acceptedLabel: null,
    deliveredLabel: null,
    statusDateLabel: null,
    payHref: null,
    canAct: true,
    impersonating: false,
    ...over,
  };
}

function session(ctx: Record<string, unknown>) {
  state.pageSession = { ctx, email: "o@palm.example", org: ORG };
}

async function render(id = ID): Promise<string> {
  const el = await QuotePage({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.jar.clear();
  state.jar.set("cds_session", "tok");
  session(OWNER);
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "o@palm.example",
    organizations: [ORG],
  });
  db.orgContextFromToken.mockResolvedValue(OWNER);
  db.billingTabCounts.mockResolvedValue({ payments: 0, billing: 1 });
  db.readWorkOrder.mockResolvedValue(view());
});

describe("quote page", () => {
  it("owner, sent quote: back link, Billing tab active, scope, price, unticked accept", async () => {
    const html = await render();
    expect(html).toContain('href="/hub/settings?tab=billing"');
    expect(html).toContain("Billing");
    expect(html).toContain("Billing · 1");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Homepage design polish");
    expect(html).toContain("<p>Tighten the hero.</p>");
    expect(html).toContain("Design polish, 3-hour block");
    expect(html).toContain("Accept and pay $360");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Tick the box above to accept.");
    expect(html).toContain("Decline this quote");
    expect(html).not.toMatch(/checked=""/);
    expect(db.readWorkOrder).toHaveBeenCalledWith(OWNER, ID);
  });

  it.each(["admin", "editor", "viewer"])("%s goes to /hub", async (role) => {
    session({ ...OWNER, role });
    await expect(render()).rejects.toThrow("REDIRECT:/hub");
    expect(db.readWorkOrder).not.toHaveBeenCalled();
  });

  it("impersonating staff: read-only with IMPERSONATING-PAY", async () => {
    session({ ...OWNER, impersonator: "staff1" });
    db.readWorkOrder.mockResolvedValue(
      view({ canAct: false, impersonating: true }),
    );
    const html = await render();
    expect(html).toContain(
      "You&#x27;re viewing as CDS staff, so payment is turned off.",
    );
    expect(html).not.toContain("Accept and pay");
    expect(html).not.toContain("Decline this quote");
  });

  it("malformed id is a 404 before any db call", async () => {
    await expect(render("../etc")).rejects.toThrow("NOT_FOUND");
    await expect(render("ABC")).rejects.toThrow("NOT_FOUND");
    expect(db.readWorkOrder).not.toHaveBeenCalled();
  });

  it("another org's id (NotFound or Forbidden) is a 404", async () => {
    db.readWorkOrder.mockRejectedValueOnce(new NotFound());
    await expect(render()).rejects.toThrow("NOT_FOUND");
    db.readWorkOrder.mockRejectedValueOnce(new Forbidden());
    await expect(render()).rejects.toThrow("NOT_FOUND");
  });

  it("a failed read shows ERR-LOAD with Try again, no detail", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.readWorkOrder.mockRejectedValue(new Error("pb down: secret"));
    const html = await render();
    expect(html).toContain("We couldn&#x27;t load this.");
    expect(html).toContain(`href="/hub/settings/quotes/${ID}"`);
    expect(html).not.toContain("secret");
    err.mockRestore();
  });

  it("accepted, unpaid: info line and Pay link to the hosted invoice", async () => {
    db.readWorkOrder.mockResolvedValue(
      view({
        status: "accepted",
        acceptedLabel: "9 Oct",
        payHref: "https://invoice.example/i_1",
      }),
    );
    const html = await render();
    expect(html).toContain(
      "Accepted on 9 Oct. Pay the invoice to start the work.",
    );
    expect(html).toContain('href="https://invoice.example/i_1"');
    expect(html).toContain("Pay $360");
    expect(html).not.toContain("Accept and pay");
  });

  it("deposit paid: QUOTE-STARTED", async () => {
    db.readWorkOrder.mockResolvedValue(
      view({ status: "deposit_paid", kind: "private_addon" }),
    );
    expect(await render()).toContain(
      "CDS has started the work and will message you when it&#x27;s ready.",
    );
  });

  it("delivered: balance line and Pay the balance", async () => {
    db.readWorkOrder.mockResolvedValue(
      view({
        status: "delivered",
        kind: "private_addon",
        payNowCents: 200000,
        deliveredLabel: "20 Oct",
        payHref: "https://invoice.example/i_2",
      }),
    );
    const html = await render();
    expect(html).toContain("CDS delivered this work on 20 Oct.");
    expect(html).toContain("Pay the balance $2,000");
    expect(html).toContain('href="https://invoice.example/i_2"');
  });

  it("declined and expired lines", async () => {
    db.readWorkOrder.mockResolvedValue(
      view({ status: "declined", statusDateLabel: "9 Oct" }),
    );
    expect(await render()).toContain("You declined this quote on 9 Oct.");
    db.readWorkOrder.mockResolvedValue(
      view({ status: "expired", statusDateLabel: "7 Nov" }),
    );
    expect(await render()).toContain(
      "This quote expired on 7 Nov. Ask CDS Support for a new one.",
    );
  });
});

describe("acceptQuoteAction", () => {
  it("owner: calls acceptWorkOrder once and returns the invoice URL", async () => {
    db.acceptWorkOrder.mockResolvedValue({
      payUrl: "https://invoice.example/i_1",
    });
    expect(await acceptQuoteAction(ID)).toEqual({
      ok: true,
      url: "https://invoice.example/i_1",
    });
    expect(db.acceptWorkOrder).toHaveBeenCalledTimes(1);
    expect(db.acceptWorkOrder).toHaveBeenCalledWith(OWNER, ID);
  });

  it("keeps a same-origin test page and refuses other schemes", async () => {
    db.acceptWorkOrder.mockResolvedValue({ payUrl: "/test-pay/in_1" });
    expect(await acceptQuoteAction(ID)).toEqual({
      ok: true,
      url: "/test-pay/in_1",
    });
    db.acceptWorkOrder.mockResolvedValue({ payUrl: "javascript:alert(1)" });
    const res = await acceptQuoteAction(ID);
    expect(res.ok).toBe(false);
  });

  it("malformed id: refused before any db call", async () => {
    for (const bad of [null, 3, "x", "../aaaaaaaaaaaa", { id: ID }]) {
      expect((await acceptQuoteAction(bad)).ok).toBe(false);
    }
    expect(db.orgContextFromToken).not.toHaveBeenCalled();
    expect(db.acceptWorkOrder).not.toHaveBeenCalled();
  });

  it("Admin is refused; impersonating staff get IMPERSONATING-PAY", async () => {
    db.orgContextFromToken.mockResolvedValue({ ...OWNER, role: "admin" });
    expect(await acceptQuoteAction(ID)).toEqual({
      ok: false,
      message: "Only the site owner can accept or decline quotes.",
    });
    db.orgContextFromToken.mockResolvedValue({
      ...OWNER,
      impersonator: "staff1",
    });
    expect(await acceptQuoteAction(ID)).toEqual({
      ok: false,
      message:
        "You're viewing as CDS staff, so payment is turned off. Only the owner can pay.",
    });
    expect(db.acceptWorkOrder).not.toHaveBeenCalled();
  });

  it("a chokepoint refusal keeps its copy (expired)", async () => {
    db.acceptWorkOrder.mockRejectedValue(
      new InvalidInput("This quote expired. Ask CDS Support for a new one."),
    );
    db.readWorkOrder.mockResolvedValue(view({ status: "expired" }));
    expect(await acceptQuoteAction(ID)).toEqual({
      ok: false,
      message: "This quote expired. Ask CDS Support for a new one.",
    });
  });

  it("retry after a lost answer re-opens the stored invoice", async () => {
    db.acceptWorkOrder.mockRejectedValue(
      new InvalidInput("This quote was already answered."),
    );
    db.readWorkOrder.mockResolvedValue(
      view({ status: "accepted", payHref: "https://invoice.example/i_1" }),
    );
    expect(await acceptQuoteAction(ID)).toEqual({
      ok: true,
      url: "https://invoice.example/i_1",
    });
  });

  it("a provider failure is ERR-QUOTE-PAY, no detail", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.acceptWorkOrder.mockRejectedValue(new Error("stripe down: secret"));
    db.readWorkOrder.mockResolvedValue(view());
    expect(await acceptQuoteAction(ID)).toEqual({
      ok: false,
      message:
        "We couldn't open your invoice. Your acceptance is saved; try again in a minute.",
    });
    err.mockRestore();
  });
});

describe("declineQuoteAction", () => {
  it("owner: declines once", async () => {
    db.declineWorkOrder.mockResolvedValue(undefined);
    expect(await declineQuoteAction(ID)).toEqual({ ok: true });
    expect(db.declineWorkOrder).toHaveBeenCalledWith(OWNER, ID);
  });

  it("impersonating staff and malformed ids are refused", async () => {
    db.orgContextFromToken.mockResolvedValue({
      ...OWNER,
      impersonator: "staff1",
    });
    expect(await declineQuoteAction(ID)).toEqual({ ok: false });
    expect(await declineQuoteAction("nope")).toEqual({ ok: false });
    expect(db.declineWorkOrder).not.toHaveBeenCalled();
  });
});

describe("acceptAndOpen (QuotePanel)", () => {
  it("navigates to the URL on success and stays pending", async () => {
    const go = vi.fn();
    const refresh = vi.fn();
    const accept = vi.fn().mockResolvedValue({ ok: true, url: "/test-pay/i" });
    expect(await acceptAndOpen(ID, accept, go, refresh)).toEqual({ ok: true });
    expect(accept).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith("/test-pay/i");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("returns the message and refreshes on failure", async () => {
    const go = vi.fn();
    const refresh = vi.fn();
    const accept = vi.fn().mockResolvedValue({ ok: false, message: "Nope." });
    expect(await acceptAndOpen(ID, accept, go, refresh)).toEqual({
      ok: false,
      message: "Nope.",
    });
    expect(go).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});
