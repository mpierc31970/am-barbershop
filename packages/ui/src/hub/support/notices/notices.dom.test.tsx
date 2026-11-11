// @vitest-environment jsdom
// 12-14 Task 1 (COMM-11, COMM-05, D99-D102; 12-UI-SPEC Service notices lines 564-582, Locks
// and held changes 584-608): the notice strip (active in the CDS layer, upcoming neutral and
// dismissible, two strips then "1 more notice"), the page/component path filter, and the
// locked and held-changes panels.
import { SUPPORT_COPY, type ServiceNotice } from "@cds/core/support";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../test-support/dom";
import {
  HeldChangesPanel,
  LockedPanel,
  NOTICES_COPY,
  ServiceNoticeStrip,
  noticesForPath,
} from "./index";

const TZ = "America/Chicago";
// 4:00 pm Chicago (CDT, UTC-5) on Mon 12 Oct 2026.
const END = "2026-10-12T21:00:00Z";
const NOW = new Date("2026-10-12T18:00:00Z");

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

function notice(p: Partial<ServiceNotice> = {}): ServiceNotice {
  return {
    id: "w1",
    code: "W-1",
    phase: "active",
    text: "Support is working on your site until 4:00 pm.",
    message: "",
    startsAt: "2026-10-12T17:00:00Z",
    endsAt: END,
    incident: null,
    dismissible: false,
    ...p,
  };
}

const PLANNED = notice({
  id: "w2",
  code: "W-2",
  phase: "upcoming",
  text: "Planned work on your site Tue 13 Oct, 9:00–11:00 pm.",
  dismissible: true,
});

