// @vitest-environment jsdom
// CostCalculator in a real DOM (15-12; 15-UI-SPEC "Calculator"; HUB-06, D296). No `$`+digit literal here
// (tests/marketing-boundary.test.ts rule e): typed money is built from D = "$" and expected figures
// with calcMoney / calcRange.
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALC_DEFAULTS,
  CALC_ERR_SALES,
  CLAIMS,
  MK_COPY,
  calcLiveLineNoPlan,
  compareCosts,
  visibleClaims,
} from "@cds/core/marketing";
import { PRICE_SOON } from "@cds/core/pricing";
import { mount, typeInto, type Mounted } from "../test-support/dom";
import { calcAnchors, calcMoney, calcRange } from "./CalculatorStatic";
import { CALC_LIVE_DEBOUNCE_MS, CostCalculator } from "./CostCalculator";

const D = "$";
const DEV = visibleClaims(CLAIMS, false);
const PLAN = { standard: 3900, studio: 7900 };

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

function setup(
  claims = DEV,
  plan: { standard: number | null; studio: number | null } = PLAN,
) {
  mounted = mount(
    <CostCalculator
      claims={claims}
      planMonthlyCents={plan}
      initialPath="standard"
    />,
  );
  return mounted.container;
}

/** React's onBlur listens to focusout. */
const blur = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
const input = (root: ParentNode, id: string) =>
  root.querySelector<HTMLInputElement>(`#${id}`)!;
const line = (root: ParentNode, key: string) =>
  Array.from(root.querySelectorAll(`[data-calc-line="${key}"]`)).map(
    (el) => el.textContent ?? "",
  );
const result = (sales: number, avg: number, clients: number, plan: number) =>
  compareCosts({
    salesCents: sales,
    avgCents: avg,
    appClients: clients,
    planMonthlyCents: plan,
    claims: DEV,
  });

