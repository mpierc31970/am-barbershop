// @vitest-environment jsdom
// Sites list and site detail components (13-33; STAFF-02; 13-UI-SPEC "Sites", tone map;
// T-13-33-01, T-13-33-02).
import { P13_COPY } from "@cds/core/staff";
import { act, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastRegion } from "../../hub/Toast";
import { flush, mount, typeInto, type Mounted } from "../../test-support/dom";
import { StaffActionProvider } from "../dialogs";
import {
  SITES_COPY,
  SiteAddonsTable,
  SiteAuditTable,
  SiteOverview,
  SitesTable,
  SiteTicketsTable,
  auditActorLabel,
  sitePlanLabel,
  type SiteAddonRowView,
  type SiteListRow,
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

const NOW = "2026-10-15T15:00:00.000Z";

function row(over: Partial<SiteListRow>): SiteListRow {
  return {
    orgId: "aaaaaaaaaaaaaaa",
    name: "Rivera Bakery",
    state: "live",
    path: "standard",
    plan: "monthly",
    carePlan: true,
    addonNames: ["Testimonials", "Events"],
    liveHost: "riverabakery.com",
    previewHost: "rivera.sites.localhost",
    created: "2026-09-01 10:00:00.000Z",
    lastOwnerActivity: "2026-10-14 10:00:00.000Z",
    openTickets: 2,
    demo: false,
    repeatInfringer: false,
    ...over,
  };
}

describe("SitesTable", () => {
  it("renders the suspended, demo and repeat badges with their words", () => {
    mounted = mount(
      <SitesTable
        now={NOW}
        rows={[
          row({ orgId: "sssssssssssssss", name: "Bloom", state: "suspended" }),
          row({ orgId: "ddddddddddddddd", name: "Demo Co", demo: true }),
          row({
            orgId: "rrrrrrrrrrrrrrr",
            name: "Copycat",
            repeatInfringer: true,
          }),
        ]}
      />,
    );
    const c = mounted.container;
    const rowOf = (id: string) =>
      c.querySelector<HTMLElement>(`tr[data-staff-row="${id}"]`)!;
    expect(rowOf("sssssssssssssss").textContent).toContain("Suspended");
    expect(
      rowOf("sssssssssssssss").querySelector(".bg-hub-danger-tint"),
    ).not.toBeNull();
    expect(rowOf("ddddddddddddddd").textContent).toContain("Demo");
    expect(rowOf("rrrrrrrrrrrrrrr").textContent).toContain("3 upheld DMCA");
    // Business links to the site detail; open tickets link to the Inbox filtered to the site.
    const link = rowOf("sssssssssssssss").querySelector<HTMLAnchorElement>(
      "a[data-staff-primary]",
    )!;
    expect(link.getAttribute("href")).toBe("/staff/sites/sssssssssssssss");
    expect(
      c.querySelector('a[href="/staff/tickets?org=sssssssssssssss"]'),
    ).not.toBeNull();
    // Add-on names ride in the title; the cell is the count.
    expect(c.querySelector('[title="Testimonials, Events"]')?.textContent).toBe(
      "2",
    );
  });

  it("shows 'preview' when there is no live host, and the empty line", () => {
    mounted = mount(<SitesTable now={NOW} rows={[row({ liveHost: null })]} />);
    expect(mounted.container.textContent).toContain(SITES_COPY.preview);
    mounted.unmount();
    mounted = mount(<SitesTable now={NOW} rows={[]} />);
    expect(mounted.container.textContent).toBe("No sites match.");
  });

  it("a leaving site shows the s-leaving badge 'Leaving · 23d' beside its state (14-45)", () => {
    mounted = mount(
      <SitesTable
        now={NOW}
        rows={[
          row({
            orgId: "lllllllllllllll",
            name: "Leaving Co",
            leavingDays: 23,
          }),
          row({ orgId: "sssssssssssssss", name: "Staying Co" }),
        ]}
      />,
    );
    const c = mounted.container;
    const leaving = c.querySelector<HTMLElement>(
      'tr[data-staff-row="lllllllllllllll"]',
    )!;
    expect(leaving.textContent).toContain("Live");
    expect(leaving.textContent).toContain("Leaving · 23d");
    expect(
      leaving.querySelector('[title="Leaving CDS, 23 days left"]'),
    ).not.toBeNull();
    expect(
      c.querySelector('tr[data-staff-row="sssssssssssssss"]')!.textContent,
    ).not.toContain("Leaving");
  });

  it("plan label", () => {
    expect(sitePlanLabel("monthly", true)).toBe("Monthly · Care Plan");
    expect(sitePlanLabel("", false)).toBe("No plan yet");
  });
});

describe("SiteOverview", () => {
  it("lists members by name and role, never an email", () => {
    mounted = mount(
      <SiteOverview
        auditHref="/staff/sites/aaaaaaaaaaaaaaa?tab=audit"
        site={{
          ...row({}),
          billing: { state: "past_due", nextRenewal: null },
          suspension: null,
          members: [
            { name: "Mara Rivera", role: "owner" },
            { name: "Lee Park", role: "editor" },
          ],
          recent: [
            {
              id: "a1",
              when: "2026-10-14 10:00:00.000Z",
              actor: "CDS · Sam",
              action: "addon.installed",
            },
          ],
        }}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("Mara Rivera");
    expect(text).toContain("Owner");
    expect(text).toContain("Editor");
    expect(text).toContain("Unpaid");
    expect(text).toContain("CDS · Sam");
    expect(mounted.container.innerHTML).not.toContain("@");
  });
});

const ADDONS: SiteAddonRowView[] = [
  {
    slug: "testimonials",
    name: "Testimonials",
    state: "on",
    since: "2026-10-01 10:00:00.000Z",
    price: "$5/mo",
  },
  { slug: "events", name: "Events", state: "off", since: null, price: null },
];

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

describe("SiteAddonsTable", () => {
  it("support agents see disabled buttons with 'Super Admin only'", () => {
    const install = vi.fn();
    mounted = mount(
      withProviders(
        <SiteAddonsTable
          orgId="aaaaaaaaaaaaaaa"
          business="Rivera Bakery"
          rows={ADDONS}
          canInstall={false}
          install={install}
          uninstall={install}
        />,
      ),
    );
    const buttons = [...mounted.container.querySelectorAll("button")].filter(
      (b) => /add-on/.test(b.textContent ?? ""),
    );
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b.disabled).toBe(true);
    expect(mounted.container.textContent).toContain(P13_COPY.SUPER_ONLY);
  });

  it("super admin: Install opens the sale dialog, needs a reason, calls the action", async () => {
    const install = vi.fn(async () => ({
      ok: true as const,
      data: { message: "Events installed." },
    }));
    mounted = mount(
      withProviders(
        <SiteAddonsTable
          orgId="aaaaaaaaaaaaaaa"
          business="Rivera Bakery"
          rows={ADDONS}
          canInstall
          install={install}
          uninstall={vi.fn()}
        />,
      ),
    );
    const open = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Install add-on: Events"]',
    )!;
    act(() => open.click());
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("Install Events on Rivera Bakery?");
    expect(dialog.textContent).toContain("It is a sale");
    const confirm = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "Install",
    )!;
    expect(confirm.disabled).toBe(true);
    const area = dialog.querySelector("textarea")!;
    typeInto(area, "Owner asked by phone");
    expect(confirm.disabled).toBe(false);
    act(() => confirm.click());
    await flush();
    expect(install).toHaveBeenCalledWith("aaaaaaaaaaaaaaa", {
      slug: "events",
      reason: "Owner asked by phone",
    });
  });
});

