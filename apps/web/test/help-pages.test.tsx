// /hub/help and /hub/help/<id> (11-46; DASH-17; T-11-46-01): the server builds the
// grant-filtered list; an article the person may not read is a 404.
import type { ReactElement, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  usePathname: () => "/hub/help",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));

const db = vi.hoisted(() => ({
  activeAddons: vi.fn(async () => [] as string[]),
  getOrgStage: vi.fn(async () => ({ stage: "live", path: "standard" })),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const CTX: Record<string, unknown> = {
  orgId: "orgaaaaaaaaaaa1",
  actor: "u1",
  role: "owner",
  grants: [],
  ip: "",
};
const SESSION = {
  ctx: CTX,
  email: "ana@rivera.example",
  org: { id: "orgaaaaaaaaaaa1", name: "Rivera Bakery", primaryHost: null },
  orgs: [],
  staleOrg: false,
};
vi.mock("../lib/session", async (orig) => ({
  ...(await orig<typeof import("../lib/session")>()),
  requireHubSession: async () => SESSION,
}));

const { default: HelpCenterPage } =
  await import("../app/(platform)/hub/help/page");
const { default: HelpArticlePage } =
  await import("../app/(platform)/hub/help/[id]/page");

async function center(): Promise<string> {
  return renderToStaticMarkup((await HelpCenterPage()) as ReactElement);
}
async function article(id: string): Promise<string> {
  return renderToStaticMarkup(
    (await HelpArticlePage({
      params: Promise.resolve({ id }),
    })) as ReactElement,
  );
}

afterEach(() => {
  CTX.role = "owner";
  CTX.grants = [];
  db.activeAddons.mockResolvedValue([]);
  db.getOrgStage.mockResolvedValue({ stage: "live", path: "standard" });
});

describe("/hub/help (DASH-17)", () => {
  it("Owner, live site: Your site, no billing; no Getting set up", async () => {
    const html = await center();
    expect(html).toContain(">Help</h1>");
    expect(html).toContain("Your site");
    expect(html).not.toContain("Getting set up");
    expect(html).toContain('href="/hub/help/people-roles"');
    expect(html).not.toContain('href="/hub/help/billing"');
    expect(html).not.toContain("Your add-ons");
  });

  it("before launch lists Getting set up; active add-ons list Your add-ons", async () => {
    db.getOrgStage.mockResolvedValue({ stage: "intake", path: "standard" });
    db.activeAddons.mockResolvedValue(["testimonials"]);
    const html = await center();
    expect(html).toContain("Getting set up");
    expect(html).toContain("Your add-ons");
    expect(html).toContain('href="/hub/help/addon-testimonials"');
  });

  it("Viewer: no owner-only rows", async () => {
    CTX.role = "viewer";
    const html = await center();
    expect(html).not.toContain('href="/hub/help/billing"');
    expect(html).not.toContain('href="/hub/help/download-data"');
    expect(html).toContain('href="/hub/help/today"');
  });

  it("a failed add-on read still renders the core articles", async () => {
    db.activeAddons.mockRejectedValueOnce(new Error("pb down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await center();
    expect(html).toContain('href="/hub/help/today"');
    err.mockRestore();
  });
});

describe("/hub/help/<id> (DASH-17)", () => {
  it("renders numbered Turn it on and Use it steps", async () => {
    const html = await article("today");
    expect(html).toContain(">Today</h1>");
    expect(html).toContain("Turn it on");
    expect(html).toContain("Use it");
    expect(html).toContain("<ol");
    expect(html).toContain("Go to Today");
  });

  it("resolves a screen help id and offers the screen", async () => {
    const html = await article("settings.people");
    expect(html).toContain(">People &amp; roles</h1>");
    expect(html).toContain("Go to Settings › People &amp; roles");
  });

  it("a Viewer opening download-data gets 404", async () => {
    CTX.role = "viewer";
    await expect(article("download-data")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("an unknown id or an inactive add-on is 404", async () => {
    await expect(article("nope")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(article("addon-testimonials")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("support resolves (CDS Support's ? and Today's links)", async () => {
    expect(await article("support")).toContain(">CDS Support</h1>");
    expect(await article("google-business-profile")).toContain(
      "Check your Google Business Profile",
    );
  });
});
