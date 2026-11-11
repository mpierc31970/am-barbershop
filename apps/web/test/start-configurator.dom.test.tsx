// @vitest-environment jsdom
// 06-14 Task 2: the /start configurator choice flow (ONB-06, ONB-08, ONB-11, ONB-12;
// 06-UI-SPEC "Configurator", "Accessibility contract"; D215, D-UI-P6-5, D-UI-P6-7). The
// Configurator mounts in jsdom with plain data (catalog rows, PickableAddon[], PATHS,
// EXTRAS) and a mocked chooseQuoteAction, the same props the server page passes.
import { AUP_CATEGORIES, EXTRAS, PATHS } from "@cds/core/onboarding";
import type { PickableAddon } from "@cds/core/onboarding";
import type { CatalogRow } from "@cds/core/pricing";
import type { ReactNode } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

const action = vi.hoisted(() => ({
  chooseQuoteAction: vi.fn(),
  saveQuoteAction: vi.fn(),
}));
vi.mock("../app/actions/quote", () => action);

const { Configurator } =
  await import("../app/(platform)/start/_components/Configurator");
const logic = await import("../app/(platform)/start/_components/start-logic");

const CATALOG: CatalogRow[] = [
  row("plan", "base", "standard", { monthlyCents: 3900 }),
  row("build_fee", "base", "standard", { oneTimeCents: 150000 }),
  row("plan", "base", "studio", { monthlyCents: 4900 }),
  row("build_fee", "base", "studio", { oneTimeCents: 350000 }),
  row("addon", "testimonials", "standard", { monthlyCents: 900 }),
  row("addon", "credentials", "standard", {}),
  row("extra", "copywriting", "standard", { oneTimeCents: 30000 }),
];

function row(
  itemKind: CatalogRow["itemKind"],
  itemKey: string,
  path: CatalogRow["path"],
  cents: { monthlyCents?: number; oneTimeCents?: number },
): CatalogRow {
  return {
    itemKind,
    itemKey,
    path,
    monthlyCents: cents.monthlyCents ?? null,
    oneTimeCents: cents.oneTimeCents ?? null,
    installments: itemKind === "build_fee" ? 6 : null,
  };
}

function addon(
  slug: string,
  name: string,
  paths: PickableAddon["paths"],
  order: number,
): PickableAddon {
  return {
    slug,
    name,
    summary: `${name} summary.`,
    category: "content",
    paths,
    visibility: "public",
    order,
  };
}

const ADDONS: PickableAddon[] = [
  addon("testimonials", "Testimonials", ["standard", "studio"], 10),
  addon("credentials", "Credentials", ["standard", "studio"], 20),
  addon("fixture-appointments", "Appointments", ["standard"], 30),
];

const SELECTIONS = {
  addons: [] as string[],
  extras: [] as string[],
  carePlan: false,
  cadence: "monthly" as const,
};

function quote(over: Record<string, unknown> = {}) {
  return {
    id: "q1",
    status: "draft" as const,
    path: "standard" as const,
    businessType: "",
    businessTypeOther: "",
    selections: SELECTIONS,
    totals: null,
    email: "",
    savedAt: null,
    expiresAt: null,
    updatedAt: new Date(0),
    businessName: "",
    description: "",
    ...over,
  };
}

let mounted: Mounted | null = null;
function render(initialQuote: ReturnType<typeof quote> | null = null) {
  mounted = mount(
    <Configurator
      initialQuote={initialQuote}
      catalog={CATALOG}
      addons={ADDONS}
      paths={PATHS}
      extras={EXTRAS}
    />,
  );
  return mounted.container;
}

const radios = (el: ParentNode, group: string) =>
  Array.from(
    el.querySelectorAll(`[aria-labelledby="${group}"] [role="radio"]`),
  ) as HTMLElement[];
const radio = (el: ParentNode, name: string) =>
  (Array.from(el.querySelectorAll('[role="radio"]')) as HTMLElement[]).find(
    (r) => r.dataset.value === name,
  )!;
const heading = (el: ParentNode, text: string) =>
  Array.from(el.querySelectorAll("h1, h2, h3")).find((h) =>
    h.textContent?.startsWith(text),
  ) as HTMLElement | undefined;
