// @vitest-environment jsdom
// Help center and Help article (11-46; DASH-17; 11-UI-SPEC "Help" lines 592-610; T-11-46-02).
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { mount, typeInto, type Mounted } from "../../test-support/dom";
import {
  HELP_COPY,
  HelpArticle,
  HelpCenter,
  filterHelpEntries,
  inlineMarks,
  type HelpCenterGroup,
} from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

const entry = (id: string, title: string, summary: string, text = "") => ({
  id,
  title,
  summary,
  href: `/hub/help/${id}`,
  searchText: `${summary} ${text}`.toLowerCase(),
});

const GROUPS: HelpCenterGroup[] = [
  {
    key: "addons",
    label: "Your add-ons",
    entries: [entry("addon-testimonials", "How Testimonials works", "Quotes.")],
  },
  {
    key: "site",
    label: "Your site",
    entries: [
      entry("add-pages", "Page allowance and Add 5 more pages", "10 pages."),
      entry("delete-page", "Delete and restore a page", "Gone for good?"),
      entry("phone-alerts", "Alerts on your phone", "Push.", "turn on alerts"),
      entry("today", "Today", "First screen.", "open the pages list"),
    ],
  },
];

function rows(): string[] {
  return [...document.querySelectorAll("[data-help-row]")].map(
    (el) => el.getAttribute("data-help-row") ?? "",
  );
}

describe("HelpCenter (DASH-17)", () => {
  it("shows every group, rows with summaries, the count and the footer", () => {
    mounted = mount(<HelpCenter groups={GROUPS} />);
    const groups = [...document.querySelectorAll("h2")].map(
      (h) => h.textContent,
    );
    expect(groups).toEqual(["Your add-ons", "Your site"]);
    expect(rows()).toHaveLength(5);
    expect(document.querySelector("[data-help-count]")?.textContent).toBe(
      "5 articles",
    );
    expect(
      document.querySelector("[data-help-count]")?.getAttribute("aria-live"),
    ).toBe("polite");
    const label = document.querySelector("label");
    expect(label?.textContent).toBe("Search help");
    expect(document.querySelector("input")?.getAttribute("type")).toBe(
      "search",
    );
    expect(document.querySelector("[data-help-footer]")?.textContent).toBe(
      "Can't find it? Ask CDS Support.",
    );
    // 12-20: Ask CDS Support opens the Get help form (no target).
    expect(
      document.querySelector("[data-help-footer] a")?.getAttribute("href"),
    ).toBe("/hub/support/tickets/new");
    const link = document.querySelector<HTMLAnchorElement>(
      '[data-help-row="today"] a',
    );
    expect(link?.getAttribute("href")).toBe("/hub/help/today");
  });

  it('typing "pages" keeps page articles, title matches first', () => {
    mounted = mount(<HelpCenter groups={GROUPS} />);
    typeInto(document.querySelector("input")!, "pages");
    expect(rows()).toEqual(["add-pages", "today"]);
    expect(document.querySelectorAll("h2")).toHaveLength(1);
    expect(document.querySelector("[data-help-count]")?.textContent).toBe(
      "2 articles",
    );
    typeInto(document.querySelector("input")!, "page");
    expect(rows()).toEqual(["add-pages", "delete-page", "today"]);
  });

  it("no match shows HELP-EMPTY with Ask CDS Support", () => {
    mounted = mount(<HelpCenter groups={GROUPS} />);
    typeInto(document.querySelector("input")!, "zebra");
    expect(rows()).toEqual([]);
    const empty = document.querySelector("[data-help-empty]");
    expect(empty?.textContent).toBe(
      'No help articles match "zebra". Try another word, or ask CDS Support.',
    );
    expect(empty?.querySelector("a")?.getAttribute("href")).toBe(
      "/hub/support/tickets/new",
    );
    expect(document.querySelector("[data-help-count]")?.textContent).toBe(
      "0 articles",
    );
  });

  it("nothing to list and no search: no empty quoted query (IN-D05)", () => {
    mounted = mount(<HelpCenter groups={[]} />);
    const empty = document.querySelector("[data-help-empty]");
    expect(empty?.textContent).toBe(
      "No help articles here yet. For anything you need, ask CDS Support.",
    );
    expect(empty?.textContent).not.toContain('""');
  });

  it("filterHelpEntries needs every word; blank keeps all", () => {
    const all = GROUPS[1]!.entries;
    expect(filterHelpEntries(all, "  ")).toHaveLength(4);
    expect(filterHelpEntries(all, "alerts turn").map((e) => e.id)).toEqual([
      "phone-alerts",
    ]);
    expect(filterHelpEntries(all, "alerts zebra")).toEqual([]);
  });

  it("uses the singular for one article", () => {
    expect(HELP_COPY.count(1)).toBe("1 article");
  });
});

describe("HelpArticle (DASH-17)", () => {
  const steps = {
    activate: [
      { screen: "`/hub/today`", action: "Click **Today**", expected: "Opens" },
    ],
    use: [
      { screen: "Today", action: "Read the line", expected: "It says hi" },
      {
        screen: "",
        action: "See [Profile](profile-and-alerts.md) and [Staff](x.md)",
        expected: "",
      },
    ],
  };

  it("renders numbered Turn it on and Use it steps with expected results", () => {
    const html = renderToStaticMarkup(
      <HelpArticle
        title="Today"
        {...steps}
        goTo={{ label: "Today", href: "/hub/today" }}
        linkFor={(t) => (t === "profile-and-alerts.md" ? "/hub/help/x" : null)}
      />,
    );
    document.body.innerHTML = html;
    const h2 = [...document.querySelectorAll("h2")].map((h) => h.textContent);
    expect(h2).toEqual(["Turn it on", "Use it"]);
    expect(document.querySelector("h1")?.textContent).toBe("Today");
    const lists = document.querySelectorAll("ol");
    expect(lists).toHaveLength(2);
    expect(lists[1]!.querySelectorAll("li")).toHaveLength(2);
    expect(lists[0]!.querySelector("strong")?.textContent).toBe("Today");
    expect(lists[0]!.querySelector("code")?.textContent).toBe("/hub/today");
    expect(lists[1]!.textContent).toContain("It says hi");
    const links = [...lists[1]!.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/hub/help/x"]);
    expect(lists[1]!.textContent).toContain("Staff");
    const back = document.querySelector("[data-help-back]");
    expect(back?.getAttribute("href")).toBe("/hub/help");
    expect(back?.textContent).toBe("Help");
    const go = document.querySelector("[data-help-goto]");
    expect(go?.textContent).toBe("Go to Today");
    expect(go?.getAttribute("href")).toBe("/hub/today");
  });

  it("omits Turn it on with no activate steps and Go to without a screen", () => {
    const html = renderToStaticMarkup(
      <HelpArticle title="X" activate={[]} use={steps.use} />,
    );
    expect(html).not.toContain("Turn it on");
    expect(html).not.toContain("data-help-goto");
  });

  it("never renders raw HTML from step text (T-11-46-02)", () => {
    const html = renderToStaticMarkup(
      <>
        {inlineMarks('<img src=x onerror="alert(1)"> **b**', undefined, "a")}
      </>,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("<strong>b</strong>");
  });
});
