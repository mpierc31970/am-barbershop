// @vitest-environment jsdom
// 12-10 Task 2 (SUPPORT-03, COMM-12, D297, D299, D103; 12-UI-SPEC Paid service lines 459-486,
// Incident 490-499): the paid-service panel's states per role and Care Plan, and the incident
// box that never shows counts or other sites (T-12-10-01, T-12-10-02).
import { SUPPORT_COPY, type PaidService } from "@cds/core/support";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../test-support/dom";
import {
  IncidentBox,
  PAID_COPY,
  PaidServicePanel,
  isPrimaryChoice,
  type CareUsage,
  type PaidServicePanelProps,
} from "./index";

const TZ = "America/Chicago";

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

function paid(p: Partial<PaidService> = {}): PaidService {
  return { category: "design", marked_at: "2026-10-12T15:00:00Z", ...p };
}

const CARE: CareUsage = {
  minutesLeft: 35,
  minutesIncluded: 60,
  monthLabel: "October",
};

function panel(p: Partial<PaidServicePanelProps> = {}) {
  const props: PaidServicePanelProps = {
    paid: paid(),
    role: "owner",
    careUsage: null,
    onGetQuote: vi.fn(async () => ({ ok: true as const, data: null })),
    onUseCare: vi.fn(async () => ({ ok: true as const, data: null })),
    onShowMe: vi.fn(),
    timeZone: TZ,
    ...p,
  };
  mounted = mount(<PaidServicePanel {...props} />);
  return { props, root: mounted.container };
}

describe("PaidServicePanel (owner)", () => {
  it("shows the rule, category, Show me how and a primary Get a quote", async () => {
    const { props, root } = panel();
    const text = root.textContent ?? "";
    expect(text).toContain("This is a paid service");
    expect(text).toContain("Design changes");
    expect(text).toContain(SUPPORT_COPY.PAID_RULE);
    const show = button(root, "Show me how");
    click(show);
    expect(props.onShowMe).toHaveBeenCalledWith("paid-services");
    const get = button(root, "Get a quote")!;
    expect(get.className).toContain("bg-hub-accent");
    click(get);
    await flush();
    expect(props.onGetQuote).toHaveBeenCalled();
    expect(isPrimaryChoice(paid(), "owner")).toBe(true);
  });

  it("requested: the requested line and no button", () => {
    const { root } = panel({
      paid: paid({ quote_requested_at: "2026-10-12T15:00:00Z" }),
    });
    expect(root.textContent).toContain(
      "Quote requested 12 Oct. Support will send it here.",
    );
    expect(button(root, "Get a quote")).toBeNull();
    expect(
      isPrimaryChoice(
        paid({ quote_requested_at: "2026-10-12T15:00:00Z" }),
        "owner",
      ),
    ).toBe(false);
  });

  it("sent: a View quote link with the sent line", () => {
    const p = paid({
      quote_requested_at: "2026-10-12T15:00:00Z",
      work_order: "wo123",
      quote_sent_at: "2026-10-13T15:00:00Z",
      amount_cents: 12000,
    });
    const { root } = panel({ paid: p });
    const a = root.querySelector('a[href="/hub/settings/quotes/wo123"]');
    expect(a?.textContent).toBe("View quote");
    expect(a?.className).toContain("bg-hub-accent");
    expect(root.textContent).toContain("Sent 13 Oct · $120");
    expect(isPrimaryChoice(p, "owner")).toBe(true);
  });

  it("accepted: the accepted line, no button", () => {
    const p = paid({
      work_order: "wo123",
      quote_sent_at: "2026-10-13T15:00:00Z",
      accepted_at: "2026-10-13T18:00:00Z",
    });
    const { root } = panel({ paid: p, careUsage: CARE });
    expect(root.textContent).toContain(
      "You accepted the quote on 13 Oct. Support has started.",
    );
    expect(root.querySelector("a[href^='/hub/settings/quotes']")).toBeNull();
    expect(button(root, "Use my Care hour")).toBeNull();
    expect(isPrimaryChoice(p, "owner")).toBe(false);
  });

  it("Care Plan with minutes left: Use my Care hour opens a dialog with Not now focused", async () => {
    const { props, root } = panel({ careUsage: CARE });
    expect(root.textContent).toContain(
      "You have 35 of 60 minutes left in October.",
    );
    click(button(root, "Use my Care hour"));
    const dialog = document.querySelector("dialog")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.textContent).toContain("Use your Care hour on this?");
    expect(dialog.textContent).toContain(
      "You have 35 minutes left in October.",
    );
    const notNow = button(dialog, "Not now")!;
    expect(document.activeElement).toBe(notNow);
    click(button(dialog, "Use my Care hour"));
    await flush();
    expect(props.onUseCare).toHaveBeenCalledTimes(1);
  });

  it("Care Plan with 0 minutes: the no-minutes line and no button", () => {
    const { root } = panel({ careUsage: { ...CARE, minutesLeft: 0 } });
    expect(root.textContent).toContain("No Care minutes left in October.");
    expect(button(root, "Use my Care hour")).toBeNull();
  });

  it("not on the Care Plan: the option is absent and About the Care Plan shows", () => {
    const { root } = panel({ careUsage: null });
    expect(button(root, "Use my Care hour")).toBeNull();
    expect(root.textContent).toContain(PAID_COPY.careUpsell);
    expect(
      root.querySelector('a[href="/hub/help/care-plan"]')?.textContent,
    ).toBe("About the Care Plan");
  });

  it("Care chosen: the chosen line and no controls", () => {
    const { root } = panel({
      paid: paid({ care_chosen_at: "2026-10-12T15:00:00Z" }),
      careUsage: CARE,
    });
    expect(root.textContent).toContain(
      "You chose your Care hour on 12 Oct. Support has started.",
    );
    expect(button(root, "Get a quote")).toBeNull();
    expect(button(root, "Use my Care hour")).toBeNull();
  });
});

