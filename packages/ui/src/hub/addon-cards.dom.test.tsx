// @vitest-environment jsdom
// Catalog card, add-on tab header and training drawer (05-06; 05-UI-SPEC "Catalog",
// "Add-on tabs" item 1, "Training", R1, R2; ADDON-11).
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { button, click, mount, type Mounted } from "../test-support/dom";
import { ADDON_CARD_COPY, AddonCard } from "./AddonCard";
import { AddonTabHeader } from "./AddonTabHeader";
import { Badge } from "./Badge";
import { TrainingDrawer } from "./TrainingDrawer";
import * as hub from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function card(over: Partial<Parameters<typeof AddonCard>[0]> = {}) {
  const onAdd = vi.fn();
  mounted = mount(
    <AddonCard
      name="Testimonials"
      summary="Show the kind words customers send you."
      meta="Reviews · Adds a page, a block and a tab"
      active={false}
      href="/hub/add-ons/testimonials"
      manageHref="/hub/website?tab=testimonials"
      canAdd
      priceLabel="$9/mo"
      paused={false}
      onAdd={onAdd}
      {...over}
    />,
  );
  return { el: mounted.container, onAdd };
}

const links = (root: ParentNode) => Array.from(root.querySelectorAll("a"));

describe("AddonCard", () => {
  it("is an article labelled by its name, with the name as the one detail link", () => {
    const { el } = card();
    const article = el.querySelector("article")!;
    const labelId = article.getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelId)?.textContent).toBe("Testimonials");
    const nameLink = document.getElementById(labelId)!.querySelector("a")!;
    expect(nameLink.getAttribute("href")).toBe("/hub/add-ons/testimonials");
    expect(article.className).toContain("min-h-44");
    expect(article.innerHTML).not.toContain("bg-hub-accent");
  });

  it("not added: secondary Add to site calls onAdd, no badge", () => {
    const { el, onAdd } = card();
    expect(el.textContent).not.toContain("On your site");
    const add = button(el, "Add to site")!;
    expect(add.className).not.toContain("bg-hub-accent");
    click(add);
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("added: shows On your site and Manage with its noun (R1)", () => {
    const { el } = card({ active: true });
    expect(el.textContent).toContain("On your site");
    expect(button(el, "Add to site")).toBeNull();
    const manage = links(el).find(
      (a) => a.getAttribute("aria-label") === "Manage Testimonials",
    );
    expect(manage?.getAttribute("href")).toBe("/hub/website?tab=testimonials");
    expect(manage?.textContent).toBe("Manage");
    const details = links(el).find(
      (a) => a.getAttribute("aria-label") === "Testimonials details",
    );
    expect(details?.textContent).toBe("Details");
  });

  it("Admin (canAdd false) sees Details only", () => {
    for (const active of [false, true]) {
      const { el } = card({ canAdd: false, active });
      expect(el.querySelectorAll("button")).toHaveLength(0);
      expect(links(el).map((a) => a.textContent)).toEqual([
        "Testimonials",
        "Details",
      ]);
      mounted?.unmount();
      mounted = null;
    }
  });
});