describe("CostCalculator", () => {
  it("renders the defaults with Platform cut directly above the gateway fees line", () => {
    const root = setup();
    const r = result(
      CALC_DEFAULTS.salesCents,
      CALC_DEFAULTS.avgCents,
      0,
      PLAN.standard,
    );
    expect(root.textContent).toContain(MK_COPY.CALC.H2);
    expect(line(root, "processing")[0]).toContain(
      calcRange(r.elsewhere.processing),
    );
    expect(line(root, "marketplace")).toHaveLength(0);
    const keys = Array.from(root.querySelectorAll("[data-calc-line]")).map(
      (el) => el.getAttribute("data-calc-line"),
    );
    expect(keys[keys.indexOf("cut") + 1]).toBe("gateway");
    expect(line(root, "cut")[0]).toContain(calcMoney(0));
    expect(line(root, "plan")[0]).toContain(calcMoney(PLAN.standard));
    expect(root.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(
      root.querySelectorAll('[aria-hidden="true"] [data-calc-bar]'),
    ).toHaveLength(2);
  });

  it(`typing "${D}5,000"-style money recomputes`, () => {
    const root = setup();
    typeInto(input(root, "calc-sales"), `${D}12,000`);
    const r = result(1200000, CALC_DEFAULTS.avgCents, 0, PLAN.standard);
    expect(line(root, "processing")[0]).toContain(
      calcRange(r.elsewhere.processing),
    );
    expect(line(root, "gateway")[0]).toContain(calcMoney(r.cds.gatewayCents));
  });

  it("invalid input shows the error on blur and keeps the previous totals", () => {
    const root = setup();
    typeInto(input(root, "calc-sales"), `${D}5,000`);
    const before = line(root, "keeps");
    typeInto(input(root, "calc-sales"), "abc");
    blur(input(root, "calc-sales"));
    expect(root.textContent).toContain(CALC_ERR_SALES);
    expect(input(root, "calc-sales").getAttribute("aria-invalid")).toBe("true");
    expect(line(root, "keeps")).toEqual(before);
    typeInto(input(root, "calc-sales"), "6000");
    expect(root.textContent).not.toContain(CALC_ERR_SALES);
  });

  it("a partial keystroke never flashes the error; blur shows and announces it (WR-C02)", () => {
    const root = setup();
    const sales = input(root, "calc-sales");
    const errLive = root.querySelector("[data-calc-error-live]")!;
    expect(errLive.getAttribute("aria-live")).toBe("polite");
    for (const partial of [D, "5000.", `${D}5000.`]) {
      typeInto(sales, partial);
      expect(root.textContent).not.toContain(CALC_ERR_SALES);
      expect(sales.getAttribute("aria-invalid")).toBeNull();
    }
    typeInto(sales, "5000.50");
    expect(root.textContent).not.toContain(CALC_ERR_SALES);
    typeInto(sales, "2000000");
    expect(root.textContent).not.toContain(CALC_ERR_SALES);
    expect(errLive.textContent).toBe("");
    blur(sales);
    expect(sales.getAttribute("aria-invalid")).toBe("true");
    expect(errLive.textContent).toBe(CALC_ERR_SALES);
    typeInto(sales, "6000");
    expect(sales.getAttribute("aria-invalid")).toBeNull();
    expect(errLive.textContent).toBe("");
  });

  it("app clients > 0 adds the marketplace line", () => {
    const root = setup();
    typeInto(input(root, "calc-clients"), "4");
    const r = result(
      CALC_DEFAULTS.salesCents,
      CALC_DEFAULTS.avgCents,
      4,
      PLAN.standard,
    );
    expect(line(root, "marketplace")[0]).toContain(
      calcRange(r.elsewhere.marketplace!),
    );
    expect(root.textContent).toContain(MK_COPY.CALC.MARKETPLACE);
  });

  it("switching path changes the plan line", () => {
    const root = setup();
    const studio = input(root, "calc-path-studio");
    act(() => studio.click());
    expect(line(root, "plan")[0]).toContain(calcMoney(PLAN.studio));
  });

  it("announces totals in the polite live region after the debounce", () => {
    vi.useFakeTimers();
    const root = setup();
    const live = root.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("");
    typeInto(input(root, "calc-sales"), "10000");
    expect(live.textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(CALC_LIVE_DEBOUNCE_MS);
    });
    const r = result(1000000, CALC_DEFAULTS.avgCents, 0, PLAN.standard);
    expect(live.textContent).toContain(calcRange(r.elsewhere.total));
    // WR-B08: the CDS total is what the owner pays: Stripe fees plus the plan.
    expect(r.cds.total).toBe(r.cds.gatewayCents + PLAN.standard);
    expect(live.textContent).toContain(calcMoney(r.cds.total!));
    expect(live.textContent).toContain("you pay");
    expect(live.textContent).not.toContain("platform keeps");
  });

  it("an unpriced plan is announced as coming soon and never drawn as an empty CDS bar (WR-C01)", () => {
    vi.useFakeTimers();
    const root = setup(DEV, { standard: null, studio: null });
    expect(line(root, "plan")[0]).toContain(PRICE_SOON);
    expect(line(root, "keeps")[1]).toContain(PRICE_SOON);
    expect(root.querySelector('[data-calc-bar="cds"]')).toBeNull();
    expect(root.querySelector('[data-calc-bar="elsewhere"]')).not.toBeNull();
    const live = root.querySelector('[aria-live="polite"]')!;
    typeInto(input(root, "calc-sales"), "10000");
    act(() => {
      vi.advanceTimersByTime(CALC_LIVE_DEBOUNCE_MS);
    });
    const r = compareCosts({
      salesCents: 1000000,
      avgCents: CALC_DEFAULTS.avgCents,
      appClients: 0,
      planMonthlyCents: null,
      claims: DEV,
    });
    expect(live.textContent).toBe(
      calcLiveLineNoPlan(calcRange(r.elsewhere.total)),
    );
    expect(live.textContent).not.toContain(PRICE_SOON);
  });

  it("server HTML has no calculator-only ref anchors; they appear once mounted (WR-C06)", () => {
    const ssr = renderToStaticMarkup(
      <CostCalculator
        claims={DEV}
        planMonthlyCents={PLAN}
        initialPath="standard"
      />,
    );
    expect(ssr).not.toContain('id="ref-');
    const root = setup();
    for (const id of calcAnchors(DEV))
      expect(root.querySelector(`#ref-${id}`)).not.toBeNull();
  });

  it("renders nothing when the stripe claim is missing", () => {
    const root = setup(DEV.filter((c) => c.id !== "stripe-online"));
    expect(root.innerHTML).toBe("");
  });
});
