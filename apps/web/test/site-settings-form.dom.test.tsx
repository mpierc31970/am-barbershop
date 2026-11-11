// @vitest-environment jsdom
// 07-26 Task 3: Site settings form and the Navigation Search switch (CONT-29; choices 9-12).
// Only changed keys are saved; an invalid Other code shows its inline error and never
// calls the action; Navigation saves the menu, then the switch only when it changed.
import { SITE_SETTINGS_COPY } from "@cds/core/content";
import { resolveTheme } from "@cds/core/theme";
import { ToastRegion } from "@cds/ui/hub";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const saveSiteSettingsAction = vi.hoisted(() => vi.fn());
const saveNavAction = vi.hoisted(() => vi.fn());
vi.mock("../app/actions/site-settings", () => ({ saveSiteSettingsAction }));
vi.mock("../app/actions/site-chrome", () => ({ saveNavAction }));
// 07-29: the forms' History drawer needs the App Router and the history actions.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../app/actions/history", () => ({
  listSiteHistoryAction: vi.fn(),
  restoreSiteHistoryAction: vi.fn(),
}));

const { SiteSettingsForm } =
  await import("../app/(platform)/hub/website/SiteSettingsForm");
const { NavigationForm } =
  await import("../app/(platform)/hub/website/NavigationForm");

const THEME = resolveTheme(null);
const GROUP = {
  language: "en",
  show_translate: false,
  show_search: false,
  allow_ai_crawlers: true,
  share_image: "",
};

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function select(el: Element | null, value: string) {
  const s = el as HTMLSelectElement;
  act(() => {
    s.value = value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function toggle(id: string) {
  click(m!.container.querySelector(`#${id}`));
}

function openSettings(initial = GROUP) {
  m = mount(
    <ToastRegion>
      <SiteSettingsForm
        initial={initial}
        theme={THEME}
        previewHeader={{
          brand: { name: "Rivera", logo: null },
          nav: { entries: [], cta: null },
        }}
        primaryHost="rivera.com"
        cookieLine="No cookie notice needed."
      />
    </ToastRegion>,
  );
}

describe("SiteSettingsForm", () => {
  it("Other… reveals the Language code field", () => {
    openSettings();
    expect(m!.container.querySelector("#site-language-other")).toBeNull();
    select(m!.container.querySelector("#site-language"), "other");
    expect(m!.container.textContent).toContain(SITE_SETTINGS_COPY.otherLabel);
    expect(m!.container.querySelector("#site-language-other")).not.toBeNull();
  });

  it("an invalid code shows the inline error and never saves", async () => {
    openSettings();
    select(m!.container.querySelector("#site-language"), "other");
    typeInto(m!.container.querySelector("#site-language-other"), "english!");
    click(button(m!.container, "Save settings"));
    await flush();
    expect(m!.container.textContent).toContain(
      SITE_SETTINGS_COPY.invalidLanguage,
    );
    expect(saveSiteSettingsAction).not.toHaveBeenCalled();
  });

  it("saves only the changed keys and toasts", async () => {
    openSettings();
    saveSiteSettingsAction.mockResolvedValue({
      ok: true,
      data: { settings: { ...GROUP, language: "pt-BR", show_translate: true } },
    });
    select(m!.container.querySelector("#site-language"), "other");
    typeInto(m!.container.querySelector("#site-language-other"), "PT-br");
    toggle("site-translate");
    expect(document.querySelector("[data-cds-translate]")).not.toBeNull();
    click(button(m!.container, "Save settings"));
    await flush();
    expect(saveSiteSettingsAction).toHaveBeenCalledWith({
      language: "pt-BR",
      show_translate: true,
    });
    expect(document.body.textContent).toContain(SITE_SETTINGS_COPY.saved);
  });

  it("an action failure shows the ERR-SAVE alert", async () => {
    openSettings();
    saveSiteSettingsAction.mockRejectedValue(new Error("network"));
    toggle("site-ai");
    click(button(m!.container, "Save settings"));
    await flush();
    expect(saveSiteSettingsAction).toHaveBeenCalledWith({
      allow_ai_crawlers: false,
    });
    expect(m!.container.textContent).toContain("Your changes weren't saved.");
  });
});

describe("NavigationForm Search switch", () => {
  function openNav(showSearch = false) {
    m = mount(
      <ToastRegion>
        <NavigationForm
          initial={null}
          pages={[]}
          popups={[]}
          theme={THEME}
          brand={{ name: "Rivera", logo: null }}
          showSearch={showSearch}
        />
      </ToastRegion>,
    );
  }

  it("toggling previews the search link and saves nav, then the switch", async () => {
    openNav();
    expect(
      m!.container.querySelector('[aria-label="Search this site"]'),
    ).toBeNull();
    toggle("nav-show-search");
    expect(
      m!.container.querySelector('a[aria-label="Search this site"]'),
    ).not.toBeNull();
    saveNavAction.mockResolvedValue({
      ok: true,
      data: { nav: { items: [], cta: null, held: false }, held: false },
    });
    saveSiteSettingsAction.mockResolvedValue({
      ok: true,
      data: { settings: { ...GROUP, show_search: true } },
    });
    click(button(m!.container, "Save navigation"));
    await flush();
    expect(saveNavAction).toHaveBeenCalledTimes(1);
    expect(saveSiteSettingsAction).toHaveBeenCalledWith({ show_search: true });
  });

  it("an unchanged switch saves the nav only", async () => {
    openNav(true);
    saveNavAction.mockResolvedValue({
      ok: true,
      data: { nav: { items: [], cta: null, held: false }, held: false },
    });
    click(button(m!.container, "Save navigation"));
    await flush();
    expect(saveNavAction).toHaveBeenCalledTimes(1);
    expect(saveSiteSettingsAction).not.toHaveBeenCalled();
  });

  it("a failing switch save keeps the nav toast and shows ERR-SAVE", async () => {
    openNav();
    toggle("nav-show-search");
    saveNavAction.mockResolvedValue({
      ok: true,
      data: { nav: { items: [], cta: null, held: false }, held: false },
    });
    saveSiteSettingsAction.mockResolvedValue({ ok: false, message: "x" });
    click(button(m!.container, "Save navigation"));
    await flush();
    expect(document.body.textContent).toContain("Menu saved");
    expect(m!.container.textContent).toContain("Your changes weren't saved.");
    expect(
      (m!.container.querySelector("#nav-show-search") as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});