describe("AddonCard prices and paused (10-31; BILL-18, BILL-03)", () => {
  it("shows the catalog price on the meta line, Body 600 tabular", () => {
    const { el } = card();
    const price = el.querySelector("[data-addon-price]")!;
    expect(price.textContent).toBe("$9/mo");
    expect(price.className).toContain("font-semibold");
    expect(price.className).toContain("tabular-nums");
  });

  it("$0 rows read Included", () => {
    const { el } = card({ priceLabel: "Included" });
    expect(el.querySelector("[data-addon-price]")?.textContent).toBe(
      "Included",
    );
  });

  it("unpriced: Price coming soon (muted) and an aria-disabled Add with UNPRICED-ADDON", () => {
    const { el, onAdd } = card({ priceLabel: null });
    const price = el.querySelector("[data-addon-price]")!;
    expect(price.textContent).toBe(ADDON_CARD_COPY.priceSoon);
    expect(price.className).toContain("text-hub-ink-muted");
    const add = button(el, "Add to site")!;
    expect(add.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(
      add.getAttribute("aria-describedby")!,
    );
    expect(reason?.textContent).toBe(ADDON_CARD_COPY.unpriced);
    click(add);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("paused: Paused badge, no Add or Manage, Details only", () => {
    const { el } = card({ paused: true });
    expect(el.textContent).toContain("Paused");
    expect(el.textContent).not.toContain("On your site");
    expect(el.querySelector("svg")).not.toBeNull();
    expect(el.querySelectorAll("button")).toHaveLength(0);
    expect(links(el).map((a) => a.textContent)).toEqual([
      "Testimonials",
      "Details",
    ]);
  });
});

describe("Badge P5 tones", () => {
  it("on-site uses the success tint; addon-off and expired are neutral", () => {
    mounted = mount(
      <div>
        <Badge tone="on-site">On your site</Badge>
        <Badge tone="addon-off">Add-on off</Badge>
        <Badge tone="expiring">Expires soon · 12 Nov</Badge>
        <Badge tone="expired">Expired · hidden on site</Badge>
      </div>,
    );
    const [onSite, off, expiring, expired] = Array.from(
      mounted.container.querySelectorAll("span"),
    ).filter((s) => s.className.includes("rounded"));
    expect(onSite!.className).toContain("bg-hub-success-tint");
    expect(off!.className).toContain("bg-hub-surface-2");
    expect(expiring!.className).toContain("bg-hub-warning-tint");
    expect(expired!.className).toContain("text-hub-ink-muted");
  });
});

describe("AddonTabHeader", () => {
  function header(primary: { label: string; onClick: () => void } | null) {
    const onHelp = vi.fn();
    const onImport = vi.fn();
    const onExport = vi.fn();
    mounted = mount(
      <AddonTabHeader
        heading="Testimonials"
        countLine="12 testimonials · 9 shown on your site"
        helpLabel="How Testimonials works"
        onHelp={onHelp}
        plural="testimonials"
        primary={primary}
        onImport={onImport}
        menu={[
          { label: "Export CSV", onSelect: onExport },
          { label: "Download the template", onSelect: () => {} },
          { label: "Backups", onSelect: () => {} },
        ]}
      />,
    );
    return { el: mounted.container, onHelp, onImport, onExport };
  }

  it("renders heading, count line, primary and named Import; no ? of its own (11-47)", () => {
    const add = vi.fn();
    const { el, onHelp, onImport } = header({
      label: "Add testimonial",
      onClick: add,
    });
    expect(el.querySelector("h2")?.textContent).toBe("Testimonials");
    expect(el.textContent).toContain("12 testimonials · 9 shown on your site");
    // D-UI-P11-16: the screen's ScreenHeader "?" opens the how-to, never the tab header.
    expect(button(el, "How Testimonials works")).toBeNull();
    expect(onHelp).not.toHaveBeenCalled();
    const primary = button(el, "Add testimonial")!;
    expect(primary.className).toContain("bg-hub-accent");
    click(primary);
    expect(add).toHaveBeenCalledOnce();
    const imp = button(el, "Import testimonials")!;
    expect(imp.textContent).toBe("Import");
    click(imp);
    expect(onImport).toHaveBeenCalledOnce();
  });

  it("omits the primary when null (R2) and opens the overflow menu", () => {
    const { el, onExport } = header(null);
    expect(el.innerHTML).not.toContain("bg-hub-accent ");
    expect(button(el, "Add testimonial")).toBeNull();
    expect(button(el, "Export CSV")).toBeNull();
    const more = button(el, "More actions for Testimonials")!;
    click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    click(button(el, "Export CSV"));
    expect(onExport).toHaveBeenCalledOnce();
    expect(button(el, "Export CSV")).toBeNull();
  });

  describe("overflow menu keyboard and focus (C-WR-06)", () => {
    const key = (target: Element, k: string) =>
      act(() => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key: k, bubbles: true }),
        );
      });

    it("opening focuses the first item; aria-controls only while open", () => {
      const { el } = header(null);
      const more = button(el, "More actions for Testimonials")!;
      expect(more.hasAttribute("aria-controls")).toBe(false);
      click(more);
      const id = more.getAttribute("aria-controls")!;
      expect(document.getElementById(id)?.tagName).toBe("UL");
      expect(document.activeElement).toBe(button(el, "Export CSV"));
    });

    it("Esc from an item closes and returns focus to the trigger", () => {
      const { el } = header(null);
      const more = button(el, "More actions for Testimonials")!;
      click(more);
      key(button(el, "Download the template")!, "Escape");
      expect(button(el, "Export CSV")).toBeNull();
      expect(document.activeElement).toBe(more);
      expect(more.getAttribute("aria-expanded")).toBe("false");
    });

    it("picking an item returns focus to the trigger", () => {
      const { el, onExport } = header(null);
      const more = button(el, "More actions for Testimonials")!;
      click(more);
      click(button(el, "Export CSV"));
      expect(onExport).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(more);
    });

    it("a pointer press outside closes it", () => {
      const { el } = header(null);
      click(button(el, "More actions for Testimonials"));
      act(() => {
        document.body.dispatchEvent(
          new Event("pointerdown", { bubbles: true }),
        );
      });
      expect(button(el, "Export CSV")).toBeNull();
    });

    it("a pointer press inside the menu keeps it open", () => {
      const { el } = header(null);
      click(button(el, "More actions for Testimonials"));
      act(() => {
        button(el, "Backups")!.dispatchEvent(
          new Event("pointerdown", { bubbles: true }),
        );
      });
      expect(button(el, "Export CSV")).not.toBeNull();
    });

    it("focus leaving the actions closes it; moving within keeps it", () => {
      const { el } = header(null);
      click(button(el, "More actions for Testimonials"));
      act(() => button(el, "Backups")!.focus());
      expect(button(el, "Export CSV")).not.toBeNull();
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      act(() => outside.focus());
      expect(button(el, "Export CSV")).toBeNull();
      outside.remove();
    });
  });
});

