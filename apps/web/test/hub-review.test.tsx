// @vitest-environment jsdom
// 14-34 Task 2: /hub/review (DOM-10, D172, D26; 14-UI-SPEC "Launch review"; T-14-34-01..03).
// The real server page over a mocked session and @cds/db: the Owner acts (review links minted,
// QR on ?step=phone), an Admin reads without buttons and gets no link, an Editor / Viewer gets
// notFound; Ready to launch stays aria-disabled while the domain isn't prepared; the actions
// map DomainNotReady and the impersonation deny.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../../packages/ui/src/test-support/dom";
import { ToastRegion } from "@cds/ui/hub";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/review",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
}));

const OWNER = "aaaaaaaaaaaaaa1";
const ORG = "orgorgorgorgor1";
const ROLES = {
  owner: { orgId: ORG, actor: OWNER, role: "owner", grants: [] },
  admin: { orgId: ORG, actor: "aaaaaaaaaaaaaa2", role: "admin", grants: [] },
  editor: { orgId: ORG, actor: "aaaaaaaaaaaaaa3", role: "editor", grants: [] },
  viewer: { orgId: ORG, actor: "aaaaaaaaaaaaaa4", role: "viewer", grants: [] },
} as const;
type RoleKey = keyof typeof ROLES;

const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => {
  class InvalidInputLike extends Error {
    code = "invalid_input";
  }
  class DomainNotReady extends InvalidInputLike {
    override code = "domain_not_ready";
  }
  return {
    DomainNotReady,
    launchReviewView: vi.fn(),
    getBusinessProfile: vi.fn(),
    listEmailRoutes: vi.fn(),
    previewHostSuffix: vi.fn(() => "sites.localhost"),
    signReviewToken: vi.fn(
      (_org: string, _member: string, mode: string) => `v1.tok-${mode}`,
    ),
    markKeyFacts: vi.fn(),
    markPhoneCheck: vi.fn(),
    submitLaunchReview: vi.fn(),
    resendRouteConfirmation: vi.fn(),
  };
});
vi.mock("@cds/db", () => db);

const { default: ReviewPage } =
  await import("../app/(platform)/hub/review/page");
const actions = await import("../app/actions/launch-review");

const ITEMS = [
  ["pages_reviewed", "Every page looked over", true, 2, 2],
  ["changes_sent", "Changes you asked for", true, 0, 0],
  ["key_facts", "Your key details confirmed", true, null, null],
  ["phone_check", "Checked on your phone", true, null, null],
  ["test_form", "Test form received", true, null, null],
  ["no_open_requests", "No open change requests", true, 0, null],
] as const;

function reviewView(over: Record<string, unknown> = {}) {
  return {
    items: ITEMS.map(([id, label, done, count, of]) => ({
      id,
      label,
      done,
      at: null,
      count,
      of,
    })),
    done: 6,
    total: 6,
    pages: [
      { id: "p1", title: "Home", path: "/", status: "looks_good" },
      { id: "p2", title: "Contact", path: "/contact", status: "looks_good" },
    ],
    domainReady: false,
    domain: "riverabakery.com",
    submittedAt: null,
    resubmitNeeded: [],
    hasForm: true,
    emailConfirmed: true,
    unconfirmedEmail: "",
    available: true,
    canAct: true,
    ...over,
  };
}

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function useRole(role: RoleKey, impersonator?: string) {
  const ctx = impersonator
    ? { ...ROLES[role], impersonator }
    : { ...ROLES[role] };
  const session = {
    ctx,
    email: "a@b.co",
    org: {
      id: ORG,
      name: "Rivera Bakery",
      primaryHost: "rivera.sites.localhost",
    },
  };
  sess.requireHubSession.mockResolvedValue(session);
  sess.getHubSession.mockResolvedValue(session);
}

async function render(step?: string): Promise<HTMLElement> {
  const tree = await ReviewPage({
    searchParams: Promise.resolve(step ? { step } : {}),
  });
  mounted = mount(<ToastRegion>{tree}</ToastRegion>);
  return mounted.container;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useRole("owner");
  sess.agreementBlocks.mockResolvedValue(false);
  db.launchReviewView.mockResolvedValue(reviewView());
  db.getBusinessProfile.mockResolvedValue({
    orgName: "Rivera Bakery",
    phone: "(512) 555-0100",
    address: { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" },
    hours: null,
    time_zone: "America/Chicago",
  });
  db.listEmailRoutes.mockResolvedValue([
    {
      id: "r1",
      purpose: "default",
      address: "maria@gmail.com",
      senderName: "",
      status: "confirmed",
      pendingDefault: false,
    },
  ]);
});

