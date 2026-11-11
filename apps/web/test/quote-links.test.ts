// 06-16: quote-link and email-link surfaces (ONB-08, ONB-09; 06-UI-SPEC "Quote links";
// D-UI-P6-15, D138, D173; T-06-78..T-06-81). Route handlers run for real against a mocked
// @cds/db; pages render to static markup.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: ReactNode;
    href: string;
    className?: string;
  }) => createElement("a", { href, className }, children),
}));

const nav = vi.hoisted(() => ({
  jar: new Map<string, string>(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT:${to}`), {
      digest: `NEXT_REDIRECT;replace;${to};307;`,
    });
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      nav.jar.has(name) ? { name, value: nav.jar.get(name) } : undefined,
    set: (name: string, value: string) => {
      nav.jar.set(name, value);
    },
    delete: (name: string) => {
      nav.jar.delete(name);
    },
  }),
}));

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

const db = vi.hoisted(() => ({
  quoteLinkState: vi.fn(),
  resolveSignedReopen: vi.fn(),
  describeSignedReopen: vi.fn(),
  describeUnsubscribe: vi.fn(),
  unsubscribeQuote: vi.fn(),
  quoteSignedReopenLink: vi.fn(
    (id: string) => `https://cds.test/start/q/s/signed-${id}`,
  ),
  describeRouteConfirm: vi.fn(),
  confirmEmailRoute: vi.fn(),
  QUOTE_TOKEN_RE: /^[A-Za-z0-9_-]{43}$/,
}));
vi.mock("@cds/db", () => db);

const rawRoute = await import("../app/(platform)/start/q/[token]/route");
const { default: SignedReopenPage } =
  await import("../app/(platform)/start/q/s/[signed]/page");
const { openSignedQuoteAction } = await import("../app/actions/quote-links");
const { default: ExpiredPage } =
  await import("../app/(platform)/start/q/expired/page");
const { default: SubmittedPage } =
  await import("../app/(platform)/start/q/submitted/page");

const TOKEN = "a".repeat(43);
const COOKIE = "cds_quote"; // NODE_ENV is "test", so no __Host- prefix

function get(path: string): Request {
  return new Request(`http://127.0.0.1:3000${path}`);
}

function raw(token: string) {
  return rawRoute.GET(get(`/start/q/${token}`), {
    params: Promise.resolve({ token }),
  });
}

function signedPage(s: string) {
  return SignedReopenPage({ params: Promise.resolve({ signed: s }) });
}

function openForm(s?: string): FormData {
  const f = new FormData();
  if (s !== undefined) f.set("s", s);
  return f;
}

function html(el: ReactNode): string {
  return renderToStaticMarkup(el as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.jar.clear();
});

