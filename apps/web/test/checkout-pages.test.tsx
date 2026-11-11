// @vitest-environment jsdom
// 10-22 Task 2: /hub/checkout and /hub/checkout/return (10-UI-SPEC "Checkout", "Checkout
// return"; AGR-02, BILL-01, BILL-10, BILL-11, BILL-15, BILL-19; D181, D299, D314,
// D-UI-P10-1..7). The session, @cds/db and the checkout actions are mocked; the RSC pages run
// for real and their output is mounted with the client islands.
import { ToastRegion } from "@cds/ui/hub";
import { act, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT:${to}`), {
      digest: `NEXT_REDIRECT;replace;${to};307;`,
    });
  },
  usePathname: () => "/hub/checkout",
  useRouter: () => ({
    push: nav.push,
    replace: nav.replace,
    refresh: nav.refresh,
  }),
  useSearchParams: () => nav.params,
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const OWNER = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  readCheckoutState: vi.fn(),
  checkoutOrderFor: vi.fn(),
  checkoutReturnStatus: vi.fn(),
  agreementStatus: vi.fn(),
  registerAddonCollections: vi.fn(),
  registerSectionAddonOwners: vi.fn(),
  registerAddonAlertTypes: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const actions = vi.hoisted(() => ({
  previewCheckoutAction: vi.fn(),
  startCheckoutAction: vi.fn(),
  checkoutStatusAction: vi.fn(),
}));
vi.mock("../app/actions/checkout", () => actions);

const { default: CheckoutPage } =
  await import("../app/(platform)/hub/checkout/page");
const { default: ReturnPage } =
  await import("../app/(platform)/hub/checkout/return/page");
const { buildOrderView } = await import("../lib/checkout-order");
const { ADDON_REGISTRY } = await import("@cds/addon-registry/server");

type Choices = {
  addons: string[];
  extras: string[];
  carePlan: boolean;
  cadence: "monthly" | "yearly";
  buildPlan: "full" | "installments";
};

const BASE: Choices = {
  addons: ["testimonials"],
  extras: [],
  carePlan: false,
  cadence: "monthly",
  buildPlan: "full",
};

/** A priced order like checkoutOrderFor's. Prices: plan $39, add-ons $9, extras below. */
function order(
  choices: Choices,
  opts: {
    unpricedAddon?: string;
    extraPrices?: Record<string, number | null>;
  } = {},
) {
  const prices = opts.extraPrices ?? {
    copywriting: 40000,
    "logo-design": 30000,
  };
  const addons = choices.addons.map((key) => ({
    kind: "addon",
    key,
    monthlyCents: key === opts.unpricedAddon ? null : 900,
    oneTimeCents: null,
  }));
  const extras = choices.extras.map((key) => ({
    kind: "extra",
    key,
    monthlyCents: null,
    oneTimeCents: prices[key] ?? null,
  }));
  const unpriced = [
    ...addons.filter((a) => a.monthlyCents === null).map((a) => a.key),
    ...extras.filter((e) => e.oneTimeCents === null).map((e) => e.key),
  ];
  const monthly =
    3900 +
    addons.reduce((n, a) => n + (a.monthlyCents ?? 0), 0) +
    (choices.carePlan ? 9900 : 0);
  const extrasCents = extras.reduce((n, e) => n + (e.oneTimeCents ?? 0), 0);
  const due = 150000 + extrasCents + monthly;
  return {
    choices,
    path: "standard" as const,
    totals: {
      path: "standard",
      cadence: choices.cadence,
      build: {
        cents: 150000,
        installments: 6,
        eachCents: 25000,
        lastCents: 25000,
      },
      plan: {
        kind: "plan",
        key: "base",
        monthlyCents: 3900,
        oneTimeCents: null,
      },
      addons,
      extras,
      carePlan: choices.carePlan
        ? {
            kind: "care_plan",
            key: "care",
            monthlyCents: 9900,
            oneTimeCents: null,
          }
        : null,
      monthlyCents: monthly,
      recurringFirstChargeCents: monthly,
      dueAtCheckoutCents: due,
      dueAtCheckoutWithInstallmentsCents: 25000 + extrasCents + monthly,
      firstYearCents: 0,
      unpricedCount: unpriced.length,
      unpriced,
    },
    summary:
      unpriced.length > 0
        ? null
        : {
            pathLabel: "Standard",
            today: [
              { label: "Website build", cents: 150000 },
              ...extras.map((e) => ({ label: e.key, cents: e.oneTimeCents! })),
              { label: "Standard plan, first month", cents: 3900 },
            ],
            dueTodayCents: due,
            then: [{ text: `$${monthly / 100} a month from 8 Nov` }],
            testMode: true,
          },
    carePlanMonthlyCents: 9900,
  };
}

function previewOk(choices: Choices, opts?: Parameters<typeof order>[1]) {
  const view = buildOrderView(
    order(choices, opts) as never,
    ADDON_REGISTRY.list(),
  );
  return {
    ok: true,
    data: { view, liveText: view.liveText, draft: view.choices },
  };
}

function sessionAs(ctx: Record<string, unknown>) {
  sess.requireHubSession.mockResolvedValue({
    ctx,
    email: "ana@example.com",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
}

const STATE = {
  stage: "ready_for_build",
  path: "standard",
  closed: false,
  paidAt: null,
  paymentsOpen: true,
  testMode: true,
};

let mounted: Mounted | null = null;

async function renderCheckout(sp: Record<string, string> = {}) {
  const el = (await CheckoutPage({
    searchParams: Promise.resolve(sp),
  })) as ReactElement;
  mounted = mount(<ToastRegion>{el}</ToastRegion>);
  return mounted.container;
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  const err = (await p.catch((e: unknown) => e)) as Error;
  return err.message;
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  for (const fn of Object.values(actions)) fn.mockReset();
  nav.push.mockReset();
  nav.replace.mockReset();
  nav.refresh.mockReset();
  nav.params = new URLSearchParams();
  sessionAs(OWNER);
  db.readCheckoutState.mockResolvedValue({ ...STATE });
  db.checkoutOrderFor.mockResolvedValue(order(BASE));
  db.agreementStatus.mockResolvedValue({
    state: "current",
    missing: [],
    consentCurrent: true,
    lastSignedAt: "2026-10-08T12:00:00.000Z",
    lastSignerName: "Ana Rivera",
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe("/hub/checkout: owner, signed, ready", () => {
  it("renders the full interactive order", async () => {
    const root = await renderCheckout();
    const text = root.textContent ?? "";
    expect(root.querySelector("h1")?.textContent).toBe(
      "Pay and start your build",
    );
    expect(text).toContain("Check your order, choose how to pay for the build");
    expect(text).toContain("Test mode: no real money moves.");
    expect(text).toContain("Your website build");
    const radios = Array.from(
      root.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    );
    expect(radios[0]!.value).toBe("full");
    expect(radios[0]!.checked).toBe(true);
    expect(text).toContain("$1,500 today");
    expect(text).toContain("6 × $250");
    expect(text).toContain("Standard plan");
    expect(button(root, "Remove Standard plan from your order")).toBeNull();
    expect(button(root, "Remove Testimonials from your order")).not.toBeNull();
    const care = root.querySelector<HTMLInputElement>("#care-plan");
    expect(care?.checked).toBe(false);
    expect(text).toContain("Add the Care Plan · $99/mo");
    expect(text).toContain("How often to pay");
    expect(root.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(text).toContain("Yearly, 2 months free");
    expect(button(root, "Continue to payment")).not.toBeNull();
    expect(text).toContain("$1,548");
    // No extras in the draft: no Extras group.
    expect(text).not.toContain("Extras");
  });

  it("Continue to payment posts the figure on screen and opens the payment URL", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    actions.startCheckoutAction.mockResolvedValue({
      ok: true,
      data: { url: "https://pay.example/s1" },
    });
    const root = await renderCheckout();
    click(button(root, "Continue to payment"));
    await flush();
    expect(actions.startCheckoutAction).toHaveBeenCalledWith({
      choices: BASE,
      expectedDueTodayCents: 154800,
    });
    expect(assign).toHaveBeenCalledWith("https://pay.example/s1");
    vi.unstubAllGlobals();
  });

  it("a price change re-prices in place with PRICE-CHANGED", async () => {
    actions.startCheckoutAction.mockResolvedValue({
      ok: true,
      data: { error: "price_changed" },
    });
    actions.previewCheckoutAction.mockResolvedValue(previewOk(BASE));
    const root = await renderCheckout();
    click(button(root, "Continue to payment"));
    await flush();
    expect(root.textContent).toContain("A price changed since you opened");
    expect(actions.previewCheckoutAction).toHaveBeenCalledTimes(1);
  });

  it("a session failure shows ERR-CHECKOUT and keeps the choices", async () => {
    actions.startCheckoutAction.mockResolvedValue({
      ok: true,
      data: { error: "failed" },
    });
    const root = await renderCheckout();
    click(button(root, "Continue to payment"));
    await flush();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      "We couldn't open the payment page",
    );
    expect(button(root, "Continue to payment")).not.toBeNull();
  });

  it("Remove an add-on: Undo toast, and the summary re-renders from the server", async () => {
    actions.previewCheckoutAction.mockImplementation(async (c: Choices) =>
      previewOk(c),
    );
    const root = await renderCheckout();
    click(button(root, "Remove Testimonials from your order"));
    await flush();
    expect(actions.previewCheckoutAction).toHaveBeenLastCalledWith({
      ...BASE,
      addons: [],
    });
    expect(root.ownerDocument.body.textContent).toContain(
      "Testimonials removed from your order.",
    );
    expect(button(root, "Remove Testimonials from your order")).toBeNull();
    expect(root.textContent).toContain("$1,539");
    const undo = button(root.ownerDocument.body, "Undo");
    click(undo);
    await flush();
    expect(actions.previewCheckoutAction).toHaveBeenLastCalledWith(BASE);
    expect(button(root, "Remove Testimonials from your order")).not.toBeNull();
  });

  it("an unpriced add-on shows UNPRICED and an aria-disabled primary with the reason", async () => {
    db.checkoutOrderFor.mockResolvedValue(
      order(BASE, { unpricedAddon: "testimonials" }),
    );
    const root = await renderCheckout();
    expect(root.textContent).toContain(
      "We're finalising this price; remove it to continue now",
    );
    expect(root.textContent).toContain("Price coming soon");
    const primary = button(root, "Continue to payment")!;
    expect(primary.getAttribute("aria-disabled")).toBe("true");
    const reason = root.querySelector(
      `#${primary.getAttribute("aria-describedby")}`,
    );
    expect(reason?.textContent).toBe(
      "Remove Testimonials to continue, or wait until its price is set.",
    );
    click(primary);
    await flush();
    expect(actions.startCheckoutAction).not.toHaveBeenCalled();
  });
});

