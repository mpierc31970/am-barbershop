// @vitest-environment jsdom
// Settings building blocks (13-46; STAFF-18, STAFF-16; T-13-46-01, T-13-46-02).
import { P13_DIALOGS } from "@cds/core/staff";
import { act, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastRegion } from "../../hub/Toast";
import { flush, mount, type Mounted } from "../../test-support/dom";
import { StaffActionProvider } from "../dialogs";
import {
  DemoPanel,
  MonitorPanel,
  SETTINGS_COPY,
  StaffList,
  type DemoPanelView,
  type MonitorPanelView,
  type StaffListRowView,
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
});

function withProviders(ui: ReactNode) {
  return (
    <ToastRegion>
      <StaffActionProvider
        requestStepUpCode={vi.fn()}
        confirmStepUp={vi.fn()}
        navigate={vi.fn()}
      >
        {ui}
      </StaffActionProvider>
    </ToastRegion>
  );
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === text,
  )!;
}

const MONITOR: MonitorPanelView = {
  endpoint: "/api/monitor/status",
  tokenConfigured: true,
  overall: "degraded",
  sections: [
    { name: "jobs", ok: true },
    { name: "media", ok: false },
  ],
  briefPath: ".planning/design/MONITOR-APP-BRIEF.md",
  briefHref: "https://example.test/brief",
};

describe("MonitorPanel", () => {
  it('renders "Token configured: Yes" and never a token-like string', () => {
    mounted = mount(<MonitorPanel view={MONITOR} />);
    const text = mounted.container.textContent ?? "";
    expect(text).toContain(`${SETTINGS_COPY.monitor.token}Yes`);
    expect(text).toContain("/api/monitor/status");
    expect(text).toContain("Degraded");
    expect(text).toContain(
      "Monitor app brief: .planning/design/MONITOR-APP-BRIEF.md",
    );
    expect(text).toContain("The monitor app is built later (D174).");
    // No long opaque run of characters (a token) anywhere in the rendered output.
    expect(mounted.container.innerHTML).not.toMatch(/[A-Za-z0-9_-]{32,}/);
    const media = mounted.container.querySelector('[data-section="media"]')!;
    expect(media.textContent).toContain(SETTINGS_COPY.monitor.sectionDegraded);
  });

  it('says "No" when the token is not set and survives a missing document', () => {
    mounted = mount(
      <MonitorPanel
        view={{
          ...MONITOR,
          tokenConfigured: false,
          overall: null,
          sections: [],
        }}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain(`${SETTINGS_COPY.monitor.token}No`);
    expect(text).toContain(SETTINGS_COPY.monitor.unavailable);
  });
});

const DEMO: DemoPanelView = {
  name: "Bella's Salon",
  orgId: "demo00000000001",
  host: "demo.sites.localhost",
  lastReset: "Oct 16, 3:30 am",
  lastResetOk: true,
  nextReset: "Oct 17, 3:30 am",
  counts: { rowsDeleted: 200, rowsSeeded: 214 },
};

describe("DemoPanel", () => {
  it("Reset now opens the dialog with 'No other site changes.' and the safe button focused", async () => {
    const reset = vi.fn(async () => ({
      ok: true as const,
      data: {
        message:
          "Reset Bella's Salon. 214 rows replaced. No other site changed.",
      },
    }));
    mounted = mount(withProviders(<DemoPanel view={DEMO} reset={reset} />));
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("Oct 16, 3:30 am · OK");
    expect(text).toContain("200 rows removed · 214 rows seeded");
    expect(text).toContain("No monitor alerts");
    expect(
      mounted.container.querySelector('a[href="/staff/sites/demo00000000001"]'),
    ).not.toBeNull();
    act(() =>
      buttonByText(mounted!.container, SETTINGS_COPY.demo.resetNow).click(),
    );
    await flush();
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("Reset Bella's Salon now?");
    expect(dialog.textContent).toContain("No other site changes.");
    expect(document.activeElement?.textContent).toBe(
      P13_DIALOGS.demo_reset.safe,
    );
    act(() => buttonByText(dialog, P13_DIALOGS.demo_reset.confirm).click());
    await flush();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("shows the missing-demo note when the org does not exist yet", () => {
    mounted = mount(
      withProviders(
        <DemoPanel
          view={{
            ...DEMO,
            orgId: null,
            host: null,
            lastReset: null,
            counts: null,
          }}
          reset={vi.fn()}
        />,
      ),
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain(SETTINGS_COPY.demo.missing);
    expect(text).toContain(SETTINGS_COPY.demo.never);
  });
});

const STAFF: StaffListRowView[] = [
  {
    id: "me0000000000001",
    name: "Sam Admin",
    emailMasked: "s•••@example.test",
    role: "super_admin",
    lastSignIn: "Oct 16, 9:40 am",
  },
  {
    id: "lee000000000001",
    name: "Lee Park",
    emailMasked: "l•••@example.test",
    role: "super_admin",
    lastSignIn: null,
  },
];

describe("StaffList", () => {
  it("role change dialog names the person and 'Takes effect on their next click.'", async () => {
    const changeRole = vi.fn(async () => ({
      ok: true as const,
      data: { message: "Lee is now a Support agent." },
    }));
    mounted = mount(
      withProviders(
        <StaffList
          rows={STAFF}
          currentUserId="me0000000000001"
          changeRole={changeRole}
        />,
      ),
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("l•••@example.test");
    expect(text).toContain(SETTINGS_COPY.staff.never);
    expect(text).toContain(SETTINGS_COPY.staff.cliNote);
    const own = mounted.container.querySelector<HTMLSelectElement>(
      "#staff-role-me0000000000001",
    )!;
    expect(own.disabled).toBe(true);
    expect(text).toContain("You can't change your own role.");
    const lee = mounted.container.querySelector<HTMLSelectElement>(
      "#staff-role-lee000000000001",
    )!;
    expect(lee.disabled).toBe(false);
    act(() => {
      lee.value = "support_agent";
      lee.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("Make Lee a Support agent?");
    expect(dialog.textContent).toContain("Takes effect on their next click.");
    act(() => buttonByText(dialog, P13_DIALOGS.staff_role.confirm).click());
    await flush();
    expect(changeRole).toHaveBeenCalledWith("lee000000000001", "support_agent");
    const row = mounted.container.querySelector(
      '[data-staff-row="lee000000000001"]',
    )!;
    expect(row.textContent).toContain("Support agent");
  });
});