describe("TrainingDrawer", () => {
  it("renders the Use steps as an ordered list with expected results", () => {
    const steps = [
      {
        screen: "Website → Testimonials",
        action: "Select Add testimonial.",
        expected: "The New testimonial drawer opens.",
      },
      {
        screen: "New testimonial drawer",
        action: "Type the quote and the name, then select Save testimonial.",
        expected: "The testimonial appears at the top of the list.",
      },
      {
        screen: "Your Testimonials page",
        action: "Select View.",
        expected: "The quote shows on your site.",
      },
    ];
    mounted = mount(
      <TrainingDrawer
        open={false}
        onClose={() => {}}
        title="How Testimonials works"
        steps={steps}
      />,
    );
    const dialog = mounted.container.querySelector("dialog")!;
    expect(dialog.getAttribute("aria-label")).toBe("How Testimonials works");
    expect(dialog.className).toContain("md:w-[480px]");
    const items = mounted.container.querySelectorAll("ol > li");
    expect(items).toHaveLength(3);
    expect(items[1]!.textContent).toContain("Save testimonial");
    expect(items[1]!.querySelector("p.text-hub-ink-muted")?.textContent).toBe(
      "The testimonial appears at the top of the list.",
    );
    expect(mounted.container.textContent).not.toContain("full how-to");
    expect(mounted.container.querySelector("video")).toBeNull();
  });
});

describe("hub index", () => {
  it("exports the P5 add-on components", () => {
    expect(typeof hub.AddonCard).toBe("function");
    expect(typeof hub.AddonTabHeader).toBe("function");
    expect(typeof hub.TrainingDrawer).toBe("function");
  });
});