describe("/hub/checkout: Extras", () => {
  const WITH_EXTRAS: Choices = {
    ...BASE,
    extras: ["copywriting", "logo-design"],
  };

  it("renders an Extras group after Your plan with one-time prices and Remove", async () => {
    db.checkoutOrderFor.mockResolvedValue(order(WITH_EXTRAS));
    const root = await renderCheckout();
    const h3 = Array.from(root.querySelectorAll("h3")).find(
      (h) => h.textContent === "Extras",
    );
    expect(h3).toBeDefined();
    const text = root.textContent ?? "";
    expect(text.indexOf("Your plan")).toBeLessThan(text.indexOf("Extras"));
    expect(text).toContain("Copywriting");
    expect(text).toContain("$400 once");
    expect(text).toContain("Logo design");
    expect(text).toContain("$300 once");
    expect(button(root, "Remove Copywriting from your order")).not.toBeNull();
    // The today lines carry each priced extra (server view).
    expect(text).toContain("copywriting");
  });

  it("Remove an extra: toast + server re-price without it; Undo puts it back", async () => {
    db.checkoutOrderFor.mockResolvedValue(order(WITH_EXTRAS));
    actions.previewCheckoutAction.mockImplementation(async (c: Choices) =>
      previewOk(c),
    );
    const root = await renderCheckout();
    click(button(root, "Remove Copywriting from your order"));
    await flush();
    expect(actions.previewCheckoutAction).toHaveBeenLastCalledWith({
      ...WITH_EXTRAS,
      extras: ["logo-design"],
    });
    expect(root.ownerDocument.body.textContent).toContain(
      "Copywriting removed from your order.",
    );
    expect(button(root, "Remove Copywriting from your order")).toBeNull();
    // The today lines lost the extra.
    expect(root.textContent).not.toContain("$400 once");
    click(button(root.ownerDocument.body, "Undo"));
    await flush();
    expect(actions.previewCheckoutAction).toHaveBeenLastCalledWith({
      ...WITH_EXTRAS,
      extras: ["logo-design", "copywriting"],
    });
    expect(button(root, "Remove Copywriting from your order")).not.toBeNull();
  });

  it("an unpriced extra shows UNPRICED and blocks the primary", async () => {
    db.checkoutOrderFor.mockResolvedValue(
      order(WITH_EXTRAS, {
        extraPrices: { copywriting: 40000, "logo-design": null },
      }),
    );
    const root = await renderCheckout();
    expect(root.textContent).toContain("We're finalising this price");
    const primary = button(root, "Continue to payment")!;
    expect(primary.getAttribute("aria-disabled")).toBe("true");
    expect(root.textContent).toContain(
      "Remove Logo design to continue, or wait until its price is set.",
    );
  });
});