describe("SiteTicketsTable and SiteAuditTable", () => {
  it("tickets link to the ticket page and use the staff waiting word", () => {
    mounted = mount(
      <SiteTicketsTable
        now={NOW}
        rows={[
          {
            number: 1042,
            subject: "Form broken",
            type: "problem",
            status: "waiting_on_you",
            priority: "high",
            sla: "met",
            dueAt: null,
            assignee: null,
          },
        ]}
      />,
    );
    expect(
      mounted.container.querySelector('a[href="/staff/tickets/1042"]'),
    ).not.toBeNull();
    expect(mounted.container.textContent).toContain("Waiting on owner");
  });

  it("audit filter links mark the current one; actor labels", () => {
    mounted = mount(
      <SiteAuditTable
        rows={[
          {
            id: "a1",
            when: "2026-10-14 10:00:00.000Z",
            actor: "CDS · Sam",
            action: "impersonation.start",
            target: "",
          },
        ]}
        who="impersonation"
        page={1}
        totalPages={1}
        hrefFor={{
          all: "?tab=audit",
          cds: "?who=cds",
          impersonation: "?who=impersonation",
        }}
        newerHref={null}
        olderHref={null}
      />,
    );
    const current = mounted.container.querySelector('a[aria-current="page"]');
    expect(current?.textContent).toBe("Impersonation");
    expect(
      auditActorLabel({
        actorName: "Mara",
        byStaff: true,
        impersonatorName: "Sam",
      }),
    ).toBe("CDS · Sam");
    expect(
      auditActorLabel({
        actorName: "Mara",
        byStaff: false,
        impersonatorName: "",
      }),
    ).toBe("Mara");
  });
});
