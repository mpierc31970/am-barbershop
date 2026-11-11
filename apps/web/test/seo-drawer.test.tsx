// @vitest-environment jsdom
// 07-30 Task 3: the SEO & sharing drawer and its action (CONT-14, CONT-35; T-07-30-04).
// The real session module and runAction run against mocked next/headers and @cds/db.
import type { ChecklistItem } from "@cds/core/seo";
import { ToastRegion } from "@cds/ui/hub";
import { act } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const state = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/hub/website/pages/p1",
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  getPage: vi.fn(),
  updatePage: vi.fn(),
  refreshSiteIcons: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const { saveSeoAction, refreshSiteIconsAction } =
  await import("../app/actions/seo");
const { SeoDrawer, seoBadgeLabel, seoChanges, SEO_FIELD_IDS } =
  await import("../app/(platform)/hub/website/pages/[pageId]/SeoDrawer");

const ORG = { id: "org1", name: "Rivera Bakery", primaryHost: "rivera.com" };
const CTX = { orgId: "org1", actor: "u1", role: "owner" };

const PAGE = {
  id: "p1",
  slug: "about-us",
  title: "About us",
  status: "published" as const,
  published_at: "2026-10-01T00:00:00.000Z",
  has_unpublished_changes: false,
  kind: "builder" as const,
  password_protected: false,
  seo: {
    meta_description: "Old description",
    og_image: "https://images.unsplash.com/a",
  },
  previous_slugs: [],
};

function signIn() {
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "owner@rivera.com",
    organizations: [ORG],
  });
  db.orgContextFromToken.mockResolvedValue(CTX);
}

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

let m: Mounted | null = null;
beforeEach(() => {
  state.jar.clear();
  for (const fn of Object.values(db)) fn.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = "";
});

describe("saveSeoAction (T-07-30-04)", () => {
  it("copies only the five keys and merges them over the page's SEO", async () => {
    signIn();
    db.getPage.mockResolvedValue(PAGE);
    db.updatePage.mockResolvedValue(PAGE);
    db.refreshSiteIcons.mockResolvedValue(null);
    const res = await saveSeoAction("p1", {
      meta_title: "About Rivera",
      share_image: "abc123def456ghi",
      organization: "org2",
      held: true,
      __proto__: { evil: 1 },
    } as never);
    expect(res.ok).toBe(true);
    expect(db.updatePage).toHaveBeenCalledWith(CTX, "p1", {
      seo: {
        meta_description: "Old description",
        meta_title: "About Rivera",
        share_image: "abc123def456ghi",
      },
    });
    const sent = db.updatePage.mock.calls[0]![2] as Record<string, unknown>;
    expect(JSON.stringify(sent)).not.toContain("org2");
    expect(sent).not.toHaveProperty("organization");
  });

  it("passes a slug change and a pasted link (which clears the photo)", async () => {
    signIn();
    db.getPage.mockResolvedValue({
      ...PAGE,
      seo: { share_image: "abc123def456ghi" },
    });
    db.updatePage.mockResolvedValue(PAGE);
    db.refreshSiteIcons.mockResolvedValue(null);
    await saveSeoAction("p1", {
      slug: "our-story",
      og_image: "https://images.pexels.com/x",
    });
    expect(db.updatePage).toHaveBeenCalledWith(CTX, "p1", {
      slug: "our-story",
      seo: { og_image: "https://images.pexels.com/x" },
    });
  });

  it("signed out never reaches @cds/db; refreshSiteIconsAction never surfaces an error", async () => {
    const out = await saveSeoAction("p1", { meta_title: "x" });
    expect(out.ok).toBe(false);
    expect(db.updatePage).not.toHaveBeenCalled();
    signIn();
    db.refreshSiteIcons.mockRejectedValue(new Error("boom"));
    expect(await refreshSiteIconsAction()).toEqual({
      ok: true,
      data: { ok: true, icons: null },
    });
    // WR-C06: a regeneration is told the Next invalidator, so the cached `v` is dropped.
    db.refreshSiteIcons.mockResolvedValue({
      v: "abcdef012345",
      source: "logo",
    });
    expect(await refreshSiteIconsAction()).toEqual({
      ok: true,
      data: { ok: true, icons: { v: "abcdef012345", source: "logo" } },
    });
    expect(db.refreshSiteIcons).toHaveBeenLastCalledWith(CTX, {
      invalidator: expect.objectContaining({
        invalidate: expect.any(Function),
      }),
    });
  });
});

