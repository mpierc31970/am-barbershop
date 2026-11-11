// @vitest-environment jsdom
// 07-29 Task 3: the History button on the Navigation, Footer, Banner and Site settings tabs
// (CONT-36; 07-UI-SPEC "History"; choices 12-13). Clicking it lists that part's history
// through listSiteHistoryAction; a restore replaces the form's draft and saved baseline (the
// preview shows the restored menu, no "Unsaved changes", no leave-guard) and refreshes.
import { resolveTheme } from "@cds/core/theme";
import { ToastRegion } from "@cds/ui/hub";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }),
  usePathname: () => "/hub/website",
}));
const history = vi.hoisted(() => ({
  listSiteHistoryAction: vi.fn(),
  restoreSiteHistoryAction: vi.fn(),
}));
vi.mock("../app/actions/history", () => history);
vi.mock("../app/actions/site-chrome", () => ({
  saveNavAction: vi.fn(),
  saveFooterAction: vi.fn(),
}));
vi.mock("../app/actions/site-settings", () => ({
  saveSiteSettingsAction: vi.fn(),
}));
vi.mock("../app/actions/banner", () => ({ saveBannerAction: vi.fn() }));

const { NavigationForm } =
  await import("../app/(platform)/hub/website/NavigationForm");
const { FooterForm } = await import("../app/(platform)/hub/website/FooterForm");
const { BannerFields } =
  await import("../app/(platform)/hub/website/BannerForm");
const { SiteSettingsForm } =
  await import("../app/(platform)/hub/website/SiteSettingsForm");

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
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const THEME = resolveTheme(null);
const PAGES = [
  { id: "aaaaaaaaaaaaaa1", title: "Home", path: "/", published: true },
  { id: "aaaaaaaaaaaaaa2", title: "About", path: "/about", published: true },
];
const NAV = {
  items: [
    {
      id: "h",
      label: "Home",
      target: "page:aaaaaaaaaaaaaa1",
      new_tab: false,
      children: [],
    },
  ],
  cta: null,
  held: false,
};
const OLD_ID = "2026-09-27T09-05-00-000Z";
const VERSIONS = [
  {
    id: "2026-09-28T14-14-00-000Z",
    at: "2026-09-28T14:14:00.000Z",
    who: { kind: "member", name: "Maria Lopez" },
    current: true,
  },
  {
    id: OLD_ID,
    at: "2026-09-27T09:05:00.000Z",
    who: { kind: "member", name: "Maria Lopez" },
    current: false,
  },
];

function navForm() {
  return (
    <NavigationForm
      initial={NAV}
      pages={PAGES}
      popups={[]}
      theme={THEME}
      brand={{ name: "Palm Science", logo: null }}
    />
  );
}

async function openHistory(ui: React.ReactElement, part: string) {
  history.listSiteHistoryAction.mockResolvedValue({ ok: true, data: VERSIONS });
  m = mount(<ToastRegion>{ui}</ToastRegion>);
  click(button(m.container, "History"));
  await flush();
  expect(history.listSiteHistoryAction).toHaveBeenCalledWith(part);
  return document.body;
}

describe("History button wiring (07-29)", () => {
  it("Navigation lists the nav part", async () => {
    const el = await openHistory(navForm(), "nav");
    expect(el.textContent).toContain("Navigation history");
  });

  it("Footer lists the footer part", async () => {
    const el = await openHistory(
      <FooterForm
        initial={null}
        pages={PAGES}
        theme={THEME}
        business={{
          name: "Palm Science",
          phone: "",
          public_email: "",
          address: null,
          time_zone: "UTC",
          hours: null,
          socials: [],
        }}
      />,
      "footer",
    );
    expect(el.textContent).toContain("Footer history");
  });

  it("Banner gains a heading row with History and lists the banner part", async () => {
    const el = await openHistory(
      <BannerFields initial={null} timeZone="UTC" theme={THEME} />,
      "banner",
    );
    expect(el.querySelector("h2")?.textContent).toBe("Banner");
    expect(el.textContent).toContain("Banner history");
  });

  it("Site settings lists the settings part", async () => {
    const el = await openHistory(
      <SiteSettingsForm
        initial={{
          language: "en",
          show_translate: false,
          show_search: false,
          allow_ai_crawlers: true,
          share_image: "",
        }}
        theme={THEME}
        previewHeader={{
          brand: { name: "Palm Science", logo: null },
          nav: { entries: [], cta: null },
        }}
        primaryHost={null}
        cookieLine="No cookie notice needed."
      />,
      "settings",
    );
    expect(el.textContent).toContain("Site settings history");
  });

  it("a nav restore replaces the draft and baseline (preview updated, not dirty) and refreshes", async () => {
    const restored = {
      ...NAV,
      items: [
        ...NAV.items,
        {
          id: "a",
          label: "Our story",
          target: "page:aaaaaaaaaaaaaa2",
          new_tab: false,
          children: [],
        },
      ],
    };
    history.restoreSiteHistoryAction.mockResolvedValue({
      ok: true,
      data: {
        part: "nav",
        value: restored,
        at: "2026-09-27T09:05:00.000Z",
        dropped: 0,
      },
    });
    const addSpy = vi.spyOn(window, "addEventListener");
    const el = await openHistory(navForm(), "nav");
    const header = () => el.querySelector("[data-site] header");
    expect(header()?.textContent).not.toContain("Our story");
    click(button(el, /^Restore navigation from /));
    click(button(el, "Restore this version"));
    await flush();
    expect(history.restoreSiteHistoryAction).toHaveBeenCalledWith(
      "nav",
      OLD_ID,
    );
    expect(header()?.textContent).toContain("Our story");
    expect(el.textContent).not.toContain("Unsaved changes");
    expect(addSpy.mock.calls.some(([type]) => type === "beforeunload")).toBe(
      false,
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(el.textContent).toContain("Restored. Your site shows the menu from");
    addSpy.mockRestore();
  });
});
