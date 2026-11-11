// @vitest-environment jsdom
// Today building blocks (13-47; STAFF-20, D-UI-P13-5, D-UI-P13-20; 13-UI-SPEC "Today",
// "Sidebar"): TODAY-EMPTY, CountRow names and markers, "Couldn't count", the status line, the
// neutral "9+" sidebar badge and the 60 s / on-focus refresh.
import { P13_COPY } from "@cds/core/staff";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mount, typeInto, type Mounted } from "../../test-support/dom";
import { StaffFind, StaffSidebar } from "../shell";
import {
  CountRowList,
  STAFF_TODAY_COPY,
  TodayRefresher,
  TodayStatusLine,
  countRowName,
  todayMarker,
  withAttentionTitle,
  type TodayRowView,
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
  vi.useRealTimers();
});

const ROWS: TodayRowView[] = [
  {
    id: "sla_missed",
    count: 2,
    severity: "critical",
    label: "2 tickets missed SLA",
    href: "/staff/tickets?sla=missed",
    oldestDays: 3,
  },
  {
    id: "sla_at_risk",
    count: 3,
    severity: "warn",
    label: "3 tickets at SLA risk",
    href: "/staff/tickets?sla=at-risk",
    oldestDays: 2,
  },
  {
    id: "fit_holds",
    count: null,
    severity: "info",
    label: "Fit holds",
    href: "/staff/pipeline?tab=fit",
  },
];

describe("CountRowList", () => {
  it("no rows renders TODAY-EMPTY and See all open tickets", () => {
    mounted = mount(<CountRowList rows={[]} />);
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("Nothing needs you.");
    expect(text).toContain("Go do something nice.");
    expect(text).toContain(P13_COPY.TODAY_EMPTY_H);
    const link = mounted.container.querySelector("a");
    expect(link?.textContent).toBe(STAFF_TODAY_COPY.seeAllOpen);
    expect(link?.getAttribute("href")).toBe("/staff/tickets");
    expect(mounted.container.querySelector("ul")).toBeNull();
  });

  it("rows are one list of links with names, counts and markers", () => {
    mounted = mount(<CountRowList rows={ROWS} />);
    const links = [...mounted.container.querySelectorAll("li a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/staff/tickets?sla=missed",
      "/staff/tickets?sla=at-risk",
      "/staff/pipeline?tab=fit",
    ]);
    expect(links[1]?.getAttribute("aria-label")).toBe(
      "3 tickets at SLA risk, oldest 2 days. Open.",
    );
    expect(links[1]?.textContent).toContain("oldest 2d");
    expect(links[2]?.textContent).toContain("Couldn't count");
    expect(mounted.container.querySelector("h2")?.textContent).toBe(
      "Needs attention",
    );
  });

  it("markers: critical is danger, warn is warning, info and failed have none", () => {
    expect(todayMarker(ROWS[0]!)?.className).toBe("text-hub-danger");
    expect(todayMarker(ROWS[1]!)?.className).toBe("text-hub-warning");
    expect(todayMarker(ROWS[2]!)).toBeNull();
    expect(countRowName(ROWS[2]!)).toBe("Fit holds: Couldn't count. Open.");
  });
});

describe("TodayStatusLine", () => {
  it("live · building · open tickets · Jobs OK, each a link", () => {
    mounted = mount(
      <TodayStatusLine
        status={{ live: 14, building: 3, openTickets: 9, jobsLate: 0 }}
      />,
    );
    const links = [...mounted.container.querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual([
      "14 live",
      "3 building",
      "9 open tickets",
      "Jobs OK",
    ]);
  });

  it("a late job reads in warning text; an unknown segment is left out", () => {
    mounted = mount(
      <TodayStatusLine
        status={{ live: null, building: 1, openTickets: 1, jobsLate: 1 }}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("1 job late");
    expect(text).not.toContain("live");
    const late = [...mounted.container.querySelectorAll("a")].at(-1);
    expect(late?.className).toContain("text-hub-warning");
    expect(late?.querySelector("svg")).not.toBeNull();
  });
});

describe("sidebar badge", () => {
  it("12 renders 9+ and is never danger-toned", () => {
    mounted = mount(
      <StaffSidebar
        nav={[
          {
            key: "tickets",
            href: "/staff/tickets",
            label: "Tickets",
            icon: "LifeBuoy",
            badge: 12,
          },
        ]}
        user={{ name: "Sam", roleLabel: "Super Admin" }}
        env="production"
        signOutAction={async () => {}}
      />,
    );
    const chip = mounted.container.querySelector("[data-nav-badge]");
    expect(chip?.textContent).toBe("9+");
    expect(chip?.className).not.toMatch(/danger|critical|red/);
    expect(mounted.container.textContent).toContain("12 need attention");
  });
});

describe("refresh", () => {
  it("every 60 s while visible and on focus; the title gains (n)", () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    document.title = "Today · CDS staff";
    mounted = mount(<TodayRefresher onRefresh={onRefresh} attention={3} />);
    expect(document.title).toBe("(3) Today · CDS staff");
    vi.advanceTimersByTime(59_000);
    expect(onRefresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus"));
    expect(onRefresh).toHaveBeenCalledTimes(2);
    const vis = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    vi.advanceTimersByTime(60_000);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    vis.mockRestore();
  });

  it("withAttentionTitle replaces an old prefix and drops it at 0", () => {
    expect(withAttentionTitle("(2) Today · CDS staff", 5)).toBe(
      "(5) Today · CDS staff",
    );
    expect(withAttentionTitle("(2) Today · CDS staff", 0)).toBe(
      "Today · CDS staff",
    );
  });
});

describe("Find with server Sites / Cases entries (13-47)", () => {
  it("tickets first (exact number on top), then server-found sites and cases in their groups", async () => {
    const searchTickets = vi.fn(async () => [
      { number: 1001, subject: "Menu", href: "/staff/tickets/1001", site: "A" },
      {
        number: 1042,
        subject: "Hours",
        href: "/staff/tickets/1042",
        site: "B",
      },
      {
        group: "Sites" as const,
        label: "Bella Rivera Studio",
        href: "/staff/sites/abcdefghijklmno",
        path: "bella.example",
      },
      {
        group: "Cases" as const,
        label: "R-1 · Report",
        href: "/staff/review/R-1",
      },
    ]);
    mounted = mount(
      <StaffFind
        open
        onOpenChange={() => {}}
        index={[
          {
            group: "Sites",
            label: "Bella Rivera Studio",
            href: "/staff/sites/abcdefghijklmno",
          },
        ]}
        searchTickets={searchTickets}
        onNavigate={() => {}}
      />,
    );
    const input = document.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    typeInto(input, "1042");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    const groups = [...document.querySelectorAll('[role="group"]')].map((g) =>
      g.getAttribute("aria-label"),
    );
    expect(groups.slice(0, 3)).toEqual(["Tickets", "Sites", "Cases"]);
    const options = [...document.querySelectorAll('[role="option"]')].map(
      (o) => o.textContent ?? "",
    );
    expect(options[0]).toContain("1042");
    // The same site from the server and the static index shows once.
    expect(
      options.filter((o) => o.includes("Bella Rivera Studio")).length,
    ).toBe(1);
    expect(options.some((o) => o.includes("R-1 · Report"))).toBe(true);
  });
});