const checkbox = (el: ParentNode, value: string) =>
  el.querySelector(
    `input[type="checkbox"][value="${value}"]`,
  ) as HTMLInputElement | null;

/** Let pending action promises resolve while fake timers are on (flush needs real ones). */
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function key(el: Element, k: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}

beforeEach(() => {
  action.chooseQuoteAction.mockReset();
  action.chooseQuoteAction.mockImplementation(async (patch) => ({
    quote: quote({ ...patch }),
    removed: [],
    error: null,
  }));
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe("start-logic", () => {
  it("prices a row, a path and an unpriced item from the catalog only", () => {
    expect(logic.priceLabelFor(CATALOG[4])).toBe("$9/mo");
    expect(logic.priceLabelFor(CATALOG[6])).toBe("$300 once");
    expect(logic.priceLabelFor(CATALOG[5])).toBe("Price coming soon");
    expect(logic.priceLabelFor(undefined)).toBe("Price coming soon");
    expect(logic.pathPriceLine(CATALOG, "standard")).toBe(
      "$1,500 build, then $39 a month",
    );
    expect(logic.pathPriceLine(null, "standard")).toBeNull();
  });

  it("words removed add-ons, sections, steps and roving keys", () => {
    expect(logic.removedMessage(["Appointments"], "Studio")).toBe(
      "Appointments isn't part of the Studio path, so we took it off your quote.",
    );
    expect(logic.removedMessage(["A", "B"], "Studio")).toBe(
      "A and B aren't part of the Studio path, so we took them off your quote.",
    );
    expect(logic.removedMessage([], "Studio")).toBeNull();
    expect(logic.sectionVisibility({ path: "", businessType: "" })).toEqual({
      business: false,
      addons: false,
    });
    expect(
      logic.sectionVisibility({ path: "studio", businessType: "barber" }),
    ).toEqual({ business: true, addons: true });
    expect(logic.currentStep({ path: "studio", businessType: "" })).toBe(2);
    expect(logic.rovingIndex(0, "ArrowRight", 3)).toBe(1);
    expect(logic.rovingIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(logic.rovingIndex(2, "ArrowDown", 3)).toBe(0);
    expect(logic.rovingIndex(1, "Home", 3)).toBe(0);
    expect(logic.rovingIndex(1, "a", 3)).toBeNull();
  });
});

describe("Configurator", () => {
  it("first load: H1, two path cards with catalog prices, the Shop line, no Section 2", () => {
    const el = render();
    expect(el.querySelector("h1")?.textContent).toBe("Build your website");
    const cards = radios(el, "start-path-title");
    expect(cards.map((c) => c.dataset.value)).toEqual(["standard", "studio"]);
    expect(cards[0]!.textContent).toContain("$1,500 build, then $39 a month");
    expect(cards[1]!.textContent).toContain("$3,500 build, then $49 a month");
    expect(el.textContent).toContain(
      "Selling products online first? A Shop plan is coming soon.",
    );
    expect(heading(el, "What kind of business?")).toBeUndefined();
    expect(el.querySelectorAll("main")).toHaveLength(1);
    const nav = el.querySelector('nav[aria-label="Quote steps"]')!;
    expect(nav.querySelector('[aria-current="step"]')?.textContent).toBe(
      "Your path",
    );
    expect(el.innerHTML).not.toMatch(/[✓✗→]/);
  });

  it("choosing Studio saves the path and reveals the Studio business types, focusing the heading", async () => {
    const el = render();
    click(radio(el, "studio"));
    expect(action.chooseQuoteAction).toHaveBeenCalledWith({ path: "studio" });
    const h = heading(el, "What kind of business?")!;
    expect(h).toBeDefined();
    expect(document.activeElement).toBe(h);
    expect(radio(el, "studio").getAttribute("aria-checked")).toBe("true");
    const chips = radios(el, "start-business-title").map(
      (c) => c.dataset.value,
    );
    expect(chips).toContain("hair-salon");
    expect(chips).not.toContain("therapist");
    expect(chips[chips.length - 1]).toBe("other");
    await flush();
  });

  it("a reviewed-first type shows the review note at pick", async () => {
    const el = render(quote({ path: "studio" }));
    expect(el.textContent).not.toContain(logic.REVIEWED_NOTE);
    click(radio(el, "med-spa"));
    expect(el.textContent).toContain(logic.REVIEWED_NOTE);
    expect(action.chooseQuoteAction).toHaveBeenCalledWith({
      businessType: "med-spa",
    });
    await flush();
  });

  it("Something else reveals a required 80-character text field and saves it debounced", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const el2 = render(quote());
    click(radio(el2, "other"));
    const input = el2.querySelector(
      "#start-business-other",
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.maxLength).toBe(80);
    expect(input.required).toBe(true);
    expect(
      el2.querySelector('label[for="start-business-other"]')?.textContent,
    ).toContain("Describe your business in a few words");
    expect(action.chooseQuoteAction).not.toHaveBeenCalled();
    typeInto(input, "Candle maker");
    act(() => vi.advanceTimersByTime(500));
    expect(action.chooseQuoteAction).toHaveBeenCalledWith({
      businessType: "other",
      businessTypeOther: "Candle maker",
    });
    vi.useRealTimers();
    await flush();
  });

  it("B-WR-06: Something else with no text clears the stored type; clearing the text does too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const el = render(quote({ businessType: "therapist" }));
    click(radio(el, "other"));
    expect(action.chooseQuoteAction).toHaveBeenCalledWith({
      businessType: "",
    });
    await settle();
    action.chooseQuoteAction.mockClear();
    const input = el.querySelector("#start-business-other") as HTMLInputElement;
    typeInto(input, "Candle maker");
    act(() => vi.advanceTimersByTime(500));
    expect(action.chooseQuoteAction).toHaveBeenCalledWith({
      businessType: "other",
      businessTypeOther: "Candle maker",
    });
    await settle();
    action.chooseQuoteAction.mockClear();
    typeInto(input, "");
    expect(action.chooseQuoteAction).toHaveBeenCalledWith({
      businessType: "",
    });
    // Nothing stale fires later.
    act(() => vi.advanceTimersByTime(500));
    expect(action.chooseQuoteAction).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    await flush();
  });

  it("Section 3: Recommended for the type's plural first, then See all add-ons (N) toggles the rest", async () => {
    const el = render(quote({ businessType: "therapist" }));
    const h = heading(el, "Recommended for")!;
    expect(h.textContent).toBe("Recommended for therapists");
    expect(checkbox(el, "testimonials")).not.toBeNull();
    expect(checkbox(el, "credentials")).not.toBeNull();
    expect(checkbox(el, "fixture-appointments")).toBeNull();
    const seeAll = button(el, "See all add-ons (1)")!;
    expect(seeAll.getAttribute("aria-expanded")).toBe("false");
    click(seeAll);
    expect(seeAll.getAttribute("aria-expanded")).toBe("true");
    expect(checkbox(el, "fixture-appointments")).not.toBeNull();
    expect(heading(el, "Want help with any of these?")).toBeDefined();
    expect(el.textContent).toContain("$300 once");
    await flush();
  });

  it("nothing recommended: the UI-SPEC copy shows and See all starts expanded", () => {
    const el = render(
      quote({ businessType: "other", businessTypeOther: "Candles" }),
    );
    expect(el.textContent).toContain(logic.NOTHING_RECOMMENDED);
    const seeAll = button(el, /^See all add-ons/)!;
    expect(seeAll.getAttribute("aria-expanded")).toBe("true");
    expect(checkbox(el, "testimonials")).not.toBeNull();
    expect(
      (el.querySelector("#start-business-other") as HTMLInputElement).value,
    ).toBe("Candles");
  });

  it("unpriced rows say Price coming soon; a tick saves the selections after 500 ms", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const el = render(quote({ businessType: "therapist" }));
    const credRow = checkbox(el, "credentials")!.closest("label")!;
    expect(credRow.textContent).toContain("Price coming soon");
    expect(
      checkbox(el, "testimonials")!.closest("label")!.textContent,
    ).toContain("$9/mo");
    click(checkbox(el, "testimonials"));
    expect(checkbox(el, "testimonials")!.checked).toBe(true);
    act(() => vi.advanceTimersByTime(499));
    expect(action.chooseQuoteAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(action.chooseQuoteAction).toHaveBeenCalledWith({
      selections: { ...SELECTIONS, addons: ["testimonials"] },
    });
    vi.useRealTimers();
    await flush();
  });

  it("a path change that drops an add-on says so, by the add-on's name", async () => {
    action.chooseQuoteAction.mockResolvedValueOnce({
      quote: quote({ path: "studio" }),
      removed: ["fixture-appointments"],
      error: null,
    });
    const el = render(
      quote({
        businessType: "other",
        businessTypeOther: "Candles",
        selections: { ...SELECTIONS, addons: ["fixture-appointments"] },
      }),
    );
    expect(checkbox(el, "fixture-appointments")!.checked).toBe(true);
    click(radio(el, "studio"));
    await flush();
    expect(el.textContent).toContain(
      "Appointments isn't part of the Studio path, so we took it off your quote.",
    );
    expect(checkbox(el, "fixture-appointments")).toBeNull();
    expect(action.chooseQuoteAction).toHaveBeenCalledWith({
      path: "studio",
      selections: { ...SELECTIONS, addons: ["fixture-appointments"] },
    });
  });

  it("shows the action's error copy at the top of the flow and keeps the choice", async () => {
    action.chooseQuoteAction.mockResolvedValueOnce({
      quote: null,
      removed: [],
      error:
        "We couldn't save your latest choice. Check your connection; we'll try again with your next change.",
    });
    const el = render();
    click(radio(el, "standard"));
    await flush();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      "We couldn't save your latest choice.",
    );
    expect(radio(el, "standard").getAttribute("aria-checked")).toBe("true");
  });

  it("HostingFaq lists every AUP category under the two headings", () => {
    const el = render();
    const details = el.querySelector("details#hosting-faq")!;
    expect(details.querySelector("summary")?.textContent).toBe(
      "Can my site be hosted here?",
    );
    const text = details.textContent ?? "";
    expect(text).toContain(
      "Most businesses are welcome. We don't host sites for:",
    );
    expect(text).toContain(
      "We welcome these, but review them before we build:",
    );
    expect(text).toContain("Gambling: online casinos, betting, lotteries");
    for (const c of AUP_CATEGORIES) expect(text).toContain(`${c.name}: `);
    expect(details.querySelectorAll("li")).toHaveLength(AUP_CATEGORIES.length);
  });

  it("radiogroups use roving tabindex: arrows move focus, one tab stop", () => {
    const el = render(quote({ businessType: "coach" }));
    const cards = radios(el, "start-path-title");
    expect(cards.map((c) => c.tabIndex)).toEqual([0, -1]);
    cards[0]!.focus();
    key(cards[0]!, "ArrowRight");
    expect(document.activeElement).toBe(cards[1]);
    key(cards[1]!, "ArrowLeft");
    expect(document.activeElement).toBe(cards[0]);
    const chips = radios(el, "start-business-title");
    expect(chips.filter((c) => c.tabIndex === 0)).toHaveLength(1);
    const coach = chips.find((c) => c.dataset.value === "coach")!;
    expect(coach.getAttribute("aria-checked")).toBe("true");
    expect(coach.tabIndex).toBe(0);
    coach.focus();
    key(coach, "ArrowRight");
    expect(document.activeElement).toBe(chips[chips.indexOf(coach) + 1]);
    expect(action.chooseQuoteAction).not.toHaveBeenCalled();
  });

  it("a restored quote shows every chosen section with its choices", () => {
    const el = render(
      quote({
        path: "standard",
        businessType: "therapist",
        selections: {
          ...SELECTIONS,
          addons: ["testimonials"],
          extras: ["copywriting"],
        },
      }),
    );
    expect(radio(el, "standard").getAttribute("aria-checked")).toBe("true");
    expect(radio(el, "therapist").getAttribute("aria-checked")).toBe("true");
    expect(checkbox(el, "testimonials")!.checked).toBe(true);
    expect(checkbox(el, "copywriting")!.checked).toBe(true);
    const nav = el.querySelector('nav[aria-label="Quote steps"]')!;
    expect(nav.querySelector('[aria-current="step"]')?.textContent).toBe(
      "Add-ons",
    );
    // Restoring never moves focus.
    expect(document.activeElement).toBe(document.body);
  });
});

