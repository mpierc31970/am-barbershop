// @vitest-environment jsdom
// P10 checkout presentational pieces (10-08; 10-UI-SPEC "Checkout", copy table, a11y):
// CheckoutSummary (receipt rail), BuildFeeChoice (D181) and TestModeStrip (D-UI-P10-8).
import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../test-support/dom";
import { BuildFeeChoice } from "./BuildFeeChoice";
import { CheckoutSummary } from "./CheckoutSummary";
import { TestModeStrip } from "./TestModeStrip";
import type {
  BuildFeeOption,
  BuildFeeValue,
  CheckoutSummaryView,
} from "./types";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

const view = (
  over: Partial<CheckoutSummaryView> = {},
): CheckoutSummaryView => ({
  pathLabel: "Standard",
  today: [
    { label: "Website build", cents: 150000 },
    { label: "Standard plan, first month", cents: 3900 },
  ],
  dueTodayCents: 153900,
  then: [{ text: "$39 a month from 8 Nov" }],
  testMode: false,
  ...over,
});

const primary = <button type="button">Continue to payment</button>;

describe("CheckoutSummary", () => {
  it("renders the P6 receipt structure from props", () => {
    mounted = mount(
      <CheckoutSummary view={view()} primary={primary} liveText="" />,
    );
    const c = mounted.container;
    const aside = c.querySelector("aside")!;
    expect(aside.getAttribute("aria-labelledby")).toBe("order-title");
    expect(c.querySelector("#order-title")?.textContent).toBe("Your order");
    expect(c.textContent).toContain("Standard website");

    const items = [...c.querySelectorAll("section li")].map(
      (li) => li.textContent,
    );
    expect(items[0]).toContain("Website build");
    expect(items[0]).toContain("$1,500");
    expect(items[1]).toContain("Standard plan, first month");
    expect(items[1]).toContain("$39");

    expect(c.querySelector("hr.border-dashed")).not.toBeNull();

    const display = c.querySelector(".text-\\[1\\.75rem\\]");
    expect(display?.textContent).toBe("$1,539");
    expect(
      [...c.querySelectorAll(".sr-only")].some(
        (n) => n.textContent === "Due today, $1,539",
      ),
    ).toBe(true);
    expect(display?.closest("[aria-hidden='true']")).not.toBeNull();

    expect(c.textContent).toContain(
      "Plus sales tax, worked out on the payment page.",
    );
    expect(c.textContent).toContain("$39 a month from 8 Nov");
    expect(c.textContent).toContain(
      "Have a promotion code? Enter it on the payment page.",
    );
    expect(c.textContent).toContain(
      "You pay your own payment processor's fees. We take no cut.",
    );
    expect(c.querySelector("button")?.textContent).toBe("Continue to payment");
    expect(c.textContent).toContain(
      "You pay on Stripe's secure page. CDS never sees your card number.",
    );
    const lock = c.querySelector("svg.lucide-lock");
    expect(lock?.getAttribute("aria-hidden")).toBe("true");
  });

  it("uses tabular figures for every amount", () => {
    mounted = mount(
      <CheckoutSummary view={view()} primary={primary} liveText="" />,
    );
    const amounts = [...mounted.container.querySelectorAll("span")].filter(
      (s) => /^\$[\d,.]+$/.test(s.textContent ?? ""),
    );
    expect(amounts.length).toBe(3);
    for (const a of amounts) expect(a.className).toContain("tabular-nums");
  });

  it("uses the test-mode tax and secure lines", () => {
    mounted = mount(
      <CheckoutSummary
        view={view({ testMode: true })}
        primary={primary}
        liveText=""
      />,
    );
    const t = mounted.container.textContent ?? "";
    expect(t).toContain("Tax calculated at payment. Test mode charges none.");
    expect(t).toContain("You'll pay on a CDS test page. No card is needed.");
    expect(t).not.toContain("Stripe's secure page");
  });

  it("announces total changes politely after 1s of quiet", () => {
    vi.useFakeTimers();
    function Harness() {
      const [text, setText] = useState("Due today now $1,539.");
      (globalThis as { setLive?: (s: string) => void }).setLive = setText;
      return (
        <CheckoutSummary view={view()} primary={primary} liveText={text} />
      );
    }
    mounted = mount(<Harness />);
    const live = mounted.container.querySelector("[aria-live='polite']")!;
    expect(live.classList.contains("sr-only")).toBe(true);
    expect(live.textContent).toBe("");

    const setLive = (globalThis as { setLive?: (s: string) => void }).setLive!;
    act(() => setLive("Due today now $289. Then $289 a month."));
    act(() => vi.advanceTimersByTime(500));
    expect(live.textContent).toBe("");
    act(() => setLive("Due today now $250. Then $289 a month."));
    act(() => vi.advanceTimersByTime(999));
    expect(live.textContent).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(live.textContent).toBe("Due today now $250. Then $289 a month.");
  });
});

const OPTIONS: readonly BuildFeeOption[] = [
  {
    value: "full",
    title: "Pay in full",
    priceLine: "$1,500 today",
    detail: "One payment.",
  },
  {
    value: "installments",
    title: "6 monthly payments",
    priceLine: "6 × $250",
    detail:
      "No surcharge. The first is today and the rest come with your monthly bill. If you cancel your plan, the remaining build payments are still owed.",
  },
];

describe("BuildFeeChoice", () => {
  function Harness({ onChange }: { onChange?: (v: BuildFeeValue) => void }) {
    const [value, setValue] = useState<BuildFeeValue>("full");
    return (
      <BuildFeeChoice
        options={OPTIONS}
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
    );
  }

  it("is a native radio group with Pay in full first and checked", () => {
    mounted = mount(<Harness />);
    const c = mounted.container;
    expect(c.querySelector("fieldset legend")?.textContent).toBe(
      "How to pay for your build",
    );
    const radios = [
      ...c.querySelectorAll<HTMLInputElement>("input[type='radio']"),
    ];
    expect(radios.map((r) => r.value)).toEqual(["full", "installments"]);
    expect(radios[0]!.checked).toBe(true);
    expect(radios[1]!.checked).toBe(false);
    const label = radios[0]!.closest("label")!;
    expect(label.textContent).toContain("$1,500 today");
    expect(label.className).toContain("min-h-28");
    expect(label.querySelector("svg.lucide-check")).not.toBeNull();
    expect(c.textContent).toContain(
      "If you cancel your plan, the remaining build payments are still owed.",
    );
  });

  it("ArrowDown selects the next option", () => {
    const onChange = vi.fn();
    mounted = mount(<Harness onChange={onChange} />);
    const radios = [
      ...mounted.container.querySelectorAll<HTMLInputElement>(
        "input[type='radio']",
      ),
    ];
    act(() => {
      radios[0]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(onChange).toHaveBeenCalledWith("installments");
    expect(radios[1]!.checked).toBe(true);
    expect(document.activeElement).toBe(radios[1]);
  });

  it("disables every radio when disabled", () => {
    mounted = mount(
      <BuildFeeChoice
        options={OPTIONS}
        value="full"
        onChange={() => {}}
        disabled
      />,
    );
    expect(mounted.container.querySelector("fieldset")?.disabled).toBe(true);
  });
});

describe("TestModeStrip", () => {
  it("is an announced note with the warning icon", () => {
    mounted = mount(<TestModeStrip />);
    const note = mounted.container.querySelector("[role='note']")!;
    expect(note.textContent).toBe("Test payment page. No real money moves.");
    expect(note.className).toContain("h-10");
    const icon = note.querySelector("svg.lucide-triangle-alert");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });
});
