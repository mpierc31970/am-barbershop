// @vitest-environment jsdom
// P10 hub primitives (10-05; 10-UI-SPEC "Design System", status tone map, a11y):
// SegmentedControl (extracted from the /start receipt), the billing Badge tones and the
// UsageMeter label.
import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mount, type Mounted } from "../test-support/dom";
import { Badge, type BadgeTone } from "./Badge";
import { SegmentedControl } from "./SegmentedControl";
import { UsageMeter } from "./UsageMeter";
import type { UsageView } from "./media/copy";
import * as hub from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

type Cadence = "monthly" | "yearly";
const OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly, 2 months free" },
] as const;

// The pre-extraction BillingControl's classes (Receipt.tsx before 10-05).
const SELECTED =
  "min-h-9 rounded-sm px-2 text-sm transition-colors duration-150 pointer-coarse:min-h-11 " +
  "border border-hub-ink bg-hub-surface font-semibold text-hub-ink";
const UNSELECTED =
  "min-h-9 rounded-sm px-2 text-sm transition-colors duration-150 pointer-coarse:min-h-11 " +
  "border border-transparent text-hub-ink-muted hover:text-hub-ink";

function Harness({
  disabled,
  spy,
}: {
  disabled?: boolean;
  spy: (v: Cadence) => void;
}) {
  const [v, setV] = useState<Cadence>("monthly");
  return (
    <SegmentedControl<Cadence>
      name="cadence"
      label="Billing"
      options={OPTIONS}
      value={v}
      disabled={disabled}
      onChange={(next) => {
        spy(next);
        setV(next);
      }}
    />
  );
}

const radios = (el: ParentNode) =>
  Array.from(el.querySelectorAll('[role="radio"]')) as HTMLElement[];

function key(el: HTMLElement, k: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}

describe("SegmentedControl", () => {
  it("is exported from @cds/ui/hub", () => {
    expect(hub.SegmentedControl).toBe(SegmentedControl);
  });

  it("renders a labelled radiogroup with roving tabIndex", () => {
    mounted = mount(<Harness spy={vi.fn()} />);
    const group = mounted.container.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe("Billing");
    const [m, y] = radios(mounted.container);
    expect(m!.getAttribute("aria-checked")).toBe("true");
    expect(y!.getAttribute("aria-checked")).toBe("false");
    expect(m!.tabIndex).toBe(0);
    expect(y!.tabIndex).toBe(-1);
    expect(y!.textContent).toBe("Yearly, 2 months free");
  });

  it("keeps the pre-extraction classes (no visual change)", () => {
    mounted = mount(<Harness spy={vi.fn()} />);
    const group = mounted.container.querySelector('[role="radiogroup"]')!;
    expect(group.className).toBe(
      "grid grid-cols-2 gap-1 rounded border border-hub-border-strong p-0.5",
    );
    const [m, y] = radios(mounted.container);
    expect(m!.className).toBe(SELECTED);
    expect(y!.className).toBe(UNSELECTED);
    expect(group.className).not.toMatch(/accent/);
  });

  it("uses aria-labelledby when given a visible label id", () => {
    mounted = mount(
      <SegmentedControl
        name="c"
        label="Billing"
        labelledBy="x-billing"
        options={OPTIONS}
        value="monthly"
        onChange={() => {}}
      />,
    );
    const group = mounted.container.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-labelledby")).toBe("x-billing");
    expect(group.hasAttribute("aria-label")).toBe(false);
  });

  it("arrow keys move selection and focus and call onChange", () => {
    const spy = vi.fn();
    mounted = mount(<Harness spy={spy} />);
    const [m] = radios(mounted.container);
    key(m!, "ArrowRight");
    expect(spy).toHaveBeenLastCalledWith("yearly");
    const [, y] = radios(mounted.container);
    expect(y!.getAttribute("aria-checked")).toBe("true");
    expect(y!.tabIndex).toBe(0);
    expect(document.activeElement).toBe(y);
    key(y!, "ArrowLeft");
    expect(spy).toHaveBeenLastCalledWith("monthly");
    expect(document.activeElement).toBe(radios(mounted.container)[0]);
  });

  it("click selects", () => {
    const spy = vi.fn();
    mounted = mount(<Harness spy={spy} />);
    click(radios(mounted.container)[1]);
    expect(spy).toHaveBeenCalledWith("yearly");
  });

  it("disabled blocks clicks and arrow keys", () => {
    const spy = vi.fn();
    mounted = mount(<Harness spy={spy} disabled />);
    const [m, y] = radios(mounted.container);
    click(y);
    key(m!, "ArrowRight");
    expect(spy).not.toHaveBeenCalled();
    expect(m!.getAttribute("aria-checked")).toBe("true");
  });
});

const P10_TONES: [BadgeTone, string, boolean][] = [
  ["paused", "Paused", true],
  ["paid", "Paid", false],
  ["due", "Due", false],
  ["unpaid", "Unpaid", true],
  ["refunded", "Refunded", false],
  ["void", "Cancelled", false],
  ["connected", "Connected", false],
  ["not-connected", "Not connected", false],
  ["stripe-attention", "Needs attention", true],
  ["quote-waiting", "Waiting for you", false],
];

