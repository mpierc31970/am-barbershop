// @vitest-environment jsdom
// Staff Site › Offboarding (14-43 choice 5; LIFE-01, D282, P14-P13; 14-UI-SPEC "Staff ›
// Offboarding"): empty state, the timeline (owner + system steps, reverse gate report, GA4
// runbook line), the rail, role gates, Start / Cancel dialogs and the Site › Actions row.
import { P14_COPY } from "@cds/core/dns";
import { type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastRegion } from "../../hub/Toast";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { StaffActionProvider } from "../dialogs";
import {
  OffboardingPanel,
  SiteActions,
  STAFF_OFFBOARDING_COPY as C,
  type OffboardingPanelActions,
  type SiteActionsHandlers,
  type SiteActionsView,
  type StaffOffboardingData,
  type StaffOffboardingPanelView,
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

const ORG = "aaaaaaaaaaaaaaa";

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

function dialog(): HTMLDialogElement {
  const d = [...document.querySelectorAll("dialog")].find((x) =>
    x.hasAttribute("open"),
  );
  if (!d) throw new Error("no open dialog");
  return d;
}

const ok = (message = "Done.") =>
  vi.fn(async (orgId: string, reason?: string) => {
    void orgId;
    void reason;
    return { ok: true as const, data: { message } };
  });

const noop = () =>
  vi.fn(async () => ({ ok: true as const, data: { message: "Done." } }));

function actions(
  over: Partial<OffboardingPanelActions> = {},
): OffboardingPanelActions {
  return {
    start: ok(
      "Offboarding started. Rivera Bakery's owner was emailed the checklist.",
    ),
    cancel: ok("Offboarding cancelled."),
    rerunHandback: ok("Handback checked."),
    ...over,
  };
}

function notice(
  over: Partial<StaffOffboardingData> = {},
): StaffOffboardingData {
  return {
    status: "notice",
    requestedAt: "2026-10-15T14:00:00.000Z",
    requestedByKind: "owner",
    noticeEndsAt: "2026-11-14T15:00:00.000Z",
    daysLeft: 28,
    reasonCategory: "provider",
    note: "Moving to Squarespace <b>soon</b>",
    cancelledAt: null,
    closedAt: null,
    handbackOverdueAt: null,
    steps: [
      { key: "dns_handback", title: "Move your DNS", status: "open", at: null },
      {
        key: "download",
        title: "Download your data",
        status: "locked",
        at: null,
      },
      { key: "addons", title: "Add-ons", status: "not_applicable", at: null },
      {
        key: "services",
        title: "Connected services",
        status: "locked",
        at: null,
      },
      { key: "billing", title: "Billing", status: "locked", at: null },
      { key: "close", title: "Your site closes", status: "locked", at: null },
    ],
    systemSteps: [
      {
        key: "hosts_removed",
        title: "Hosts removed",
        status: "open",
        at: null,
      },
      { key: "site_closed", title: "Site closed", status: "open", at: null },
      { key: "zone_deleted", title: "Zone deleted", status: "open", at: null },
    ],
    ...over,
  };
}

function view(
  over: Partial<StaffOffboardingPanelView> = {},
): StaffOffboardingPanelView {
  return {
    orgId: ORG,
    business: "Rivera Bakery",
    start: {
      noticeWouldEnd: "2026-11-16T15:00:00.000Z",
      handbackNeeded: true,
      blocked: null,
    },
    offboarding: null,
    lastCancelledAt: null,
    handback: [],
    ...over,
  };
}

const HANDBACK = [
  {
    domain: "riverabakery.com",
    status: "mismatch" as const,
    destination: "registrar" as const,
    gate: {
      rules: [
        {
          rule: "G1" as const,
          name: "Every record copied",
          result: "fail" as const,
          hardBlock: false,
          overridable: false,
        },
      ],
      records: [
        {
          group: "email" as const,
          type: "MX",
          name: "riverabakery.com",
          original: "10 mx.example.net",
          copy: null,
          sources: ["zone_file" as const],
          result: "missing" as const,
        },
        {
          group: "other" as const,
          type: "TXT",
          name: "riverabakery.com",
          original: "hello",
          copy: "hello",
          sources: [],
          result: "match" as const,
        },
      ],
      snapshotAt: "2026-10-16T14:00:00.000Z",
      recordCount: 2,
      readBackFrom: "ns1.registrar.example",
    },
  },
];

describe("OffboardingPanel", () => {
  it("shows the empty state with Start offboarding for a super_admin", () => {
    mounted = mount(
      withProviders(
        <OffboardingPanel view={view()} actions={actions()} canOffboard />,
      ),
    );
    const c = mounted.container;
    expect(c.textContent).toContain("Rivera Bakery isn't leaving.");
    const start = button(c, P14_COPY.BTN_START_OFFBOARDING)!;
    expect(start.disabled).toBe(false);
    expect(c.textContent).not.toContain(P14_COPY.SUPER_ONLY);
  });

  it("disables Start offboarding for a support_agent (Super Admin only)", () => {
    mounted = mount(
      withProviders(
        <OffboardingPanel
          view={view()}
          actions={actions()}
          canOffboard={false}
        />,
      ),
    );
    const c = mounted.container;
    expect(button(c, P14_COPY.BTN_START_OFFBOARDING)!.disabled).toBe(true);
    expect(c.textContent).toContain(P14_COPY.SUPER_ONLY);
  });

  it("starts offboarding through the destructive case dialog with a reason", async () => {
    const a = actions();
    mounted = mount(
      withProviders(<OffboardingPanel view={view()} actions={a} canOffboard />),
    );
    click(button(mounted.container, P14_COPY.BTN_START_OFFBOARDING));
    const d = dialog();
    expect(d.textContent).toContain("Start offboarding for Rivera Bakery?");
    expect(d.textContent).toContain("16 Nov 2026");
    expect(d.textContent).toContain(C.start.handbackYes);
    expect(d.textContent).toContain(C.start.billingLine);
    expect(d.textContent).toContain(C.start.ownerLine);
    // Not now has the focus (destructive).
    expect(document.activeElement?.textContent).toBe(P14_COPY.BTN_NOT_NOW);
    const confirm = button(d, P14_COPY.BTN_START_OFFBOARDING)!;
    expect(confirm.disabled).toBe(true);
    typeInto(d.querySelector("textarea"), "ab");
    expect(confirm.disabled).toBe(true);
    typeInto(d.querySelector("textarea"), "Owner asked by phone");
    expect(confirm.disabled).toBe(false);
    click(confirm);
    await flush();
    expect(a.start).toHaveBeenCalledWith(ORG, "Owner asked by phone");
    expect(document.body.textContent).toContain(
      "Offboarding started. Rivera Bakery's owner was emailed the checklist.",
    );
  });

  it("explains why it can't start (demo)", () => {
    mounted = mount(
      withProviders(
        <OffboardingPanel
          view={view({
            start: {
              noticeWouldEnd: "2026-11-16T15:00:00.000Z",
              handbackNeeded: false,
              blocked: "The demo site can't leave CDS.",
            },
          })}
          actions={actions()}
          canOffboard
        />,
      ),
    );
    expect(
      button(mounted.container, P14_COPY.BTN_START_OFFBOARDING)!.disabled,
    ).toBe(true);
    expect(mounted.container.textContent).toContain(
      "The demo site can't leave CDS.",
    );
  });

  it("renders the timeline: six owner steps, three system steps, rail and runbook", () => {
    mounted = mount(
      withProviders(
        <OffboardingPanel
          view={view({ offboarding: notice(), handback: HANDBACK })}
          actions={actions()}
          canOffboard
        />,
      ),
    );
    const c = mounted.container;
    const items = [...c.querySelectorAll("ol > li")].map(
      (li) => li.textContent,
    );
    const labels = [
      "Move your DNS",
      "Download your data",
      "Add-ons",
      "Connected services",
      "Billing",
      "Your site closes",
      "Hosts removed (System)",
      "Site closed (System)",
      "Zone deleted (System)",
    ];
    expect(items).toHaveLength(labels.length);
    labels.forEach((l, i) => expect(items[i]).toContain(l));
    expect(items[8]).toContain(C.zoneCondition);
    expect(items[3]).toContain("docs/ops/ga4-search-console.md");
    expect(items[0]).toContain(
      "riverabakery.com to the registrar's DNS · Records missing",
    );
    // Reverse gate report embedded in the handback step.
    const gate = c.querySelector('[data-gate-report="reverse"]')!;
    expect(gate).not.toBeNull();
    expect(gate.textContent).toContain("CDS zone");
    expect(gate.textContent).toContain("Destination answers");
    expect(gate.textContent).toContain("Handback check · riverabakery.com");
    // Rail.
    const rail = c.querySelector("[data-offboarding-rail]")!;
    expect(rail.textContent).toContain("Owner");
    expect(rail.textContent).toContain("14 Nov 2026 · 28 days left");
    expect(rail.textContent).toContain("Moving to another provider");
    // The owner's note stays text.
    expect(rail.textContent).toContain("<b>soon</b>");
    expect(rail.querySelector("b")).toBeNull();
  });

  it("marks an overdue handback as failed", () => {
    mounted = mount(
      withProviders(
        <OffboardingPanel
          view={view({
            offboarding: notice({
              daysLeft: 0,
              handbackOverdueAt: "2026-11-14T15:05:00.000Z",
            }),
            handback: HANDBACK,
          })}
          actions={actions()}
          canOffboard
        />,
      ),
    );
    const first = mounted.container.querySelector("ol > li")!;
    expect(first.textContent).toContain(
      "The notice ended with the DNS handback open",
    );
  });

  it("gives a support_agent Re-run handback check but not Cancel offboarding", async () => {
    const a = actions();
    mounted = mount(
      withProviders(
        <OffboardingPanel
          view={view({ offboarding: notice(), handback: HANDBACK })}
          actions={a}
          canOffboard={false}
        />,
      ),
    );
    const c = mounted.container;
    expect(button(c, P14_COPY.BTN_CANCEL_OFFBOARDING)!.disabled).toBe(true);
    expect(c.textContent).toContain(P14_COPY.SUPER_ONLY);
    const rerun = button(c, P14_COPY.BTN_RERUN_HANDBACK)!;
    expect(rerun.disabled).toBe(false);
    click(rerun);
    await flush();
    expect(a.rerunHandback).toHaveBeenCalledWith(ORG);
  });

  it("cancels through the case dialog (Keep offboarding is the safe button)", async () => {
    const a = actions();
    mounted = mount(
      withProviders(
        <OffboardingPanel
          view={view({ offboarding: notice() })}
          actions={a}
          canOffboard
        />,
      ),
    );
    // No zone: no re-run button.
    expect(button(mounted.container, P14_COPY.BTN_RERUN_HANDBACK)).toBeFalsy();
    click(button(mounted.container, P14_COPY.BTN_CANCEL_OFFBOARDING));
    const d = dialog();
    expect(d.textContent).toContain("Cancel Rivera Bakery's offboarding?");
    expect(d.textContent).toContain("Their plan and price carry on.");
    expect(document.activeElement?.textContent).toBe(
      P14_COPY.BTN_KEEP_OFFBOARDING,
    );
    typeInto(d.querySelector("textarea"), "Owner changed their mind");
    click(button(d, P14_COPY.BTN_CANCEL_OFFBOARDING));
    await flush();
    expect(a.cancel).toHaveBeenCalledWith(ORG, "Owner changed their mind");
  });

  it("a closed offboarding shows no actions", () => {
    mounted = mount(
      withProviders(
        <OffboardingPanel
          view={view({
            offboarding: notice({
              status: "closed",
              closedAt: "2026-11-14T15:05:00.000Z",
            }),
          })}
          actions={actions()}
          canOffboard
        />,
      ),
    );
    const c = mounted.container;
    expect(c.querySelector("[data-offboarding-actions]")).toBeNull();
    expect(c.textContent).toContain(C.status.closed);
  });
});

describe("SiteActions › Leaving CDS row", () => {
  const can = {
    ownerView: true,
    stage: true,
    suspendNow: true,
    lift: true,
  };
  function siteView(over: Partial<SiteActionsView> = {}): SiteActionsView {
    return {
      orgId: ORG,
      business: "Rivera Bakery",
      timeZone: "America/Chicago",
      stage: "live",
      forwardStages: [],
      suspension: { state: "none" },
      demo: false,
      noticeFixBy: "2026-10-19T22:00:00.000Z",
      targets: [],
      documentHref: `/staff/api/sites/${ORG}/document`,
      addonsHref: `/staff/sites/${ORG}?tab=addons`,
      ...over,
    };
  }
  function handlers(
    over: Partial<SiteActionsHandlers> = {},
  ): SiteActionsHandlers {
    return {
      startImpersonation: noop(),
      openTicket: vi.fn(async () => ({
        ok: true as const,
        data: { number: 1, message: "x" },
      })),
      post: noop(),
      moveStage: noop(),
      sendNotice: noop(),
      suspendNow: noop(),
      markFixed: noop(),
      liftSuspension: noop(),
      ...over,
    };
  }
  const OFF = {
    start: {
      noticeWouldEnd: "2026-11-16T15:00:00.000Z",
      handbackNeeded: false,
      blocked: null,
    },
    leaving: false,
    href: `/staff/sites/${ORG}?tab=offboarding`,
  };

  it("is hidden without the offboarding props", () => {
    mounted = mount(
      withProviders(
        <SiteActions view={siteView()} can={can} actions={handlers()} />,
      ),
    );
    expect(mounted.container.textContent).not.toContain(C.actionsRow.section);
  });

  it("starts offboarding for a super_admin", async () => {
    const startOffboarding = ok("Offboarding started.");
    mounted = mount(
      withProviders(
        <SiteActions
          view={siteView({ offboarding: OFF })}
          can={{ ...can, offboard: true }}
          actions={handlers({ startOffboarding })}
        />,
      ),
    );
    click(button(mounted.container, P14_COPY.BTN_START_OFFBOARDING));
    const d = dialog();
    expect(d.textContent).toContain(C.start.handbackNo);
    typeInto(d.querySelector("textarea"), "Asked by email");
    click(button(d, P14_COPY.BTN_START_OFFBOARDING));
    await flush();
    expect(startOffboarding).toHaveBeenCalledWith(ORG, "Asked by email");
  });

  it("shows Super Admin only to a support_agent", () => {
    mounted = mount(
      withProviders(
        <SiteActions
          view={siteView({ offboarding: OFF })}
          can={{ ...can, offboard: false }}
          actions={handlers({ startOffboarding: ok() })}
        />,
      ),
    );
    expect(
      button(mounted.container, P14_COPY.BTN_START_OFFBOARDING)!.disabled,
    ).toBe(true);
  });

  it("links to the tab while a notice runs", () => {
    mounted = mount(
      withProviders(
        <SiteActions
          view={siteView({ offboarding: { ...OFF, leaving: true } })}
          can={{ ...can, offboard: true }}
          actions={handlers({ startOffboarding: ok() })}
        />,
      ),
    );
    const link = [...mounted.container.querySelectorAll("a")].find(
      (a) => a.textContent === C.actionsRow.open,
    )!;
    expect(link.getAttribute("href")).toBe(
      `/staff/sites/${ORG}?tab=offboarding`,
    );
    expect(
      button(mounted.container, P14_COPY.BTN_START_OFFBOARDING),
    ).toBeFalsy();
  });
});