describe("/hub/checkout: who sees what and blocked states", () => {
  it("unsigned owner: read-only with ERR-GATE and Review and sign", async () => {
    db.agreementStatus.mockResolvedValue({
      state: "unsigned",
      missing: [],
      consentCurrent: false,
      lastSignedAt: null,
      lastSignerName: null,
    });
    const root = await renderCheckout();
    expect(root.textContent).toContain(
      "Sign your agreement before you buy anything.",
    );
    const link = Array.from(root.querySelectorAll("a")).find(
      (a) => a.textContent === "Review and sign",
    );
    expect(link?.getAttribute("href")).toBe(
      "/hub/agreement?next=/hub/checkout",
    );
    expect(button(root, "Continue to payment")).toBeNull();
    expect(
      root
        .querySelector<HTMLInputElement>('input[type="radio"]')
        ?.closest("fieldset")?.disabled,
    ).toBe(true);
  });

  it("Admin: read-only with NOT-OWNER-PAY naming the owner", async () => {
    sessionAs({ ...OWNER, role: "admin" });
    const root = await renderCheckout();
    expect(root.textContent).toContain(
      "Only the site owner can pay. Ana Rivera can do it from Set up your site.",
    );
    expect(button(root, "Continue to payment")).toBeNull();
    expect(button(root, "Remove Testimonials from your order")?.disabled).toBe(
      true,
    );
  });

  it("impersonating staff: read-only with IMPERSONATING-PAY", async () => {
    sessionAs({ ...OWNER, impersonator: "staff1" });
    const root = await renderCheckout();
    expect(root.textContent).toContain(
      "You're viewing as support staff, so payment is turned off.",
    );
    expect(button(root, "Continue to payment")).toBeNull();
  });

  it.each([
    ["Editor", () => sessionAs({ ...OWNER, role: "editor" }), "/hub"],
    [
      "intake",
      () =>
        db.readCheckoutState.mockResolvedValue({ ...STATE, stage: "intake" }),
      "/hub/setup",
    ],
    [
      "paid",
      () =>
        db.readCheckoutState.mockResolvedValue({
          ...STATE,
          paidAt: "2026-10-08T00:00:00Z",
        }),
      "/hub/settings?tab=billing&notice=already-paid",
    ],
    [
      "closed",
      () => db.readCheckoutState.mockResolvedValue({ ...STATE, closed: true }),
      "/hub",
    ],
  ])("%s redirects", async (_n, arrange, to) => {
    arrange();
    expect(
      await redirectOf(CheckoutPage({ searchParams: Promise.resolve({}) })),
    ).toBe(`REDIRECT:${to}`);
  });

  it("fit_review: HELD-CHECKOUT only, no summary or primary", async () => {
    db.readCheckoutState.mockResolvedValue({ ...STATE, stage: "fit_review" });
    const root = await renderCheckout();
    expect(root.textContent).toContain(
      "We're still checking a couple of details about your business",
    );
    expect(root.textContent).toContain("Back to setting up your site");
    expect(root.textContent).not.toContain("Your order");
    expect(button(root, "Continue to payment")).toBeNull();
  });

  it("production on the fake adapter: OPEN-SOON", async () => {
    db.readCheckoutState.mockResolvedValue({ ...STATE, paymentsOpen: false });
    const root = await renderCheckout();
    expect(root.textContent).toContain("Checkout opens soon");
    expect(root.textContent).toContain("We're finishing our payment setup.");
    expect(db.checkoutOrderFor).not.toHaveBeenCalled();
  });

  it("?cancelled=1 shows CANCELLED-CHECKOUT; ?payment=failed shows ERR-PAY", async () => {
    nav.params = new URLSearchParams("cancelled=1");
    let root = await renderCheckout({ cancelled: "1" });
    expect(root.textContent).toContain("You left the payment page");
    expect(nav.replace).toHaveBeenCalledWith("/hub/checkout", {
      scroll: false,
    });
    mounted?.unmount();
    root = await renderCheckout({ payment: "failed" });
    expect(root.textContent).toContain("Your payment didn't go through");
  });

  it("catalog failure: ERR-PRICES with Try again, no figure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.checkoutOrderFor.mockRejectedValue(new Error("pb down"));
    const root = await renderCheckout();
    expect(root.textContent).toContain("We couldn't load prices just now.");
    expect(root.textContent).toContain("Try again");
    expect(root.textContent).not.toContain("Due today");
  });

  it("the server action's redirect is followed (unsigned at submit)", async () => {
    actions.startCheckoutAction.mockResolvedValue({
      ok: true,
      data: { redirect: "/hub/agreement?next=/hub/checkout" },
    });
    const root = await renderCheckout();
    click(button(root, "Continue to payment"));
    await flush();
    expect(nav.push).toHaveBeenCalledWith("/hub/agreement?next=/hub/checkout");
  });
});

