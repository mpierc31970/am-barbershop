// 10-32 Task 1: the declined notice (BILL-09, D214, D-UI-P10-19; T-10-32-01, T-10-32-02).
// The real session module runs against mocked next/headers and @cds/db: a member whose only
// site was declined gets the focused declined frame from the hub layout on any /hub path,
// hub pages send them to /hub/declined, sign-in lets them in, and Server Actions refuse.
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  pathname: "/hub/website",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: (name: string, value: string) => state.jar.set(name, value),
    delete: () => {},
  }),
  headers: async () =>
    new Headers({
      "x-forwarded-for": "203.0.113.9",
      "x-cds-path": state.pathname,
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT:${to}`), {
      digest: `NEXT_REDIRECT;replace;${to};307;`,
    });
  },
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  declinedMemberContext: vi.fn(),
  readDeclinedNotice: vi.fn(),
  signInMember: vi.fn(),
  supportEmail: vi.fn(() => null),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const { default: HubLayout } = await import("../app/(platform)/hub/layout");
const { default: DeclinedPage } =
  await import("../app/(platform)/hub/declined/page");
const { DECLINED_COPY } = await import("../app/(platform)/hub/DeclinedNotice");
const session = await import("../lib/session");
const { signInAction } = await import("../app/actions/session");

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [], ip: "" };
const NOTICE = {
  refundedAmount: "$1,539.00",
  refundedLabel: "$1,539.00 to Visa ending 4242 on 9 Oct 2026",
  deleteOnLabel: "8 Nov 2026",
  reasonSentence:
    "We can't take on your build right now and didn't want to keep you waiting.",
  agreementHref: "/hub/agreement/download/sig1",
  invoices: [
    {
      id: "inv1",
      number: "CDS-0001",
      issuedAt: "2026-10-08 10:00:00.000Z",
      description: "Build fee",
      kind: "build",
      amountCents: 153900,
      taxCents: 0,
      status: "paid",
      hostedUrl: "https://invoice.stripe.test/i/1",
      pdfUrl: null,
    },
  ],
};

function esc(s: string): string {
  return s.replaceAll("'", "&#x27;");
}

function declinedMember(role = "owner") {
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "owner@palm.example",
    organizations: [],
  });
  db.declinedMemberContext.mockResolvedValue({
    ctx: { ...CTX, role },
    email: "owner@palm.example",
    org: { id: "org1", name: "Palm Science" },
  });
}

async function renderLayout(): Promise<string> {
  return renderToStaticMarkup(
    (await HubLayout({
      children: createElement("p", null, "inner"),
    })) as ReactElement,
  );
}

beforeEach(() => {
  state.jar.clear();
  state.pathname = "/hub/website";
  for (const fn of Object.values(db)) fn.mockReset();
  db.supportEmail.mockReturnValue(null);
  db.readDeclinedNotice.mockResolvedValue(NOTICE);
});

describe("declined notice frame (BILL-09, D214)", () => {
  it("renders the full notice in the focused frame on any /hub path, with no sidebar, no primary and no red", async () => {
    declinedMember();
    for (const path of ["/hub/website", "/hub/settings", "/hub/add-ons/x"]) {
      state.pathname = path;
      const html = await renderLayout();
      expect(html).toMatch(/<h1[^>]*>We&#x27;ve refunded your order<\/h1>/);
      expect(html).toContain(
        esc(
          "CDS can't build this site, so we've refunded everything you paid, $1,539.00, to your card. It can take 5 to 10 business days to show. We can't take on your build right now",
        ),
      );
      expect(html).toContain("Refunded");
      expect(html).toContain("$1,539.00 to Visa ending 4242 on 9 Oct 2026");
      expect(html).toContain("Account and site details deleted on");
      expect(html).toContain("8 Nov 2026");
      expect(html).toContain(
        "Your preview site is offline. Your account and site details are deleted on 8 Nov 2026.",
      );
      expect(html).toMatch(
        /<a href="\/hub\/agreement\/download\/sig1"[^>]*>Download your signed agreement<\/a>/,
      );
      expect(html).toContain("View invoices");
      expect(html).toContain("CDS-0001");
      expect(html).toMatch(
        /<a href="mailto:support@connectionsdesignstudios.com"[^>]*>Contact CDS Support<\/a>/,
      );
      expect(html).toContain("Sign out");
      // The page under the layout never renders, nor does the hub nav.
      expect(html).not.toContain("<p>inner</p>");
      expect(html).not.toContain("Open menu");
      expect(html).not.toContain('aria-label="Hub"');
      expect(html).not.toContain("bg-hub-accent ");
      expect(html).not.toContain("hub-danger");
    }
    expect(db.readDeclinedNotice).toHaveBeenCalledWith({ ...CTX });
  });

  it("an Editor gets the same lines without agreement or invoices (scoped by readDeclinedNotice)", async () => {
    declinedMember("editor");
    db.readDeclinedNotice.mockResolvedValue({
      ...NOTICE,
      agreementHref: null,
      invoices: [],
    });
    const html = await renderLayout();
    expect(html).toContain(esc(DECLINED_COPY.title));
    expect(html).toContain(NOTICE.refundedLabel);
    expect(html).not.toContain(DECLINED_COPY.download);
    expect(html).not.toContain(DECLINED_COPY.invoices);
  });

  it("a failed notice read keeps the focused frame with a calm retry line", async () => {
    declinedMember();
    db.readDeclinedNotice.mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await renderLayout();
    err.mockRestore();
    expect(html).toContain(esc("We couldn't load the details right now."));
    expect(html).not.toContain("Open menu");
  });

  it("hub pages send a declined member to /hub/declined; the declined page keeps them there", async () => {
    declinedMember();
    await expect(session.requireHubSession()).rejects.toThrow(
      "REDIRECT:/hub/declined",
    );
    await expect(DeclinedPage()).resolves.toBeNull();
  });

  it("anyone else: /sign-in without a session, /hub from the declined page", async () => {
    await expect(session.requireHubSession()).rejects.toThrow(
      "REDIRECT:/sign-in",
    );
    await expect(DeclinedPage()).rejects.toThrow("REDIRECT:/hub");
    // A member with an active site never reads the declined lookup.
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [{ id: "org2", name: "Open", primaryHost: null }],
    });
    db.orgContextFromToken.mockResolvedValue({ ...CTX, orgId: "org2" });
    await expect(session.getDeclinedSession()).resolves.toBeNull();
    expect(db.declinedMemberContext).not.toHaveBeenCalled();
  });

  it("Server Actions stay refused for a declined member (T-10-32-02)", async () => {
    declinedMember();
    await expect(session.getHubSession()).resolves.toBeNull();
  });

  it("sign-in lets a declined member in to read the notice", async () => {
    db.signInMember.mockResolvedValue({ token: "tok2" });
    db.listMemberOrganizations.mockResolvedValue({
      userId: "u1",
      email: "a@b.c",
      organizations: [],
    });
    db.declinedMemberContext.mockResolvedValue({
      ctx: CTX,
      email: "a@b.c",
      org: { id: "org1", name: "Palm" },
    });
    const fd = new FormData();
    fd.set("email", "a@b.c");
    fd.set("password", "correct horse battery");
    await expect(signInAction({ error: null }, fd)).rejects.toThrow(
      "REDIRECT:/hub",
    );
    expect(state.jar.get("cds_session")).toBe("tok2");
  });
});
