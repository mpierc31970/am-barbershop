// @vitest-environment jsdom
// Hub header primitives (11-15; DASH-18, DASH-28, DASH-17, DASH-32; 11-UI-SPEC "Header",
// "Org switcher", "NotLiveYet", "Help"; D-UI-P11-2..5, 16).
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { button, click, mount, type Mounted } from "../../test-support/dom";
import {
  NotLiveYet,
  OrgSwitcher,
  ProfileMenu,
  SHELL_COPY,
  ScreenHeader,
  TopBar,
  type ShellOrg,
} from "./index";

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

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

const ORGS: ShellOrg[] = [
  { id: "o2", name: "Lopez Spa", role: "Staff" },
  { id: "o1", name: "Rivera Bakery", role: "Owner" },
];

function key(el: Element, k: string, init: KeyboardEventInit = {}): void {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }),
    );
  });
}

describe("OrgSwitcher", () => {
  it("renders nothing for one site", () => {
    mounted = mount(
      <OrgSwitcher
        orgs={[ORGS[1]!]}
        currentId="o1"
        onSwitch={() => undefined}
      />,
    );
    expect(mounted.container.innerHTML).toBe("");
  });

  it("lists every site with its role, current first and selected", () => {
    mounted = mount(
      <OrgSwitcher orgs={ORGS} currentId="o1" onSwitch={() => undefined} />,
    );
    const trigger = button(
      mounted.container,
      "Switch site, current: Rivera Bakery",
    );
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute("aria-expanded")).toBe("false");
    click(trigger);
    expect(trigger!.getAttribute("aria-expanded")).toBe("true");
    const list = mounted.container.querySelector('[role="listbox"]');
    expect(list).not.toBeNull();
    const options = Array.from(list!.querySelectorAll('[role="option"]'));
    expect(options).toHaveLength(2);
    expect(options[0]!.textContent).toContain("Rivera Bakery");
    expect(options[0]!.textContent).toContain("Owner");
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    expect(options[1]!.textContent).toContain("Lopez Spa");
    expect(options[1]!.textContent).toContain("Staff");
    expect(options[1]!.getAttribute("aria-selected")).toBe("false");
  });

  it("choosing another site calls onSwitch with its id", () => {
    const onSwitch = vi.fn();
    mounted = mount(
      <OrgSwitcher orgs={ORGS} currentId="o1" onSwitch={onSwitch} />,
    );
    click(button(mounted.container, /^Switch site/));
    const lopez = Array.from(
      mounted.container.querySelectorAll('[role="option"]'),
    ).find((o) => o.textContent?.includes("Lopez Spa"));
    click(lopez);
    expect(onSwitch).toHaveBeenCalledWith("o2");
    expect(mounted.container.textContent).toContain(SHELL_COPY.switching);
  });

  it("choosing the current site just closes", () => {
    const onSwitch = vi.fn();
    mounted = mount(
      <OrgSwitcher orgs={ORGS} currentId="o1" onSwitch={onSwitch} />,
    );
    click(button(mounted.container, /^Switch site/));
    click(mounted.container.querySelector('[aria-selected="true"]'));
    expect(onSwitch).not.toHaveBeenCalled();
    expect(mounted.container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("Esc closes the list and returns focus to the button", () => {
    mounted = mount(
      <OrgSwitcher orgs={ORGS} currentId="o1" onSwitch={() => undefined} />,
    );
    const trigger = button(mounted.container, /^Switch site/)!;
    click(trigger);
    const list = mounted.container.querySelector('[role="listbox"]')!;
    key(list, "Escape");
    expect(mounted.container.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("arrow keys move the active option", () => {
    mounted = mount(
      <OrgSwitcher orgs={ORGS} currentId="o1" onSwitch={() => undefined} />,
    );
    click(button(mounted.container, /^Switch site/));
    const list = mounted.container.querySelector('[role="listbox"]')!;
    const first = list.getAttribute("aria-activedescendant");
    key(list, "ArrowDown");
    const second = list.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    expect(document.getElementById(second!)?.textContent).toContain(
      "Lopez Spa",
    );
  });
});

describe("ScreenHeader", () => {
  it("renders one h1 and a help button for the screen", () => {
    const onHelp = vi.fn();
    mounted = mount(
      <ScreenHeader title="Today" helpId="today" onHelp={onHelp} />,
    );
    expect(mounted.container.querySelectorAll("h1")).toHaveLength(1);
    expect(mounted.container.querySelector("h1")!.textContent).toBe("Today");
    const help = button(mounted.container, "How Today works");
    expect(help).not.toBeNull();
    click(help);
    expect(onHelp).toHaveBeenCalledWith("today");
  });

  it("without onHelp the help control is a link to the how-to", () => {
    mounted = mount(<ScreenHeader title="Today" helpId="today" />);
    const link = mounted.container.querySelector<HTMLAnchorElement>(
      'a[aria-label="How Today works"]',
    );
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/hub/help/today");
    expect(button(mounted.container, "How Today works")).toBeNull();
  });

  it("renders the right-aligned actions", () => {
    mounted = mount(
      <ScreenHeader title="Reports" helpId="reports">
        <button type="button">Customize</button>
      </ScreenHeader>,
    );
    expect(button(mounted.container, "Customize")).not.toBeNull();
  });
});

describe("NotLiveYet", () => {
  it("shows the held heading and the default body", () => {
    mounted = mount(<NotLiveYet />);
    expect(mounted.container.textContent).toContain("Starts when you go live");
    expect(mounted.container.textContent).toContain(SHELL_COPY.notLiveBody);
  });

  it("takes a per-use body and note", () => {
    mounted = mount(
      <NotLiveYet what="Your Site Report starts after launch." note="Soon" />,
    );
    expect(mounted.container.textContent).toContain(
      "Your Site Report starts after launch.",
    );
    expect(mounted.container.textContent).toContain("Soon");
  });
});

describe("ProfileMenu", () => {
  it("opens with the profile link and Sign out", () => {
    const onSignOut = vi.fn();
    mounted = mount(
      <ProfileMenu
        name="Maria Rivera"
        email="maria@example.com"
        roleLine="Owner at Rivera Bakery"
        onSignOut={onSignOut}
      />,
    );
    const trigger = button(mounted.container, "Your profile and sign out")!;
    expect(trigger).not.toBeNull();
    click(trigger);
    const menu = mounted.container.querySelector('[role="menu"]')!;
    const panel = menu.parentElement!;
    expect(panel.textContent).toContain("Maria Rivera");
    expect(panel.textContent).toContain("maria@example.com");
    expect(panel.textContent).toContain("Owner at Rivera Bakery");
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    const link = menu.querySelector<HTMLAnchorElement>('a[role="menuitem"]');
    expect(link!.textContent).toContain("Your profile and alerts");
    expect(link!.getAttribute("href")).toBe("/hub/profile");
    const signOut = button(menu, "Sign out");
    click(signOut);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("A&M: own items replace the profile link; Take a photo posts to the seat's gallery", () => {
    mounted = mount(
      <ProfileMenu
        name="Ana"
        email=""
        onSignOut={() => {}}
        links={[
          { href: "/hub/studio-booking/seats/s1", label: "My page" },
          { href: "/hub/alerts", label: "Alerts" },
        ]}
        photoSeatId="s1"
      />,
    );
    click(button(mounted.container, "Your profile and sign out")!);
    const menu = mounted.container.querySelector('[role="menu"]')!;
    const links = [
      ...menu.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"]'),
    ].map((a) => a.textContent);
    expect(links).toEqual(["My page", "Alerts"]);
    expect(menu.textContent).not.toContain("Your profile and alerts");
    const form = menu.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/hub/api/studio/photo");
    const file = form.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(file.getAttribute("accept")).toBe("image/*");
    expect(file.getAttribute("capture")).toBe("environment");
    expect(
      form.querySelector<HTMLInputElement>('input[name="target"]')!.value,
    ).toBe("gallery");
    expect(
      form.querySelector<HTMLInputElement>('input[name="seatId"]')!.value,
    ).toBe("s1");
    expect(button(menu, "Take a photo")).not.toBeNull();
    expect(button(menu, "Sign out")).not.toBeNull();
  });

  it("Esc closes and returns focus", () => {
    mounted = mount(
      <ProfileMenu name="Maria" email="m@example.com" onSignOut={() => {}} />,
    );
    const trigger = button(mounted.container, "Your profile and sign out")!;
    click(trigger);
    const menu = mounted.container.querySelector('[role="menu"]')!;
    key(menu, "Escape");
    expect(mounted.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("TopBar", () => {
  const profile = {
    name: "Maria",
    email: "m@example.com",
    onSignOut: () => undefined,
  };

  it("is a header with Jump to, the bell slot and the profile menu", () => {
    mounted = mount(
      <TopBar
        orgs={ORGS}
        currentOrgId="o1"
        onSwitch={() => undefined}
        jumpIndex={[]}
        bell={<button type="button">Alerts</button>}
        profile={profile}
        viewSiteHref="https://riverabakery.com"
      />,
    );
    expect(mounted.container.querySelector("header")).not.toBeNull();
    const jump = button(mounted.container, SHELL_COPY.jumpButtonName)!;
    expect(jump.getAttribute("aria-keyshortcuts")).toBe("Control+K Meta+K");
    expect(button(mounted.container, "Alerts")).not.toBeNull();
    expect(
      button(mounted.container, "Your profile and sign out"),
    ).not.toBeNull();
    expect(
      button(mounted.container, "Switch site, current: Rivera Bakery"),
    ).not.toBeNull();
    const view = mounted.container.querySelector<HTMLAnchorElement>(
      'a[href="https://riverabakery.com"]',
    );
    expect(view?.textContent).toContain("View site");
  });

  it("one site shows the name without a switcher", () => {
    mounted = mount(
      <TopBar
        orgs={[ORGS[1]!]}
        currentOrgId="o1"
        onSwitch={() => undefined}
        jumpIndex={[]}
        profile={profile}
      />,
    );
    expect(button(mounted.container, /^Switch site/)).toBeNull();
    expect(mounted.container.textContent).toContain("Rivera Bakery");
  });

  it("the Jump to button opens the palette", () => {
    mounted = mount(
      <TopBar
        orgs={[ORGS[1]!]}
        currentOrgId="o1"
        onSwitch={() => undefined}
        jumpIndex={[{ group: "Screens", label: "Today", href: "/hub/today" }]}
        profile={profile}
      />,
    );
    click(button(mounted.container, SHELL_COPY.jumpButtonName));
    expect(document.querySelector("dialog[open]")).not.toBeNull();
    expect(document.querySelector('[role="combobox"]')).not.toBeNull();
  });
});