describe("GET /start/q/<token> (raw reopen)", () => {
  it("valid: sets the httpOnly quote cookie and 302s to /start?welcome=1", async () => {
    db.quoteLinkState.mockResolvedValue("valid");
    const res = await raw(TOKEN);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/start?welcome=1");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${COOKIE}=${TOKEN}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Path=/");
    expect(db.quoteLinkState).toHaveBeenCalledWith(TOKEN);
  });

  it("expired and unknown both 302 to the one expired page with no cookie", async () => {
    db.quoteLinkState.mockResolvedValue("expired");
    const res = await raw(TOKEN);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/start/q/expired");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("malformed tokens never reach the database and read as expired", async () => {
    for (const bad of ["short", "a".repeat(44), `${"a".repeat(42)}'`, "s"]) {
      const res = await raw(bad);
      expect(res.headers.get("location"), bad).toBe("/start/q/expired");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(db.quoteLinkState).not.toHaveBeenCalled();
  });

  it("submitted: 302 to the already-submitted page, no cookie", async () => {
    db.quoteLinkState.mockResolvedValue("submitted");
    const res = await raw(TOKEN);
    expect(res.headers.get("location")).toBe("/start/q/submitted");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("a lookup failure reads as expired and never logs the token", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.quoteLinkState.mockRejectedValue(new Error("pb down"));
    const res = await raw(TOKEN);
    expect(res.headers.get("location")).toBe("/start/q/expired");
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    log.mockRestore();
  });

  it("every response is no-store and no-referrer (the token is in the URL)", async () => {
    for (const state of ["valid", "expired", "submitted"] as const) {
      db.quoteLinkState.mockResolvedValue(state);
      const res = await raw(TOKEN);
      expect(res.headers.get("cache-control")).toContain("no-store");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    }
    expect(rawRoute.dynamic).toBe("force-dynamic");
  });
});

describe("/start/q/s/<signed> (reminder reopen, B-WR-01)", () => {
  const SIGNED = "cmVvcGVufGFiY3wxMjM.bWFj";

  it("GET only describes: an Open my quote button that POSTs, and no rotation", async () => {
    db.describeSignedReopen.mockResolvedValue("valid");
    const out = html(await signedPage(SIGNED));
    expect(out).toContain("Your quote is ready");
    expect(out).toContain(`name="s" value="${SIGNED}"`);
    expect(out).toMatch(/<button type="submit"[^>]*>Open my quote<\/button>/);
    expect(db.describeSignedReopen).toHaveBeenCalledWith(SIGNED);
    expect(db.resolveSignedReopen).not.toHaveBeenCalled();
    expect(nav.jar.size).toBe(0);
  });

  it("GET: invalid (null), expired and submitted links redirect without touching the quote", async () => {
    const cases: [unknown, string][] = [
      [null, "/start/q/expired"],
      ["expired", "/start/q/expired"],
      ["submitted", "/start/q/submitted"],
    ];
    for (const [state, location] of cases) {
      db.describeSignedReopen.mockResolvedValue(state);
      expect(await redirectOf(signedPage(SIGNED))).toBe(location);
    }
    db.describeSignedReopen.mockRejectedValue(new Error("pb down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await redirectOf(signedPage(SIGNED))).toBe("/start/q/expired");
    expect(JSON.stringify(log.mock.calls)).not.toContain(SIGNED);
    log.mockRestore();
    expect(db.resolveSignedReopen).not.toHaveBeenCalled();
  });

  it("GET: junk segments are refused before the signature check", async () => {
    expect(await redirectOf(signedPage("not a signed link!"))).toBe(
      "/start/q/expired",
    );
    expect(db.describeSignedReopen).not.toHaveBeenCalled();
  });

  it("POST valid: the rotated token goes into the cookie and the visitor lands on /start", async () => {
    const fresh = "b".repeat(43);
    db.resolveSignedReopen.mockResolvedValue({ state: "valid", token: fresh });
    expect(await redirectOf(openSignedQuoteAction(openForm(SIGNED)))).toBe(
      "/start?welcome=1",
    );
    expect(nav.jar.get(COOKIE)).toBe(fresh);
    expect(db.resolveSignedReopen).toHaveBeenCalledWith(SIGNED);
  });

  it("POST invalid, expired and submitted route without a cookie; junk never reaches the database", async () => {
    const cases: [unknown, string][] = [
      [null, "/start/q/expired"],
      [{ state: "expired" }, "/start/q/expired"],
      [{ state: "submitted" }, "/start/q/submitted"],
    ];
    for (const [outcome, location] of cases) {
      db.resolveSignedReopen.mockResolvedValue(outcome);
      expect(await redirectOf(openSignedQuoteAction(openForm(SIGNED)))).toBe(
        location,
      );
    }
    expect(nav.jar.size).toBe(0);
    db.resolveSignedReopen.mockClear();
    for (const bad of [undefined, "", "not a signed link!", "x".repeat(600)]) {
      expect(await redirectOf(openSignedQuoteAction(openForm(bad)))).toBe(
        "/start/q/expired",
      );
    }
    expect(db.resolveSignedReopen).not.toHaveBeenCalled();
  });
});

describe("expired and submitted pages", () => {
  it("expired: verbatim H1 and body, primary Start a new quote -> /start", () => {
    const out = html(createElement(ExpiredPage));
    expect(out).toContain("This quote has expired");
    expect(out).toContain(
      "Quotes last 30 days after the last change. Start a fresh one; it takes a few minutes.",
    );
    expect(out).toMatch(/<a href="\/start"[^>]*>Start a new quote<\/a>/);
    expect(out).toContain("Connections Design Studios");
    expect(out).toContain("max-w-[480px]");
  });

  it("submitted: verbatim H1 and body, primary Sign in -> /sign-in", () => {
    const out = html(createElement(SubmittedPage));
    expect(out).toContain("You&#x27;ve already submitted this quote");
    expect(out).toContain("Sign in to keep setting up your site.");
    expect(out).toMatch(/<a href="\/sign-in"[^>]*>Sign in<\/a>/);
  });
});

// ------------------------------------------------------------------ Task 2

const { unsubscribeAction, confirmEmailAction } =
  await import("../app/actions/quote-links");
const unsubApi = await import("../app/api/email/unsubscribe/route");
const { default: UnsubscribePage } =
  await import("../app/(platform)/start/unsubscribe/page");
const { UnsubscribeDone } =
  await import("../app/(platform)/start/unsubscribe/UnsubscribeForm");
const { default: ConfirmEmailPage } =
  await import("../app/(platform)/start/confirm-email/page");
const { ConfirmEmailDone } =
  await import("../app/(platform)/start/confirm-email/ConfirmEmailForm");

const IDLE = { status: "idle" as const, error: null };
const UNSUB_T = "dW5zdWJ8cTF8OTk5.bWFj";

function form(t?: string): FormData {
  const f = new FormData();
  if (t !== undefined) f.set("t", t);
  return f;
}

function params(t?: string) {
  return { searchParams: Promise.resolve(t === undefined ? {} : { t }) };
}

describe("unsubscribe page (GET never unsubscribes)", () => {
  it("valid link: Stop quote reminders? with the link date, and no state change", async () => {
    const future = new Date(Date.now() + 20 * 86_400_000);
    db.describeUnsubscribe.mockResolvedValue({
      quoteId: "q1",
      expiresAt: future,
      done: false,
    });
    const out = html(await UnsubscribePage(params(UNSUB_T)));
    expect(out).toContain("Stop quote reminders?");
    expect(out).toContain("We&#x27;ll stop emailing you about this quote.");
    const day = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(future);
    expect(out).toContain(`Your link keeps working until ${day}.`);
    expect(out).toContain(`name="t" value="${UNSUB_T}"`);
    expect(out).toContain(">Unsubscribe<");
    expect(db.unsubscribeQuote).not.toHaveBeenCalled();
  });

  it("an invalid t renders Link expired; a used link renders Done", async () => {
    db.describeUnsubscribe.mockResolvedValue(null);
    expect(html(await UnsubscribePage(params("junk")))).toContain(
      "This link has expired",
    );
    expect(html(await UnsubscribePage(params()))).toContain(
      "This link has expired",
    );
    db.describeUnsubscribe.mockResolvedValue({
      quoteId: "q1",
      expiresAt: new Date(Date.now() - 1000),
      done: true,
    });
    const done = html(await UnsubscribePage(params(UNSUB_T)));
    expect(done).toContain("You&#x27;re unsubscribed");
    expect(done).toMatch(/<a href="\/start"[^>]*>Open my quote<\/a>/);
    expect(db.unsubscribeQuote).not.toHaveBeenCalled();
  });

  it("Done view: verbatim copy; Open my quote is plain /start (B-WR-02)", () => {
    const out = html(createElement(UnsubscribeDone));
    expect(out).toContain(
      "We won&#x27;t send more reminders about this quote.",
    );
    expect(out).toMatch(/<a href="\/start"[^>]*>Open my quote<\/a>/);
  });

  it("the unsubscribe token never mints a quote credential (B-WR-02)", async () => {
    db.describeUnsubscribe.mockResolvedValue({
      quoteId: "q1",
      expiresAt: new Date(Date.now() + 20 * 86_400_000),
      done: true,
    });
    const done = html(await UnsubscribePage(params(UNSUB_T)));
    expect(done).not.toContain("/start/q/");
    db.describeUnsubscribe.mockResolvedValue({
      quoteId: "q1",
      expiresAt: new Date(Date.now() + 20 * 86_400_000),
      done: false,
    });
    const pending = html(await UnsubscribePage(params(UNSUB_T)));
    expect(pending).not.toContain("/start/q/");
    expect(db.quoteSignedReopenLink).not.toHaveBeenCalled();
  });
});

describe("unsubscribeAction (POST)", () => {
  it("valid token: unsubscribes and returns done", async () => {
    db.unsubscribeQuote.mockResolvedValue(true);
    expect(await unsubscribeAction(IDLE, form(UNSUB_T))).toEqual({
      status: "done",
      error: null,
    });
    expect(db.unsubscribeQuote).toHaveBeenCalledWith(UNSUB_T);
  });

  it("bad token reads expired; missing or oversized never reach the database", async () => {
    db.unsubscribeQuote.mockResolvedValue(false);
    expect((await unsubscribeAction(IDLE, form("nope"))).status).toBe(
      "expired",
    );
    db.unsubscribeQuote.mockClear();
    expect((await unsubscribeAction(IDLE, form())).status).toBe("expired");
    expect((await unsubscribeAction(IDLE, form("x".repeat(600)))).status).toBe(
      "expired",
    );
    expect(db.unsubscribeQuote).not.toHaveBeenCalled();
  });

  it("a database failure keeps the form with a generic error, token not logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.unsubscribeQuote.mockRejectedValue(new Error("pb down"));
    const s = await unsubscribeAction(IDLE, form(UNSUB_T));
    expect(s.status).toBe("idle");
    expect(s.error).toBe("That didn't go through. Try again in a minute.");
    expect(JSON.stringify(log.mock.calls)).not.toContain(UNSUB_T);
    log.mockRestore();
  });
});

describe("/api/email/unsubscribe (RFC 8058)", () => {
  function oneClick(query: string, cookie?: string): Request {
    const headers = new Headers({
      "content-type": "application/x-www-form-urlencoded",
    });
    if (cookie) headers.set("cookie", cookie);
    return new Request(`http://127.0.0.1:3000/api/email/unsubscribe${query}`, {
      method: "POST",
      headers,
      body: "List-Unsubscribe=One-Click",
    });
  }

  it("POST with a valid signed token: 200 and a suppression, no-store", async () => {
    db.unsubscribeQuote.mockResolvedValue(true);
    const res = await unsubApi.POST(
      oneClick(`?t=${encodeURIComponent(UNSUB_T)}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(db.unsubscribeQuote).toHaveBeenCalledWith(UNSUB_T);
  });

  it("POST with a bad or missing token: 400 generic; cookies grant nothing", async () => {
    db.unsubscribeQuote.mockResolvedValue(false);
    const bad = await unsubApi.POST(
      oneClick("?t=forged", "cds_session=abc; cds_quote=def"),
    );
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe("Bad Request");
    db.unsubscribeQuote.mockClear();
    const none = await unsubApi.POST(oneClick("", "cds_session=abc"));
    expect(none.status).toBe(400);
    expect(db.unsubscribeQuote).not.toHaveBeenCalled();
  });

  it("GET never unsubscribes: 303 to the confirm page with the same token", () => {
    const res = unsubApi.GET(
      new Request(
        `http://127.0.0.1:3000/api/email/unsubscribe?t=${encodeURIComponent(UNSUB_T)}`,
      ),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `/start/unsubscribe?t=${encodeURIComponent(UNSUB_T)}`,
    );
    expect(db.unsubscribeQuote).not.toHaveBeenCalled();
  });
});

describe("confirm-email page and action", () => {
  const TOK = "c".repeat(43);
  const ROUTE = {
    orgName: "Rivera Bakery",
    address: "orders@riverabakery.com",
    purposeLabel: "website inquiries",
  };

  it("GET shows who and what, and does not confirm", async () => {
    db.describeRouteConfirm.mockResolvedValue({ ...ROUTE, state: "valid" });
    const out = html(await ConfirmEmailPage(params(TOK)));
    expect(out).toContain("Confirm this email address?");
    expect(out).toContain("Rivera Bakery&#x27;s website inquiries will go to");
    expect(out).toContain("orders@riverabakery.com");
    expect(out).toContain(">Confirm this address<");
    expect(out).toContain(`name="t" value="${TOK}"`);
    expect(db.confirmEmailRoute).not.toHaveBeenCalled();
  });

  it("used, unknown or expired links show This link has expired", async () => {
    db.describeRouteConfirm.mockResolvedValue(null);
    expect(html(await ConfirmEmailPage(params(TOK)))).toContain(
      "This link has expired",
    );
    db.describeRouteConfirm.mockResolvedValue({ ...ROUTE, state: "expired" });
    const out = html(await ConfirmEmailPage(params(TOK)));
    expect(out).toContain("This link has expired");
    expect(out).toContain("Send a new confirmation from Settings › Email.");
    expect(out).not.toContain(`value="${TOK}"`);
  });

  it("the button's action confirms; a used token reads expired", async () => {
    db.confirmEmailRoute
      .mockResolvedValueOnce(ROUTE)
      .mockResolvedValueOnce(null);
    expect((await confirmEmailAction(IDLE, form(TOK))).status).toBe("done");
    expect(db.confirmEmailRoute).toHaveBeenCalledWith(TOK);
    expect((await confirmEmailAction(IDLE, form(TOK))).status).toBe("expired");
  });

  it("Done view: Address confirmed + Back to your site's settings", () => {
    const out = html(createElement(ConfirmEmailDone, ROUTE));
    expect(out).toContain("Address confirmed");
    expect(out).toContain(
      "Website inquiries for Rivera Bakery will go to orders@riverabakery.com.",
    );
    expect(out).toMatch(
      /<a href="\/hub\/settings\?tab=email"[^>]*>Back to your site&#x27;s settings<\/a>/,
    );
  });
});