describe("Configurator preselect (15-21, HUB-02)", () => {
  function renderPre(
    preselect: {
      path: "standard" | "studio" | null;
      addon: { slug: string; name: string } | null;
    },
    initialQuote: ReturnType<typeof quote> | null = null,
  ) {
    mounted = mount(
      <Configurator
        initialQuote={initialQuote}
        catalog={CATALOG}
        addons={ADDONS}
        paths={PATHS}
        extras={EXTRAS}
        preselect={preselect}
      />,
    );
    return mounted.container;
  }
  const current = (el: ParentNode) =>
    el
      .querySelector('nav[aria-label="Quote steps"]')
      ?.querySelector('[aria-current="step"]')?.textContent;
  const INFO =
    "We added Testimonials from the add-ons page. Untick it if you don't need it.";

  it("path=studio opens with Studio chosen and step 2 Your business current, saving nothing on mount (WR-A01)", async () => {
    const el = renderPre({ path: "studio", addon: null });
    expect(radio(el, "studio").getAttribute("aria-checked")).toBe("true");
    expect(current(el)).toBe("Your business");
    expect(heading(el, "What kind of business?")).toBeDefined();
    await flush();
    // A page view alone creates no quote and no cookie.
    expect(action.chooseQuoteAction).not.toHaveBeenCalled();
    // The first real choice carries the preselected path.
    click(radio(el, "barber"));
    expect(action.chooseQuoteAction).toHaveBeenCalledTimes(1);
    expect(action.chooseQuoteAction).toHaveBeenCalledWith({
      path: "studio",
      businessType: "barber",
    });
    await flush();
  });

  it("a preselected add-on is ticked, saved with the path on the first choice, and the info line shows", async () => {
    const el = renderPre({
      path: "standard",
      addon: { slug: "testimonials", name: "Testimonials" },
    });
    await flush();
    expect(action.chooseQuoteAction).not.toHaveBeenCalled();
    expect(el.textContent).not.toContain(INFO);
    click(radio(el, "therapist"));
    expect(action.chooseQuoteAction).toHaveBeenCalledWith({
      path: "standard",
      selections: { ...SELECTIONS, addons: ["testimonials"] },
      businessType: "therapist",
    });
    expect(checkbox(el, "testimonials")!.checked).toBe(true);
    const info = Array.from(el.querySelectorAll("#start-addons *")).find(
      (n) => n.textContent === INFO,
    );
    expect(info).toBeDefined();
    await flush();
  });

  it("CR-A01: a path-less add-on (catalog path both) saves nothing and shows no error until a path is picked", async () => {
    const el = renderPre({
      path: null,
      addon: { slug: "testimonials", name: "Testimonials" },
    });
    await flush();
    expect(action.chooseQuoteAction).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(current(el)).toBe("Your path");
    click(radio(el, "standard"));
    expect(action.chooseQuoteAction).toHaveBeenCalledTimes(1);
    expect(action.chooseQuoteAction).toHaveBeenCalledWith({
      path: "standard",
      selections: { ...SELECTIONS, addons: ["testimonials"] },
    });
    await flush();
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it("a failed first save keeps the preselected path for the next change", async () => {
    action.chooseQuoteAction.mockResolvedValueOnce({
      quote: null,
      removed: [],
      error: "We couldn't save your latest choice.",
    });
    const el = renderPre({ path: "studio", addon: null });
    await flush();
    click(radio(el, "barber"));
    await flush();
    click(radio(el, "hair-salon"));
    expect(action.chooseQuoteAction).toHaveBeenLastCalledWith({
      path: "studio",
      businessType: "hair-salon",
    });
    await flush();
  });

  it("a stored quote that has a path ignores the preselect", async () => {
    const el = renderPre(
      { path: "studio", addon: { slug: "testimonials", name: "Testimonials" } },
      quote({ path: "standard", businessType: "therapist" }),
    );
    expect(radio(el, "standard").getAttribute("aria-checked")).toBe("true");
    expect(checkbox(el, "testimonials")!.checked).toBe(false);
    expect(el.textContent).not.toContain(INFO);
    expect(action.chooseQuoteAction).not.toHaveBeenCalled();
    await flush();
  });
});