describe("PaidServicePanel (admin, editor)", () => {
  for (const role of ["admin", "editor"] as const) {
    it(`${role}: PAID-ASK-OWNER in place of options 2 and 3, Show me how kept`, () => {
      const { root } = panel({ role, careUsage: CARE });
      expect(root.textContent).toContain(SUPPORT_COPY.PAID_ASK_OWNER);
      expect(button(root, "Get a quote")).toBeNull();
      expect(button(root, "Use my Care hour")).toBeNull();
      expect(root.textContent).not.toContain("Have Support do it");
      expect(root.querySelector('a[href="/hub/help/care-plan"]')).toBeNull();
      expect(button(root, "Show me how")).not.toBeNull();
      expect(isPrimaryChoice(paid(), role)).toBe(false);
    });
  }
});

describe("IncidentBox", () => {
  it("shows title, public text and status; no digits outside the date line", () => {
    mounted = mount(
      <IncidentBox
        incident={{
          title: "Contact forms not sending",
          public_text: "Forms are saving but the emails are delayed.",
          status: "open",
        }}
        at="2026-10-12T19:14:00Z"
        timeZone={TZ}
      />,
    );
    const root = mounted.container;
    expect(root.textContent).toContain(
      "Known problem: Contact forms not sending",
    );
    expect(root.textContent).toContain(
      "Forms are saving but the emails are delayed.",
    );
    expect(root.textContent).toContain("Being fixed");
    const date = root.querySelector("[data-incident-date]");
    expect(date?.textContent).toBe("Updated 2:14 pm");
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelector("[data-incident-date]")?.remove();
    expect(clone.textContent).not.toMatch(/\d/);
    expect(root.textContent).not.toMatch(/customers|tickets|sites/i);
  });

  it("fixed: the Fixed badge and the resolved line", () => {
    mounted = mount(
      <IncidentBox
        incident={{
          title: "Slow pages",
          public_text: "Fixed now.",
          status: "resolved",
        }}
        at="2026-10-12T21:10:00Z"
        timeZone={TZ}
      />,
    );
    expect(mounted.container.textContent).toContain("Fixed");
    expect(
      mounted.container.querySelector("[data-incident-date]")?.textContent,
    ).toBe("Fixed 12 Oct, 4:10 pm. Your ticket was marked resolved.");
  });

  it("notice context never mentions a ticket (WR-D08)", () => {
    const resolved = {
      title: "Slow pages",
      public_text: "Fixed now.",
      status: "resolved" as const,
    };
    mounted = mount(
      <IncidentBox
        incident={resolved}
        at="2026-10-12T21:10:00Z"
        timeZone={TZ}
        context="notice"
      />,
    );
    expect(
      mounted.container.querySelector("[data-incident-date]")?.textContent,
    ).toBe("Fixed 12 Oct, 4:10 pm.");
    mounted.unmount();
    mounted = mount(
      <IncidentBox incident={resolved} timeZone={TZ} context="notice" />,
    );
    expect(mounted.container.textContent).not.toMatch(/ticket/i);
    expect(mounted.container.querySelector("[data-incident-date]")).toBeNull();
  });
});