describe("Badge P10 tones", () => {
  it.each(P10_TONES)("%s renders its word (icon: %s)", (tone, word, icon) => {
    mounted = mount(<Badge tone={tone}>{word}</Badge>);
    const span = mounted.container.firstElementChild as HTMLElement;
    expect(span.textContent).toBe(word);
    const svg = span.querySelector("svg");
    if (icon) {
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
    } else {
      expect(svg).toBeNull();
    }
  });

  it("paused is warning, never danger (D-UI-P10-12)", () => {
    mounted = mount(<Badge tone="paused">Paused</Badge>);
    const cls = (mounted.container.firstElementChild as HTMLElement).className;
    expect(cls).toContain("bg-hub-warning-tint text-hub-warning");
    expect(cls).not.toMatch(/danger/);
  });

  it("maps tones to the UI-SPEC colours, never accent", () => {
    const cls = (tone: BadgeTone) => {
      mounted?.unmount();
      mounted = mount(<Badge tone={tone}>x</Badge>);
      return (mounted.container.firstElementChild as HTMLElement).className;
    };
    expect(cls("paid")).toContain("bg-hub-success-tint text-hub-success");
    expect(cls("connected")).toContain("bg-hub-success-tint text-hub-success");
    expect(cls("unpaid")).toContain("bg-hub-danger-tint text-hub-danger");
    expect(cls("stripe-attention")).toContain(
      "bg-hub-warning-tint text-hub-warning",
    );
    for (const t of ["refunded", "void", "not-connected"] as const) {
      expect(cls(t)).toContain("bg-hub-surface-2 text-hub-ink-muted");
    }
    for (const [t] of P10_TONES) expect(cls(t)).not.toMatch(/accent/);
  });
});

function usage(): UsageView {
  return {
    usedBytes: 1.2 * 1024 ** 3,
    allowanceBytes: 2 * 1024 ** 3,
    ratio: 0.6,
    level: "ok",
    label: "1.2 GB of 2 GB used",
    message: "",
  };
}

describe("UsageMeter label", () => {
  it("defaults to the media label with unchanged output", () => {
    mounted = mount(<UsageMeter usage={usage()} />);
    const meter = mounted.container.querySelector('[role="meter"]')!;
    expect(meter.getAttribute("aria-label")).toBe("Media storage used");
    expect(meter.className).toBe(
      "h-1 w-full overflow-hidden rounded-full bg-hub-border",
    );
    expect(mounted.container.textContent).toBe("1.2 GB of 2 GB used");
    expect(
      mounted.container.querySelector("[data-usage-fill]")?.className,
    ).toBe("h-full bg-hub-ink");
  });

  it("takes a label for Care Plan minutes", () => {
    mounted = mount(
      <UsageMeter usage={usage()} label="Care Plan minutes used" />,
    );
    const meter = mounted.container.querySelector('[role="meter"]')!;
    expect(meter.getAttribute("aria-label")).toBe("Care Plan minutes used");
  });
});

// P12 tones (12-06 choice 5; 12-UI-SPEC line 74).
const P12_TONES: [BadgeTone, string, string, boolean][] = [
  ["t-open", "Open", "bg-hub-surface-2 text-hub-ink", false],
  ["t-progress", "In progress", "bg-hub-surface-2 text-hub-ink", false],
  [
    "t-waiting",
    "Waiting on you",
    "bg-hub-warning-tint text-hub-warning",
    false,
  ],
  ["t-resolved", "Resolved", "bg-hub-success-tint text-hub-success", false],
  ["t-closed", "Closed", "bg-hub-surface-2 text-hub-ink-muted", false],
  ["i-suggested", "Suggested", "bg-hub-surface-2 text-hub-ink", false],
  ["i-considering", "Considering", "bg-hub-surface-2 text-hub-ink", false],
  [
    "i-planned",
    "Planned",
    "border border-hub-border-strong bg-hub-surface",
    false,
  ],
  ["i-built", "Built", "bg-hub-success-tint text-hub-success", false],
  ["inc-open", "Being fixed", "bg-hub-surface-2 text-hub-ink", false],
  ["inc-resolved", "Fixed", "bg-hub-success-tint text-hub-success", false],
  ["checking", "Checking file", "bg-hub-surface-2 text-hub-ink-muted", true],
];

describe("Badge P12 tones", () => {
  it.each(P12_TONES)(
    "%s renders %s on its UI-SPEC colours",
    (tone, word, colours, icon) => {
      mounted = mount(<Badge tone={tone}>{word}</Badge>);
      const span = mounted.container.firstElementChild as HTMLElement;
      expect(span.textContent).toBe(word);
      expect(span.className).toContain(colours);
      // Identity is never a badge; status is never accent.
      expect(span.className).not.toMatch(/cds-|accent/);
      const svg = span.querySelector("svg");
      if (icon) {
        expect(svg!.getAttribute("aria-hidden")).toBe("true");
        expect(svg!.getAttribute("width")).toBe("14");
      } else {
        expect(svg).toBeNull();
      }
    },
  );
});
