// 13-42 Task 1 (STAFF-21, D212; RESEARCH Pitfall 10; T-13-42-01, T-13-42-02, T-13-42-03): the
// email rating link page and the rating action. The real page over a mocked session and a
// partly mocked @cds/db (the real signed-link functions; spies for reads and rateTicket):
//   - GET with a valid signature renders the choice preselected + Save rating and never writes;
//   - expired, tampered and another ticket's links render the same expired panel;
//   - Closed shows "ratings are finished"; impersonation shows the read-only card;
//   - rateTicketAction passes the session ctx and the choice to rateTicket; junk is refused.
import { ToastRegion } from "@cds/ui/hub";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/support/tickets/1042/rate",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(async () => false),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  getTicketByNumber: vi.fn(),
  ticketRatingView: vi.fn(),
  rateTicket: vi.fn(),
  listThreadMessages: vi.fn(),
  readSupportRead: vi.fn(),
  getBusinessProfile: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const { ratingLinkPath, RATING_LINK_MS } = await import("@cds/db");
const { default: RatePage } =
  await import("../app/(platform)/hub/support/tickets/[number]/rate/page");
const { rateTicketAction } = await import("../app/actions/support-rating");
const { default: TicketPage } =
  await import("../app/(platform)/hub/support/tickets/[number]/page");

const THREAD = "thrdaaaaaaaaaa1";
const OTHER = "thrdbbbbbbbbbb2";
const ORG = "orgaaaaaaaaaaa1";
const OWNER = { orgId: ORG, actor: "u1", role: "owner", grants: [] };
const IMP = { ...OWNER, impersonator: "staff1" };

function signIn(ctx: Record<string, unknown> = OWNER) {
  const s = {
    ctx,
    email: "maria@riverabakery.com",
    org: { id: ORG, name: "Rivera Bakery", primaryHost: null },
    orgs: [],
    staleOrg: false,
  };
  sess.requireHubSession.mockResolvedValue(s);
  sess.getHubSession.mockResolvedValue(s);
}

function ticket(status = "resolved") {
  return {
    id: THREAD,
    number: 1042,
    type: "problem",
    subject: "Blurry menu photo",
    status,
    target: { kind: "site", id: "site", label: "Whole site" },
    openedByCds: false,
    paid: null,
    incident: null,
    lastActivityAt: "2026-10-12T15:00:00Z",
    resolvedAt: "2026-10-12T15:00:00Z",
    closedAt: null,
    created: "2026-10-10T15:00:00Z",
    unread: false,
    firstRepliedAt: null,
    hasIncident: false,
  };
}

function view(over: Record<string, unknown> = {}) {
  return {
    threadId: THREAD,
    number: 1042,
    status: "resolved",
    rating: null,
    comment: null,
    ratedAt: null,
    isRater: true,
    canRate: true,
    ...over,
  };
}

/** The link's query as the page receives it. */
function linkParams(
  choice: "up" | "down",
  thread = THREAD,
  now = Date.now(),
): Record<string, string> {
  const path = ratingLinkPath(1042, thread, choice, now);
  return Object.fromEntries(new URL(path, "https://x.test").searchParams);
}

async function render(sp: Record<string, string>, number = "1042") {
  const el = await RatePage({
    params: Promise.resolve({ number }),
    searchParams: Promise.resolve(sp),
  });
  return renderToStaticMarkup(
    createElement(ToastRegion, null, el as ReactElement),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  signIn();
  db.getTicketByNumber.mockResolvedValue(ticket());
  db.ticketRatingView.mockResolvedValue(view());
  db.listThreadMessages.mockResolvedValue({ messages: [], hasEarlier: false });
  db.readSupportRead.mockResolvedValue({});
  db.getBusinessProfile.mockResolvedValue({ time_zone: "America/Chicago" });
  db.rateTicket.mockResolvedValue({
    number: 1042,
    rating: "up",
    comment: null,
    ratedAt: "2026-10-12T16:00:00.000Z",
    changed: true,
    alert: "none",
  });
});