const ITEMS: ChecklistItem[] = [
  {
    id: "description",
    group: "search",
    status: "check",
    text: "Add a description so search results say what this page is about.",
    fix: { kind: "field", field: "description" },
  },
  {
    id: "in-menu",
    group: "search",
    status: "check",
    text: "This page isn't in your menu. Visitors can only reach it by a link.",
    fix: { kind: "href", href: "/hub/website?tab=navigation" },
  },
  {
    id: "photos",
    group: "accessibility",
    status: "fine",
    text: "Every photo has a description",
  },
];

describe("seoBadgeLabel and seoChanges", () => {
  it("counts amber items", () => {
    expect(seoBadgeLabel(ITEMS)).toBe("2 to check");
    expect(seoBadgeLabel(ITEMS.filter((i) => i.status === "fine"))).toBeNull();
  });

  it("only changed keys", () => {
    const base = {
      meta_title: "",
      meta_description: "D",
      slug: "about-us",
      share_image: "",
      og_image: "",
      og_credit: "",
    };
    expect(seoChanges(base, { ...base })).toEqual({});
    expect(seoChanges(base, { ...base, meta_title: " New " })).toEqual({
      meta_title: "New",
    });
  });
});

describe("SeoDrawer", () => {
  function open(save = vi.fn(), onFix = vi.fn()) {
    m = mount(
      <ToastRegion>
        <SeoDrawer
          open
          onClose={vi.fn()}
          page={{ ...PAGE, seo: { meta_description: "Old description" } }}
          host="rivera.com"
          businessName="Rivera Bakery"
          sections={[
            {
              id: "s1",
              section_type: "text-only",
              content: { text: "<p>We bake.</p>" },
            },
          ]}
          checklist={ITEMS}
          siteSharePreview={null}
          onSaved={vi.fn()}
          onFix={onFix}
          save={save}
        />
      </ToastRegion>,
    );
    return { save, onFix };
  }

  it("shows the search preview with the suggestion and the counters", async () => {
    open();
    await flush();
    const preview = document.querySelector("[data-search-preview]")!;
    expect(preview.textContent).toContain("rivera.com › about-us");
    expect(preview.textContent).toContain("About us | Rivera Bakery");
    expect(document.body.textContent).toContain(
      "Suggested: About us | Rivera Bakery",
    );
    expect(document.body.textContent).toContain("15 / 160");
    expect(button(document.body, "Save SEO settings")!.disabled).toBe(true);
  });

  it("Fix on the description focuses the field; a href target goes back", async () => {
    const { onFix } = open();
    await flush();
    click(button(document.body, `Fix: ${ITEMS[0]!.text}`));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(document.activeElement?.id).toBe(SEO_FIELD_IDS.description);
    click(button(document.body, `Fix: ${ITEMS[1]!.text}`));
    expect(onFix).toHaveBeenCalledWith({
      kind: "href",
      href: "/hub/website?tab=navigation",
    });
  });

  it("Use this copies the suggestion; save sends only the changed keys", async () => {
    const save = vi.fn(async () => ({
      ok: true as const,
      data: {
        page: { ...PAGE, seo: { meta_title: "About us | Rivera Bakery" } },
      },
    }));
    open(save);
    await flush();
    click(button(document.body, "Use this"));
    await flush();
    const title = document.getElementById(
      SEO_FIELD_IDS.title,
    ) as HTMLInputElement;
    expect(title.value).toBe("About us | Rivera Bakery");
    click(button(document.body, "Save SEO settings"));
    await flush();
    expect(save).toHaveBeenCalledWith("p1", {
      meta_title: "About us | Rivera Bakery",
    });
    expect(document.body.textContent).toContain(
      "SEO settings saved. They go live when you publish.",
    );
  });

  it("a changed address shows the redirect note; a failed save shows the error", async () => {
    const save = vi.fn(async () => ({
      ok: false as const,
      code: "failed",
      message: "Something went wrong saving this.",
    }));
    open(save);
    await flush();
    const address = document.getElementById(
      SEO_FIELD_IDS.address,
    ) as HTMLInputElement;
    typeInto(address, "our-story");
    await flush();
    expect(document.body.textContent).toContain(
      "Visitors using /about-us are sent here automatically.",
    );
    click(button(document.body, "Save SEO settings"));
    await flush();
    expect(document.body.textContent).toContain(
      "Something went wrong saving this.",
    );
    click(button(document.body, "Discard changes"));
    await flush();
    expect(
      (document.getElementById(SEO_FIELD_IDS.address) as HTMLInputElement)
        .value,
    ).toBe("about-us");
  });
});
