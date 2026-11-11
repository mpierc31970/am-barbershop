// @vitest-environment jsdom
// Today stage + Needs-you components (11-17; DASH-02, DASH-19, DASH-20, DASH-30, DASH-31,
// DASH-33; 11-UI-SPEC "Today" §§ 1-3; D-UI-P11-10, 25, 26).
import { deriveTracker, type NeedsYouItem } from "@cds/core/today";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mount, type Mounted } from "../../test-support/dom";
import {
  BuildTracker,
  LaunchReviewCard,
  NeedsYouList,
  StatusLine,
  TODAY_COPY,
  TodaySectionError,
  YoureLive,
  formatDayMonth,
  relativeAge,
  youreLiveSteps,
} from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function item(over: Partial<NeedsYouItem> & { key: string }): NeedsYouItem {
  return {
    kind: "test",
    level: "normal",
    title: `Title ${over.key}`,
    actionLabel: "Open",
    href: `/hub/settings?x=${over.key}`,
    section: "settings",
    at: "2026-10-11T10:00:00.000Z",
    ...over,
  };
}

describe("NeedsYouList", () => {
  it("empty list reads You're all caught up.", () => {
    mounted = mount(<NeedsYouList items={[]} />);
    const root = mounted.container;
    expect(root.querySelector("h2")!.textContent).toBe("Needs you");
    expect(root.textContent).toContain("You're all caught up.");
    expect(root.querySelectorAll("a")).toHaveLength(0);
  });

  it("one link per row, labelled by actionLabel, in the given order; urgent marked", () => {
    const items = [
      item({
        key: "billing:fix_card",
        level: "urgent",
        actionLabel: "Fix your card",
        title: "Your card was declined",
      }),
      item({
        key: "email:r1",
        actionLabel: "Confirm email address",
        title: "Confirm a@b.co",
      }),
      item({
        key: "intake:logo",
        actionLabel: "Add your logo",
        title: "Your logo",
        optional: true,
        sub: "Optional: we'll use your business name if you skip it",
      }),
    ];
    mounted = mount(<NeedsYouList items={items} />);
    const root = mounted.container;
    const rows = [...root.querySelectorAll("li")];
    expect(rows.map((r) => r.getAttribute("data-needs-you-item"))).toEqual([
      "billing:fix_card",
      "email:r1",
      "intake:logo",
    ]);
    for (const r of rows) expect(r.querySelectorAll("a")).toHaveLength(1);
    const links = [...root.querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual([
      "Fix your card",
      "Confirm email address",
      "Add your logo",
    ]);
    expect(links[0]!.getAttribute("aria-label")).toBe(
      "Fix your card: Your card was declined",
    );
    expect(links[0]!.getAttribute("href")).toBe(
      "/hub/settings?x=billing:fix_card",
    );
    expect(rows[0]!.textContent).toContain("Urgent");
    expect(rows[1]!.textContent).not.toContain("Urgent");
    expect(rows[2]!.textContent).toContain("Optional");
    // No primary button in the normal state (D-UI-P11-10).
    expect(root.querySelector(".bg-hub-accent")).toBeNull();
    expect(root.textContent).toContain("3");
  });

  it("more than 8: first 8 then Show all N expands in place", () => {
    const items = Array.from({ length: 12 }, (_, i) => item({ key: `k${i}` }));
    mounted = mount(<NeedsYouList items={items} />);
    const root = mounted.container;
    expect(root.querySelectorAll("li")).toHaveLength(8);
    const more = [...root.querySelectorAll("button")].find(
      (b) => b.textContent === "Show all 12",
    );
    click(more);
    expect(root.querySelectorAll("li")).toHaveLength(12);
    expect(root.textContent).not.toContain("Show all");
  });

  it("inbox rows add the age to the sub-line", () => {
    const now = Date.parse("2026-10-11T12:00:00.000Z");
    mounted = mount(
      <NeedsYouList
        now={now}
        items={[
          item({
            key: "inbox:m1",
            section: "inbox",
            sub: "From the Contact form",
            actionLabel: "Reply",
            title: "Dana Lee",
          }),
          item({ key: "email:r1", sub: "Waiting" }),
        ]}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("From the Contact form · 2 hours ago");
    expect(text).not.toContain("Waiting ·");
  });
});

describe("BuildTracker", () => {
  const steps = deriveTracker({
    stage: "being_built",
    paidAt: "2026-10-09 15:00:00.000Z",
    assembly: "done",
  });

  it("marks the current step with aria-current=step and a visible word", () => {
    mounted = mount(<BuildTracker steps={steps} timeZone="America/Chicago" />);
    const root = mounted.container;
    expect(root.querySelector("h2")!.textContent).toBe("Your build");
    const items = [...root.querySelectorAll("ol > li")];
    expect(items).toHaveLength(5);
    const current = root.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.getAttribute("data-step")).toBe("polishing");
    expect(current[0]!.textContent).toContain("CDS polishing");
    expect(current[0]!.textContent).toContain("Now");
    // Status words, never colour alone.
    expect(items[0]!.textContent).toContain("Done");
    expect(items[0]!.textContent).toContain("9 Oct");
    expect(items[4]!.textContent).toContain("Not started");
    // No note: the step's default line; TRACK-EDIT always.
    expect(root.textContent).toContain(
      "What CDS is doing now: CDS is refining your pages, photos and wording.",
    );
    expect(root.textContent).toContain(TODAY_COPY.trackEdit);
    expect(root.textContent).not.toMatch(/%/);
  });

  it("shows the build note with its date when set", () => {
    mounted = mount(
      <BuildTracker
        steps={steps}
        note="Choosing photos for your services page."
        noteAt="2026-10-09 18:00:00.000Z"
        timeZone="America/Chicago"
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain(
      "What CDS is doing now: Choosing photos for your services page.",
    );
    expect(text).toContain("Updated 9 Oct");
  });
});

describe("LaunchReviewCard", () => {
  const items = [
    { id: "pages_reviewed", label: "Every page looked over", done: false },
    { id: "changes_sent", label: "Changes you asked for", done: false },
    { id: "key_facts", label: "Your key details confirmed", done: false },
    { id: "phone_check", label: "Checked on your phone", done: false },
    { id: "test_form", label: "Test form received", done: false },
    { id: "no_open_requests", label: "No open change requests", done: false },
  ];

  it("shows 0 of 6 done and REVIEW-SOON, no button, when not available", () => {
    mounted = mount(
      <LaunchReviewCard
        items={items}
        done={0}
        total={6}
        available={false}
        canContinue
      />,
    );
    const root = mounted.container;
    expect(root.textContent).toContain("0 of 6 done");
    expect(root.textContent).toContain(TODAY_COPY.reviewSoon);
    expect(root.querySelector("a")).toBeNull();
    expect(root.querySelector("button")).toBeNull();
    const bar = root.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(bar.getAttribute("aria-valuetext")).toBe("0 of 6 done");
    expect(root.querySelectorAll("li")).toHaveLength(6);
  });

  it("available: Continue review for the Owner; none read-only", () => {
    const done = items.map((i, n) => ({ ...i, done: n < 4 }));
    mounted = mount(
      <LaunchReviewCard
        items={done}
        done={4}
        total={6}
        available
        canContinue
      />,
    );
    expect(mounted.container.textContent).toContain("4 of 6 done");
    const link = mounted.container.querySelector("a")!;
    expect(link.textContent).toBe("Continue review");
    mounted.unmount();
    mounted = mount(
      <LaunchReviewCard
        items={done}
        done={4}
        total={6}
        available
        canContinue={false}
      />,
    );
    expect(mounted.container.querySelector("a")).toBeNull();
  });

  it("14-34: available links to /hub/review; submitted shows SUBMITTED-H and no button", () => {
    const all = items.map((i) => ({ ...i, done: true }));
    mounted = mount(
      <LaunchReviewCard items={all} done={6} total={6} available canContinue />,
    );
    expect(mounted.container.querySelector("a")!.getAttribute("href")).toBe(
      "/hub/review",
    );
    mounted.unmount();
    mounted = mount(
      <LaunchReviewCard
        items={all}
        done={6}
        total={6}
        available
        canContinue
        submitted
      />,
    );
    const root = mounted.container;
    expect(root.querySelector("h2")!.textContent).toBe(
      "CDS is giving it a final look.",
    );
    expect(root.querySelector("a")).toBeNull();
    expect(root.querySelector("[data-submitted]")).not.toBeNull();
  });
});

describe("YoureLive", () => {
  it("three steps and a primary Show my Today; step links report first", () => {
    const onShowToday = vi.fn();
    const onStep = vi.fn();
    mounted = mount(
      <YoureLive
        host="riverabakery.com"
        steps={youreLiveSteps(null)}
        onShowToday={onShowToday}
        onStep={onStep}
        LinkComponent={({ children, ...rest }) => (
          <a
            {...rest}
            onClick={(e) => {
              e.preventDefault();
              rest.onClick?.(e);
            }}
          >
            {children}
          </a>
        )}
      />,
    );
    const root = mounted.container;
    expect(root.querySelector("h1")!.textContent).toBe(
      "You're live at riverabakery.com",
    );
    expect(root.textContent).toContain(TODAY_COPY.liveBody);
    const steps = [...root.querySelectorAll("li")];
    expect(steps).toHaveLength(3);
    expect(steps[2]!.textContent).toContain("See your Site Report");
    const primary = [...root.querySelectorAll("button")].find(
      (b) => b.textContent === "Show my Today",
    )!;
    expect(primary.className).toContain("bg-hub-accent");
    click(primary);
    expect(onShowToday).toHaveBeenCalledTimes(1);
    click(steps[0]!.querySelector("a"));
    expect(onStep).toHaveBeenCalledWith("share");
  });

  it("step 3 is Outreach when an Outreach add-on is active", () => {
    const steps = youreLiveSteps("/hub/marketing?tab=outreach");
    expect(steps[2]!.id).toBe("outreach");
    expect(steps[2]!.href).toBe("/hub/marketing?tab=outreach");
  });
});

describe("StatusLine", () => {
  it("being built: badge, STATUS-BUILT and View preview in a new tab", () => {
    mounted = mount(
      <StatusLine
        greeting="Good morning"
        stage="being_built"
        host="rivera.sites.localhost"
      />,
    );
    const root = mounted.container;
    expect(root.querySelector("h1")!.textContent).toBe("Good morning");
    expect(root.textContent).toContain("Being built");
    expect(root.textContent).toContain(TODAY_COPY.statusBuilt);
    const link = [...root.querySelectorAll("a")].find((a) =>
      a.textContent?.startsWith("View preview"),
    )!;
    expect(link.getAttribute("href")).toBe("https://rivera.sites.localhost");
    expect(link.getAttribute("target")).toBe("_blank");
    // The "?" is Today help.
    expect(
      root.querySelector('a[aria-label="How Today works"]'),
    ).not.toBeNull();
  });

  it("live: the host sentence and View site", () => {
    mounted = mount(
      <StatusLine
        greeting="Good evening"
        stage="live"
        host="riverabakery.com"
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("Live");
    expect(text).toContain("Your site is live at riverabakery.com.");
    expect(text).toContain("View site");
  });

  it("ready for review and intake", () => {
    mounted = mount(
      <StatusLine
        greeting="Good morning"
        stage="ready_for_review"
        host={null}
      />,
    );
    expect(mounted.container.textContent).toContain("Ready for your review");
    expect(mounted.container.textContent).toContain(TODAY_COPY.statusReview);
    mounted.unmount();
    mounted = mount(
      <StatusLine
        greeting="Good morning"
        stage="intake"
        host="x.sites.localhost"
      />,
    );
    expect(mounted.container.querySelector("p")).toBeNull();
  });
});

describe("TodaySectionError and formatters", () => {
  it("ERR-SECTION with Try again", () => {
    mounted = mount(<TodaySectionError title="Needs you" />);
    const root = mounted.container;
    expect(root.querySelector('[role="alert"]')!.textContent).toContain(
      TODAY_COPY.errSection,
    );
    expect(root.querySelector("a")!.getAttribute("href")).toBe("/hub/today");
  });

  it("formats dates and ages", () => {
    expect(formatDayMonth("2026-10-09 15:00:00.000Z", "America/Chicago")).toBe(
      "9 Oct",
    );
    expect(formatDayMonth("2026-09-14 15:00:00.000Z", "America/Chicago")).toBe(
      "14 Sep",
    );
    expect(formatDayMonth("nope", "America/Chicago")).toBe("");
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(relativeAge("2026-10-11T11:59:40Z", now)).toBe("just now");
    expect(relativeAge("2026-10-11T11:00:00Z", now)).toBe("1 hour ago");
    expect(relativeAge("2026-10-08T12:00:00Z", now)).toBe("3 days ago");
  });
});