describe("rating link page (13-42 choice 3)", () => {
  it("GET with a valid signature preselects the choice, offers Save rating and writes nothing", async () => {
    const html = await render(linkParams("down"));
    expect(html).toContain('data-rate-link="valid"');
    expect(html).toContain("Was this resolved well?");
    expect(html).toMatch(
      /aria-pressed="true"[^>]*aria-label="No, not resolved well"/,
    );
    expect(html).toMatch(
      /aria-pressed="false"[^>]*aria-label="Yes, resolved well"/,
    );
    expect(html).toContain("Save rating");
    expect(html).toContain("Anything to add?");
    expect(db.rateTicket).not.toHaveBeenCalled();
    expect(db.getTicketByNumber).toHaveBeenCalledWith(OWNER, "1042");
  });

  it("an expired link renders the expired panel and writes nothing", async () => {
    const html = await render(
      linkParams("up", THREAD, Date.now() - RATING_LINK_MS - 60_000),
    );
    expect(html).toContain('data-rate-link="expired"');
    expect(html).toContain(
      "This rating link has expired. You can still rate on the ticket while it&#x27;s resolved.",
    );
    expect(html).toContain('href="/hub/support/tickets/1042"');
    expect(html).not.toContain("Save rating");
    expect(db.rateTicket).not.toHaveBeenCalled();
  });

  it("a tampered signature, a swapped choice or another ticket's link render the same", async () => {
    const good = linkParams("up");
    const tampered = {
      ...good,
      sig: (good.sig!.startsWith("A") ? "B" : "A") + good.sig!.slice(1),
    };
    const swapped = { ...good, r: "down" };
    const other = linkParams("up", OTHER);
    for (const sp of [tampered, swapped, other, {}]) {
      const html = await render(sp);
      expect(html).toContain('data-rate-link="expired"');
      expect(html).not.toContain("Save rating");
    }
    expect(db.rateTicket).not.toHaveBeenCalled();
  });

  it("a Closed ticket says ratings are finished", async () => {
    db.getTicketByNumber.mockResolvedValue(ticket("closed"));
    db.ticketRatingView.mockResolvedValue(
      view({ status: "closed", canRate: false }),
    );
    const html = await render(linkParams("up"));
    expect(html).toContain("This ticket is closed, so ratings are finished.");
    expect(html).not.toContain("Save rating");
  });

  it("impersonating staff get the read-only card, no write controls", async () => {
    signIn(IMP);
    db.ticketRatingView.mockResolvedValue(view({ canRate: false }));
    const html = await render(linkParams("up"));
    expect(html).toContain(
      "Ratings are turned off while viewing as CDS staff.",
    );
    expect(html).not.toContain("Save rating");
    expect(html).not.toContain("aria-pressed");
  });

  it("junk or another site's number is the hub 404", async () => {
    await expect(render(linkParams("up"), "abc")).rejects.toThrow("NOT_FOUND");
    const { NotFound } = await import("@cds/core");
    db.getTicketByNumber.mockRejectedValue(new NotFound("ticket not found"));
    await expect(render(linkParams("up"))).rejects.toThrow("NOT_FOUND");
  });
});

describe("hub ticket page mount (13-42 choice 2)", () => {
  async function page() {
    const el = await TicketPage({
      params: Promise.resolve({ number: "1042" }),
    });
    return renderToStaticMarkup(
      createElement(ToastRegion, null, el as ReactElement),
    );
  }

  it("a Resolved ticket shows the card under the thread with the stored rating pressed", async () => {
    db.ticketRatingView.mockResolvedValue(view({ rating: "up" }));
    const html = await page();
    expect(html).toContain('id="rating"');
    expect(html).toContain('data-rating-card="instant"');
    expect(html).toMatch(
      /aria-pressed="true"[^>]*aria-label="Yes, resolved well"/,
    );
    expect(html.indexOf('id="rating"')).toBeLessThan(
      html.indexOf("data-ticket-composer"),
    );
    expect(db.rateTicket).not.toHaveBeenCalled();
  });

  it("a non-resolved ticket has no card and no rating read", async () => {
    db.getTicketByNumber.mockResolvedValue(ticket("in_progress"));
    const html = await page();
    expect(html).not.toContain("Was this resolved well?");
    expect(db.ticketRatingView).not.toHaveBeenCalled();
  });

  it("a failed rating read shows the ticket without the card", async () => {
    db.ticketRatingView.mockRejectedValue(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await page();
    expect(html).toContain("data-ticket-detail");
    expect(html).not.toContain("Was this resolved well?");
    expect(err).toHaveBeenCalledWith("[hub] ticket rating failed Error");
    err.mockRestore();
  });
});

describe("rateTicketAction (13-42 choice 2)", () => {
  it("rates through rateTicket with the session ctx; comment passes through", async () => {
    const res = await rateTicketAction("1042", "down", "Still slow");
    expect(res.ok).toBe(true);
    expect(db.rateTicket).toHaveBeenCalledWith(OWNER, {
      number: 1042,
      rating: "down",
      comment: "Still slow",
    });
    await rateTicketAction(1042, "up");
    expect(db.rateTicket).toHaveBeenLastCalledWith(OWNER, {
      number: 1042,
      rating: "up",
    });
  });

  it("refuses junk choices, long comments and junk numbers before the chokepoint", async () => {
    const bad = await rateTicketAction(1042, "meh");
    expect(bad).toMatchObject({ ok: false, code: "invalid_input" });
    const long = await rateTicketAction(1042, "up", "x".repeat(501));
    expect(long).toMatchObject({
      ok: false,
      message: "Keep it to 500 characters.",
    });
    const junk = await rateTicketAction("abc", "up");
    expect(junk).toMatchObject({ ok: false, code: "not_found" });
    expect(db.rateTicket).not.toHaveBeenCalled();
  });

  it("under impersonation returns the card's impersonation copy", async () => {
    const { ImpersonationDenied } = await import("@cds/core");
    signIn(IMP);
    db.rateTicket.mockRejectedValue(new ImpersonationDenied("support:write"));
    const res = await rateTicketAction(1042, "up");
    expect(res).toMatchObject({
      ok: false,
      message: "Ratings are turned off while viewing as CDS staff.",
    });
  });

  it("signed out is signed_out, never a write", async () => {
    sess.getHubSession.mockResolvedValue(null);
    const res = await rateTicketAction(1042, "up");
    expect(res).toMatchObject({ ok: false, code: "signed_out" });
    expect(db.rateTicket).not.toHaveBeenCalled();
  });
});