describe("ServiceNoticeStrip", () => {
  it("renders an active notice in the Support layer with role status", () => {
    mounted = mount(<ServiceNoticeStrip notices={[notice()]} timeZone={TZ} />);
    const status = mounted.container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    const strip = status!.querySelector("[data-cds-identity]");
    expect(strip?.textContent).toContain(
      "Support is working on your site until 4:00 pm.",
    );
    expect(strip?.querySelector("[data-cds-mark]")).not.toBeNull();
    expect(button(mounted.container, "Dismiss this notice")).toBeNull();
  });

  it("renders an upcoming notice neutral with a named Dismiss", async () => {
    const onDismiss = vi.fn(async () => {});
    mounted = mount(
      <ServiceNoticeStrip
        notices={[PLANNED]}
        timeZone={TZ}
        onDismiss={onDismiss}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("Planned work on your site");
    expect(mounted.container.querySelector("[data-cds-identity]")).toBeNull();
    const dismiss = button(mounted.container, "Dismiss this notice");
    expect(dismiss).not.toBeNull();
    // WR-D07: the Dismiss is described by its own notice's text.
    const desc = dismiss!.getAttribute("aria-describedby");
    expect(desc).toBeTruthy();
    expect(document.getElementById(desc!)?.textContent).toBe(PLANNED.text);
    click(dismiss);
    await flush();
    expect(onDismiss).toHaveBeenCalledWith("w2");
    expect(mounted.container.textContent).not.toContain("Planned work");
  });

  it("shows two strips and '1 more notice' for three, active first", () => {
    const later = notice({ id: "w3", code: "W-3", phase: "upcoming" });
    mounted = mount(
      <ServiceNoticeStrip notices={[PLANNED, notice(), later]} timeZone={TZ} />,
    );
    const strips = mounted.container.querySelectorAll("[data-notice-id]");
    expect(strips).toHaveLength(2);
    expect(strips[0]!.getAttribute("data-notice-id")).toBe("w1");
    const more = button(mounted.container, "1 more notice");
    expect(more).not.toBeNull();
    click(more);
    expect(mounted.container.querySelectorAll("[data-notice-id]")).toHaveLength(
      3,
    );
  });

  it("the expander moves focus to the first newly shown strip (IN-D06)", () => {
    const later = notice({ id: "w3", code: "W-3", phase: "upcoming" });
    mounted = mount(
      <ServiceNoticeStrip notices={[PLANNED, notice(), later]} timeZone={TZ} />,
    );
    const more = button(mounted.container, "1 more notice")!;
    more.focus();
    click(more);
    expect(document.activeElement?.getAttribute("data-notice-id")).toBe("w3");
  });

  it("after Dismiss focus moves to the next strip's Dismiss, then to the region (IN-D06)", async () => {
    const second = notice({
      id: "w4",
      code: "W-4",
      phase: "upcoming",
      text: "More planned work.",
      dismissible: true,
    });
    mounted = mount(
      <ServiceNoticeStrip
        notices={[PLANNED, second]}
        timeZone={TZ}
        onDismiss={async () => {}}
      />,
    );
    const first = mounted.container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Dismiss this notice"]',
    )[0]!;
    first.focus();
    click(first);
    await flush();
    const next = button(mounted.container, "Dismiss this notice")!;
    expect(document.activeElement).toBe(next);
    click(next);
    await flush();
    expect(document.activeElement?.getAttribute("role")).toBe("status");
    expect(document.activeElement).not.toBe(document.body);
  });

  it("renders nothing for no notices", () => {
    mounted = mount(<ServiceNoticeStrip notices={[]} timeZone={TZ} />);
    expect(mounted.container.innerHTML).toBe("");
  });

  it("What happened opens the incident box in a dialog", () => {
    mounted = mount(
      <ServiceNoticeStrip
        notices={[
          notice({
            incident: {
              title: "Booking emails late",
              public_text: "We are fixing it.",
              status: "open",
            },
          }),
        ]}
        timeZone={TZ}
      />,
    );
    const link = button(mounted.container, "What happened");
    expect(link).not.toBeNull();
    click(link);
    expect(document.body.textContent).toContain("Booking emails late");
    expect(document.body.textContent).toContain("We are fixing it.");
  });

  it("a fixed incident in the dialog says nothing about a ticket (WR-D08)", () => {
    mounted = mount(
      <ServiceNoticeStrip
        notices={[
          notice({
            incident: {
              title: "Booking emails late",
              public_text: "All sent now.",
              status: "resolved",
            },
          }),
        ]}
        timeZone={TZ}
      />,
    );
    click(button(mounted.container, "What happened"));
    expect(document.body.textContent).toContain("All sent now.");
    expect(document.body.textContent).not.toMatch(/ticket/i);
  });

  it("message text is a text node, never markup (T-12-14-01)", () => {
    mounted = mount(
      <ServiceNoticeStrip
        notices={[notice({ text: "Support is working <b>x</b>" })]}
        timeZone={TZ}
      />,
    );
    expect(mounted.container.querySelector("b")).toBeNull();
  });
});

describe("noticesForPath", () => {
  const site = notice({ id: "s", reach: { scope: "everywhere" } });
  const legacy = notice({ id: "l" });
  const page = notice({ id: "p", reach: { scope: "page", page: "p1" } });
  const footer = notice({
    id: "f",
    reach: { scope: "component", component: "footer" },
  });
  const header = notice({
    id: "h",
    reach: { scope: "component", component: "header" },
  });
  const addon = notice({
    id: "a",
    reach: { scope: "component", component: "events" },
  });
  const all = [site, legacy, page, footer, header, addon];
  const ids = (path: string) => noticesForPath(all, path).map((n) => n.id);

  it("site-wide notices show everywhere", () => {
    expect(ids("/hub/today")).toEqual(["s", "l"]);
    expect(ids("/hub/settings")).toEqual(["s", "l"]);
  });

  it("a page notice shows on that page's builder only", () => {
    expect(ids("/hub/website/pages/p1")).toContain("p");
    expect(ids("/hub/website/pages/p2")).not.toContain("p");
    expect(ids("/hub/website")).not.toContain("p");
  });

  it("site parts show on their Website tab", () => {
    expect(ids("/hub/website?tab=footer")).toContain("f");
    expect(ids("/hub/website?tab=footer")).not.toContain("h");
    expect(ids("/hub/website?tab=banner")).toContain("h");
    expect(ids("/hub/website?tab=site")).toContain("h");
    expect(ids("/hub/website?tab=pages")).not.toContain("f");
  });

  it("an add-on component shows on that add-on's screens", () => {
    expect(ids("/hub/add-ons/events")).toContain("a");
    expect(ids("/hub/website?tab=events")).toContain("a");
    expect(ids("/hub/events")).toContain("a");
    expect(ids("/hub/add-ons/newsletter")).not.toContain("a");
    expect(ids("/hub/today")).not.toContain("a");
  });
});