describe("/hub/checkout/return", () => {
  async function renderReturn(session: string) {
    const el = (await ReturnPage({
      searchParams: Promise.resolve({ session }),
    })) as ReactElement;
    mounted = mount(el);
    return mounted.container;
  }

  it("confirming: aria-live polite, then Payment received from the poll", async () => {
    vi.useFakeTimers();
    db.checkoutReturnStatus.mockResolvedValue({ state: "confirming" });
    actions.checkoutStatusAction.mockResolvedValue({
      ok: true,
      data: {
        state: "received",
        paid: {
          paidLabel: "$1,539.00 plus $0.00 tax",
          nextBillLabel: "$39 a month from 8 Nov",
          receiptLine: "Emailed to ana@example.com",
        },
      },
    });
    const root = await renderReturn("cs_1");
    expect(root.textContent).toContain("Confirming your payment…");
    expect(root.querySelector('[aria-live="polite"]')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(actions.checkoutStatusAction).toHaveBeenCalledWith("cs_1");
    const text = root.textContent ?? "";
    expect(text).toContain("Payment received");
    expect(text).toContain("$1,539.00 plus $0.00 tax");
    expect(text).toContain("Emailed to ana@example.com");
    expect(text).toContain("Go to your hub");
    expect(text).toContain("See billing and invoices");
  });

  it("slow: SLOW-CONFIRM after 30 s", async () => {
    vi.useFakeTimers();
    db.checkoutReturnStatus.mockResolvedValue({ state: "confirming" });
    actions.checkoutStatusAction.mockResolvedValue({
      ok: true,
      data: { state: "confirming" },
    });
    const root = await renderReturn("cs_1");
    for (let i = 0; i < 17; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
    }
    expect(root.textContent).toContain("Your payment is being confirmed");
    expect(root.textContent).toContain(
      "Your payment is still being confirmed.",
    );
  });

  it("a failed poll goes back to checkout with ERR-PAY", async () => {
    vi.useFakeTimers();
    db.checkoutReturnStatus.mockResolvedValue({ state: "confirming" });
    actions.checkoutStatusAction.mockResolvedValue({
      ok: true,
      data: { state: "failed" },
    });
    await renderReturn("cs_1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(nav.replace).toHaveBeenCalledWith("/hub/checkout?payment=failed");
  });

  it("received on load renders the paid lines without polling", async () => {
    db.checkoutReturnStatus.mockResolvedValue({
      state: "received",
      paidCents: 153900,
      taxCents: 0,
      nextBill: "$39 a month from 8 Nov",
      receiptEmail: "ana@example.com",
    });
    const root = await renderReturn("cs_1");
    expect(root.textContent).toContain("Payment received");
    expect(root.textContent).toContain("$39 a month from 8 Nov");
  });

  it.each([
    ["unknown session", { state: "unknown" }, "/hub/checkout"],
    ["failed", { state: "failed" }, "/hub/checkout?payment=failed"],
  ])("%s redirects", async (_n, st, to) => {
    db.checkoutReturnStatus.mockResolvedValue(st);
    expect(
      await redirectOf(
        ReturnPage({ searchParams: Promise.resolve({ session: "cs_x" }) }),
      ),
    ).toBe(`REDIRECT:${to}`);
  });

  it("a malformed session id never reaches the db", async () => {
    expect(
      await redirectOf(
        ReturnPage({ searchParams: Promise.resolve({ session: "../x" }) }),
      ),
    ).toBe("REDIRECT:/hub/checkout");
    expect(db.checkoutReturnStatus).not.toHaveBeenCalled();
  });
});