describe("/hub/review page", () => {
  it("Owner: checklist with actions, review links minted on the preview host, submit locked while the domain isn't prepared", async () => {
    const root = await render();
    expect(root.querySelector("h1")!.textContent).toBe("Review your site");
    expect(root.textContent).toContain("6 of 6 done");
    const review = root.querySelector(
      '[data-review-item="pages_reviewed"] [data-review-action]',
    )!;
    expect(review.getAttribute("href")).toBe(
      "http://rivera.sites.localhost:3000/_site/review/start?t=v1.tok-review&next=%2F",
    );
    expect(db.signReviewToken).toHaveBeenCalledWith(
      ORG,
      OWNER,
      "review",
      expect.any(Number),
    );
    const submit = root.querySelector("[data-ready-to-launch]")!;
    expect(root.querySelector("[data-review-submit] h2")!.textContent).toBe(
      "Your site goes live at riverabakery.com.",
    );
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    expect(root.textContent).toContain(
      "Your domain isn't ready yet. Finish connecting it in Settings › Domain.",
    );
  });

  it("Owner with everything done and a prepared domain: Ready to launch enabled", async () => {
    db.launchReviewView.mockResolvedValue(reviewView({ domainReady: true }));
    const root = await render();
    expect(
      root
        .querySelector("[data-ready-to-launch]")!
        .getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("?step=phone: server QR svg (role=img, labelled) + the phone link", async () => {
    const root = await render("phone");
    const svg = root.querySelector('svg[role="img"]')!;
    expect(svg.getAttribute("aria-label")).toBe(
      "QR code that opens your site in review mode on a phone",
    );
    expect(root.querySelector("[data-review-link]")!.textContent).toBe(
      "http://rivera.sites.localhost:3000/_site/review/start?t=v1.tok-phone",
    );
  });

  it("?step=facts: the five facts with Edit links and Confirm", async () => {
    const root = await render("facts");
    expect(root.querySelectorAll("[data-fact]")).toHaveLength(5);
    expect(root.textContent).toContain("1 Main St, Austin, TX 78701");
    expect(root.querySelector("[data-confirm-facts]")).not.toBeNull();
  });

  it("Admin: read-only list, no buttons, no review link minted", async () => {
    useRole("admin");
    db.launchReviewView.mockResolvedValue(reviewView({ canAct: false }));
    const root = await render();
    expect(root.textContent).toContain(
      "Only the owner can approve the launch.",
    );
    expect(root.querySelector("[data-review-action]")).toBeNull();
    expect(root.querySelector("button")).toBeNull();
    expect(db.signReviewToken).not.toHaveBeenCalled();
    mounted!.unmount();
    mounted = null;
    const phone = await render("phone");
    expect(phone.querySelector("svg[role=img]")).toBeNull();
  });

  it("Editor and Viewer: notFound", async () => {
    useRole("editor");
    await expect(render()).rejects.toThrow("NOT_FOUND");
    useRole("viewer");
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(db.launchReviewView).not.toHaveBeenCalled();
  });

  it("sent: SUBMITTED-H replaces the submit panel", async () => {
    db.launchReviewView.mockResolvedValue(
      reviewView({
        submittedAt: "2026-10-12 15:00:00.000Z",
        domainReady: true,
      }),
    );
    const root = await render();
    expect(root.querySelector("[data-review-sent]")!.textContent).toContain(
      "CDS is giving it a final look.",
    );
  });
});

describe("launch review actions", () => {
  it("staff impersonating: the deny maps to the IMPERSONATING copy", async () => {
    const { ImpersonationDenied } = await import("@cds/core");
    db.markKeyFacts.mockRejectedValue(new ImpersonationDenied());
    const res = await actions.confirmKeyFactsAction();
    expect(res).toMatchObject({
      ok: false,
      message:
        "You're viewing as CDS staff, so this is turned off. Only the owner can approve the launch.",
    });
  });

  it("submit: DomainNotReady -> domain_not_ready with DOMAIN-NOT-READY", async () => {
    db.submitLaunchReview.mockRejectedValue(new db.DomainNotReady("x"));
    const res = await actions.submitLaunchReviewAction();
    expect(res).toEqual({
      ok: false,
      code: "domain_not_ready",
      message:
        "Your domain isn't ready yet. Finish connecting it in Settings › Domain.",
    });
  });

  it("submit ok returns submittedAt", async () => {
    db.submitLaunchReview.mockResolvedValue({ submittedAt: "2026-10-12" });
    const res = await actions.submitLaunchReviewAction();
    expect(res).toEqual({ ok: true, data: { submittedAt: "2026-10-12" } });
  });

  it("phone check runs as the session owner", async () => {
    db.markPhoneCheck.mockResolvedValue(undefined);
    const res = await actions.phoneCheckedAction();
    expect(res.ok).toBe(true);
    expect(db.markPhoneCheck).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG, actor: OWNER }),
    );
  });
});