describe("LockedPanel", () => {
  it("shows the paused heading, LOCKED-BODY and the end time", () => {
    mounted = mount(
      <LockedPanel target="page" until={END} timeZone={TZ} now={NOW} />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain(
      "Editing is paused while Support works on this page",
    );
    expect(text).toContain(NOTICES_COPY.LOCKED_BODY);
    expect(text).toContain("Until 4:00 pm");
    expect(text).not.toContain(SUPPORT_COPY.HELD_KEPT);
    expect(
      mounted.container.querySelector("[data-cds-identity]"),
    ).not.toBeNull();
  });

  it("with held changes shows HELD-KEPT and the saved time", () => {
    mounted = mount(
      <LockedPanel
        target="page"
        until={END}
        timeZone={TZ}
        now={NOW}
        held={{ savedAt: "2026-10-12T19:14:00Z" }}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain(SUPPORT_COPY.HELD_KEPT);
    expect(text).toContain("Saved at 2:14 pm");
  });

  it("names the day when the held change is from an earlier day (IN-D08)", () => {
    const panel = (savedAt: string) => {
      mounted?.unmount();
      mounted = mount(
        <LockedPanel
          target="page"
          until={END}
          timeZone={TZ}
          now={NOW}
          held={{ savedAt }}
        />,
      );
      return mounted.container.textContent ?? "";
    };
    expect(panel("2026-10-11T19:14:00Z")).toContain(
      "Saved yesterday at 2:14 pm",
    );
    expect(panel("2026-10-09T19:14:00Z")).toContain(
      "Saved Fri 9 Oct at 2:14 pm",
    );
  });
});

describe("HeldChangesPanel", () => {
  it("offers Apply and Discard, outside the Support layer", async () => {
    const onApply = vi.fn(async () => {});
    const onDiscard = vi.fn(async () => {});
    mounted = mount(
      <HeldChangesPanel
        savedAt="2026-10-12T19:14:00Z"
        timeZone={TZ}
        onApply={onApply}
        onDiscard={onDiscard}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain(
      "Support has finished. Your changes from 2:14 pm are waiting.",
    );
    expect(text).toContain(NOTICES_COPY.HELD_APPLY_NOTE);
    expect(mounted.container.querySelector("[data-cds-identity]")).toBeNull();
    click(button(mounted.container, "Apply my changes"));
    await flush();
    expect(onApply).toHaveBeenCalledTimes(1);
    click(button(mounted.container, "Discard my changes"));
    await flush();
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("a thrown apply shows ERR-SAVE instead of an unhandled rejection (12-REVIEW IN-D01)", async () => {
    const onApply = vi.fn(async () => {
      throw new Error("network");
    });
    mounted = mount(
      <HeldChangesPanel
        savedAt="2026-10-12T19:14:00Z"
        timeZone={TZ}
        onApply={onApply}
        onDiscard={() => {}}
      />,
    );
    click(button(mounted.container, "Apply my changes"));
    await flush();
    expect(
      mounted.container.querySelector('[role="alert"]')?.textContent,
    ).toContain("That didn't save.");
  });
});
