// @vitest-environment jsdom
// Staff console shell (13-09; STAFF-05; 13-UI-SPEC "Shell", "StaffFind", "ShortcutSheet";
// WCAG 2.1.4 single-key shortcuts can be turned off and are ignored while typing).
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
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import {
  SHORTCUTS_STORAGE_KEY,
  StaffShell,
  formatNavBadge,
  type StaffNavItem,
  type StaffShellProps,
} from "./index";
import { useInboxShortcuts } from "../tickets";

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
beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

const NAV: StaffNavItem[] = [
  {
    key: "today",
    href: "/staff",
    label: "Today",
    icon: "House",
    current: true,
  },
  {
    key: "tickets",
    href: "/staff/tickets",
    label: "Tickets",
    icon: "LifeBuoy",
    badge: 12,
  },
  {
    key: "pipeline",
    href: "/staff/pipeline",
    label: "Pipeline",
    icon: "SquareKanban",
    badge: 3,
  },
  {
    key: "review",
    href: "/staff/review",
    label: "Review queue",
    icon: "ShieldCheck",
  },
  { key: "sites", href: "/staff/sites", label: "Sites", icon: "Globe" },
  { key: "catalog", href: "/staff/catalog", label: "Catalog", icon: "Package" },
  {
    key: "health",
    href: "/staff/health",
    label: "Health",
    icon: "Activity",
    badge: 0,
  },
  {
    key: "settings",
    href: "/staff/settings",
    label: "Settings",
    icon: "Settings",
  },
];

function renderShell(over: Partial<StaffShellProps> = {}) {
  const searchTickets = vi.fn(async (q: string) => {
    void q;
    return [
      {
        number: 1001,
        subject: "Menu broken",
        href: "/staff/tickets/1001",
        site: "Rivera Bakery",
      },
      {
        number: 1042,
        subject: "Hours wrong",
        href: "/staff/tickets/1042",
        site: "Bella's Salon",
      },
    ];
  });
  const onNavigate = vi.fn();
  const props: StaffShellProps = {
    nav: NAV,
    user: { name: "Mara Lin", roleLabel: "Super Admin" },
    env: "production",
    signOutAction: vi.fn(),
    findIndex: [
      {
        group: "Sites",
        label: "Rivera Bakery",
        href: "/staff/sites/org1",
        keywords: "rivera.example",
      },
      { group: "Cases", label: "R-31", href: "/staff/review/R-31" },
      { group: "Screens", label: "Tickets", href: "/staff/tickets" },
    ],
    searchTickets,
    onNavigate,
    children: <p data-testid="content">Body</p>,
    ...over,
  };
  mounted = mount(<StaffShell {...props} />);
  return { props, searchTickets, onNavigate };
}

function keydown(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = document.body,
) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

async function wait(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe("formatNavBadge", () => {
  it("caps at 9+ and hides zero", () => {
    expect(formatNavBadge(undefined)).toBeNull();
    expect(formatNavBadge(0)).toBeNull();
    expect(formatNavBadge(3)).toBe("3");
    expect(formatNavBadge(12)).toBe("9+");
  });
});

describe("StaffShell", () => {
  it("marks its root with data-cds-identity and renders children", () => {
    renderShell();
    const root = mounted!.container.querySelector("[data-cds-identity]");
    expect(root).not.toBeNull();
    expect(root!.querySelector('[data-testid="content"]')).not.toBeNull();
    expect(mounted!.container.querySelector("main")).not.toBeNull();
  });

  it("renders the nav in the given order with aria-current on the current item", () => {
    renderShell();
    const nav = mounted!.container.querySelector(
      'nav[aria-label="Staff console"]',
    );
    expect(nav).not.toBeNull();
    const links = Array.from(nav!.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      NAV.map((n) => n.href),
    );
    expect(links[0]!.getAttribute("aria-current")).toBe("page");
    expect(links.filter((a) => a.hasAttribute("aria-current"))).toHaveLength(1);
  });

  it("shows a neutral 9+ badge with an sr-only need-attention suffix", () => {
    renderShell();
    const nav = mounted!.container.querySelector(
      'nav[aria-label="Staff console"]',
    )!;
    const tickets = Array.from(nav.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/staff/tickets",
    )!;
    const chip = tickets.querySelector("[data-nav-badge]")!;
    expect(chip.textContent).toBe("9+");
    expect(chip.className).not.toMatch(/danger/);
    const sr = tickets.querySelector(".sr-only")!;
    expect(sr.textContent).toMatch(/need attention/);
    expect(sr.textContent).toContain("12");
    const health = Array.from(nav.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/staff/health",
    )!;
    expect(health.querySelector("[data-nav-badge]")).toBeNull();
  });

  it("shows the Dev badge only outside production", () => {
    renderShell({ env: "production" });
    expect(mounted!.container.querySelector("[data-env-badge]")).toBeNull();
    mounted!.unmount();
    renderShell({ env: "dev" });
    const badges = mounted!.container.querySelectorAll("[data-env-badge]");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0]!.textContent).toBe("Dev");
  });

  it("shows the signed-in user, role and Sign out", () => {
    renderShell();
    const text = mounted!.container.textContent ?? "";
    expect(text).toContain("Mara Lin");
    expect(text).toContain("Super Admin");
    expect(text).toContain("All times Central");
    expect(button(mounted!.container, "Sign out")).not.toBeNull();
  });

  it("opens the phone drawer with the same nav", () => {
    renderShell();
    click(button(mounted!.container, "Open menu"));
    const drawer = document.querySelector('dialog[aria-label="Menu"]')!;
    expect(drawer.hasAttribute("open")).toBe(true);
    expect(
      drawer.querySelector('nav[aria-label="Staff console"]'),
    ).not.toBeNull();
  });
});

