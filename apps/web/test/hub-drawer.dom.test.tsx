// @vitest-environment jsdom
// 11-16 Task 2 (DASH-29; 11-UI-SPEC "Drawer"; RESEARCH Pitfall 17). Below 1024px "Open menu"
// opens the sidebar in the native modal <dialog>: showModal() is used (the platform's Tab
// trap and inert background), focus starts on the first nav link, Esc (the dialog's
// `cancel` event) closes it and focus returns to Open menu. jsdom has no modal inertness or
// Tab order, so the real Tab / Shift+Tab trap is a human check (11-16 SUMMARY, For 11-50).
import { createElement, type ReactNode } from "react";
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
  click,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/hub/website",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));
vi.mock("../app/actions/session", () => ({
  signOutAction: vi.fn(async () => {}),
  switchOrgAction: vi.fn(async () => ({ ok: false })),
}));

const { HubShell } = await import("../app/(platform)/hub/HubShell");
const { ToastRegion } = await import("@cds/ui/hub");

const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
});
const close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute("open");
});

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal: () => void;
    close: () => void;
  };
  proto.showModal = showModal;
  proto.close = close;
});

let mounted: Mounted | null = null;
beforeEach(() => {
  showModal.mockClear();
  close.mockClear();
  push.mockClear();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function shell(): Mounted {
  return mount(
    <ToastRegion>
      <HubShell
        businessName="Rivera Bakery"
        siteUrl="https://rivera.example"
        email="ana@rivera.example"
        nav={[
          { href: "/hub/today", label: "Today", iconKey: "House" },
          { href: "/hub/website", label: "Website", iconKey: "Globe" },
        ]}
        pinned={[
          { href: "/hub/help", label: "Help", iconKey: "CircleHelp" },
          { href: "/hub/support", label: "CDS Support", iconKey: "LifeBuoy" },
        ]}
      >
        <p>inner</p>
      </HubShell>
    </ToastRegion>,
  );
}

function menuButton(): HTMLButtonElement {
  const b = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Open menu"]',
  );
  if (!b) throw new Error("no Open menu button");
  return b;
}

function drawer(): HTMLDialogElement {
  const d = document.querySelector<HTMLDialogElement>(
    'dialog[aria-label="Menu"]',
  );
  if (!d) throw new Error("no drawer");
  return d;
}

function openDrawer(): void {
  const button = menuButton();
  act(() => button.focus());
  click(button);
}

describe("hub drawer (DASH-29)", () => {
  it("opens with showModal and focuses the first nav link", () => {
    mounted = shell();
    expect(drawer().hasAttribute("open")).toBe(false);
    openDrawer();
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(drawer().hasAttribute("open")).toBe(true);
    const first = drawer().querySelector('nav[aria-label="Hub"] a[href]');
    expect(first?.getAttribute("href")).toBe("/hub/today");
    expect(document.activeElement).toBe(first);
  });

  it("Esc (cancel) closes it and focus returns to Open menu", () => {
    mounted = shell();
    openDrawer();
    act(() => {
      drawer().dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(close).toHaveBeenCalled();
    expect(drawer().hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(menuButton());
  });

  it("a nav click closes it and navigates", () => {
    mounted = shell();
    openDrawer();
    const link = drawer().querySelector<HTMLAnchorElement>(
      'nav[aria-label="Hub"] a[href="/hub/website"]',
    );
    click(link);
    expect(drawer().hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(menuButton());
  });

  it("the sidebar ends after the pinned block: no email, no Sign out", () => {
    mounted = shell();
    const body = drawer().textContent ?? "";
    expect(body).toContain("CDS Support");
    expect(body).not.toContain("ana@rivera.example");
    expect(body).not.toContain("Sign out");
  });
});