describe("StaffFind", () => {
  it("opens on Ctrl+K and searches tickets with the typed text", async () => {
    const { searchTickets } = renderShell();
    keydown("k", { ctrlKey: true });
    const input = document.querySelector<HTMLInputElement>(
      'dialog[open] input[role="combobox"]',
    );
    expect(input).not.toBeNull();
    typeInto(input, "#1042");
    await wait(250);
    expect(searchTickets).toHaveBeenCalledWith("#1042");
    const options = Array.from(
      document.querySelectorAll('dialog[open] [role="option"]'),
    );
    // The exact ticket number goes first.
    expect(options[0]!.textContent).toContain("#1042");
  });

  it("groups sites and cases from the static index and navigates on Enter", async () => {
    const { onNavigate } = renderShell();
    keydown("k", { metaKey: true });
    const input = document.querySelector<HTMLInputElement>(
      'dialog[open] input[role="combobox"]',
    )!;
    typeInto(input, "rivera");
    await wait(250);
    const groups = Array.from(
      document.querySelectorAll('dialog[open] [role="group"]'),
    ).map((g) => g.getAttribute("aria-label"));
    expect(groups).toContain("Sites");
    keydown("Enter", {}, input);
    expect(onNavigate).toHaveBeenCalled();
  });

  it("ArrowDown scrolls the active option into view (WR-E12)", async () => {
    renderShell();
    keydown("k", { ctrlKey: true });
    const input = document.querySelector<HTMLInputElement>(
      'dialog[open] input[role="combobox"]',
    )!;
    typeInto(input, "#1042");
    await wait(250);
    const proto = Element.prototype as Element & {
      scrollIntoView?: (arg?: ScrollIntoViewOptions) => void;
    };
    const had = proto.scrollIntoView;
    const seen: Element[] = [];
    proto.scrollIntoView = function (this: Element) {
      seen.push(this);
    };
    try {
      keydown("ArrowDown", {}, input);
      const options = Array.from(
        document.querySelectorAll('dialog[open] [role="option"]'),
      );
      expect(options.length).toBeGreaterThan(1);
      expect(seen.at(-1)).toBe(options[1]);
    } finally {
      proto.scrollIntoView = had;
    }
  });

  it("shows the empty line when nothing matches", async () => {
    const { searchTickets } = renderShell();
    searchTickets.mockResolvedValue([]);
    keydown("k", { ctrlKey: true });
    const input = document.querySelector<HTMLInputElement>(
      'dialog[open] input[role="combobox"]',
    )!;
    typeInto(input, "zzzz");
    await wait(250);
    expect(document.querySelector("dialog[open]")!.textContent).toContain(
      "No match for “zzzz”. Try a ticket number, a business name or a host.",
    );
  });
});

describe("ShortcutSheet", () => {
  it("opens on ? and lists the shortcuts", () => {
    renderShell();
    keydown("?", { shiftKey: true });
    const sheet = document.querySelector(
      'dialog[aria-label="Keyboard shortcuts"]',
    )!;
    expect(sheet.hasAttribute("open")).toBe(true);
    expect(sheet.textContent).toContain("Ctrl K");
    expect(sheet.textContent).toContain("Turn off single-key shortcuts");
  });

  it("ignores ? while typing in a text field", () => {
    renderShell();
    const field = document.createElement("input");
    document.body.appendChild(field);
    keydown("?", { shiftKey: true }, field);
    const sheet = document.querySelector(
      'dialog[aria-label="Keyboard shortcuts"]',
    )!;
    expect(sheet.hasAttribute("open")).toBe(false);
  });

  it("with shortcuts off, ? does not open the sheet; the switch stores the choice", () => {
    renderShell();
    click(button(mounted!.container, "Keyboard shortcuts"));
    const sheet = document.querySelector(
      'dialog[aria-label="Keyboard shortcuts"]',
    )!;
    const sw = sheet.querySelector<HTMLInputElement>('input[role="switch"]')!;
    click(sw);
    expect(window.localStorage.getItem(SHORTCUTS_STORAGE_KEY)).toBe("off");
    click(button(sheet, "Close"));
    expect(sheet.hasAttribute("open")).toBe(false);
    keydown("?", { shiftKey: true });
    expect(sheet.hasAttribute("open")).toBe(false);
  });

  it("starts off when localStorage already says off", () => {
    window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, "off");
    renderShell();
    keydown("?", { shiftKey: true });
    const sheet = document.querySelector(
      'dialog[aria-label="Keyboard shortcuts"]',
    )!;
    expect(sheet.hasAttribute("open")).toBe(false);
  });

  it("g then s goes to Sites when shortcuts are on", () => {
    const { onNavigate } = renderShell();
    keydown("g");
    keydown("s");
    expect(onNavigate).toHaveBeenCalledWith("/staff/sites");
  });

  it("g then r goes to Review even when a ticket's r (Reply) shortcut is mounted (WR-E04)", () => {
    const onReply = vi.fn();
    function Ticket() {
      useInboxShortcuts({ onReply });
      return <p>ticket</p>;
    }
    const { onNavigate } = renderShell({ children: <Ticket /> });
    keydown("g");
    keydown("r");
    expect(onNavigate).toHaveBeenCalledWith("/staff/review");
    expect(onReply).not.toHaveBeenCalled();
    // A lone r still replies.
    keydown("r");
    expect(onReply).toHaveBeenCalledTimes(1);
  });
});
