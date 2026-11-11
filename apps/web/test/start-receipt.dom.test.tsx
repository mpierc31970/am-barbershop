// @vitest-environment jsdom
// 06-15 Tasks 1-2: the /start live receipt, phone bar + sheet, Review and submit and the
// returning Toast, and the inline save card (ONB-06, ONB-08; D213; 06-UI-SPEC "Receipt", "Phone (<1024px)", "Configurator states",
// Accessibility contract; D79, D181, D186, D262, D296, D299, D314; D-UI-P6-35). Worked
// figures are the UI-SPEC's: Standard monthly $1,539 / $289 / $1,968, yearly $1,890.
import { EXTRAS, PATHS } from "@cds/core/onboarding";
import type { PickableAddon } from "@cds/core/onboarding";
import {
  priceQuote,
  type CatalogRow,
  type QuoteSelections,
} from "@cds/core/pricing";
import type { ReactNode } from "react";
import { act } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  button,
  click,
  flush,
  mount,
  submit,
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

const { Configurator, RETURNING_TOAST, WELCOME_TOAST } =
  await import("../app/(platform)/start/_components/Configurator");
const receiptMod = await import("../app/(platform)/start/_components/Receipt");
const { Receipt, EMPTY_RECEIPT, SUBMIT_HINT, unpricedNote, receiptTotals } =
  receiptMod;

const CATALOG: CatalogRow[] = [
  row("plan", "base", "standard", { monthlyCents: 3900 }),
  row("build_fee", "base", "standard", { oneTimeCents: 150000 }),
  row("care_plan", "care", "standard", { monthlyCents: 9900 }),
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

const ADDONS: PickableAddon[] = [
  {
    slug: "testimonials",
    name: "Testimonials",
    summary: "Testimonials summary.",
    category: "content",
    paths: ["standard", "studio"],
    visibility: "public",
    order: 10,
  },
  {
    slug: "credentials",
    name: "Credentials",
    summary: "Credentials summary.",
    category: "content",
    paths: ["standard", "studio"],
    visibility: "public",
    order: 20,
  },
];
const NAMES = { testimonials: "Testimonials", credentials: "Credentials" };

const SELECTIONS: QuoteSelections = {
  addons: [],
  extras: [],
  carePlan: false,
  cadence: "monthly",
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
function renderConfigurator(
  initialQuote: ReturnType<typeof quote> | null = null,
) {
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

function receiptProps(over: Partial<Parameters<typeof Receipt>[0]> = {}) {
  return {
    catalog: CATALOG,
    path: "standard" as const,
    typeChosen: true,
    selections: SELECTIONS,
    addonNames: NAMES,
    extras: EXTRAS,
    paths: PATHS,
    ...over,
  };
}

function renderReceipt(over: Partial<Parameters<typeof Receipt>[0]> = {}) {
  mounted = mount(<Receipt {...receiptProps(over)} />);
  return mounted.container;
}

const radio = (el: ParentNode, value: string) =>
  (Array.from(el.querySelectorAll('[role="radio"]')) as HTMLElement[]).find(
    (r) => r.dataset.value === value,
  )!;
const aside = (el: ParentNode) =>
  el.querySelector('aside[aria-labelledby="receipt-title"]') as HTMLElement;
const text = (el: Element | null) =>
  (el?.textContent ?? "").replace(/\s+/g, " ");

function setWide(wide: boolean | null) {
  if (wide === null) {
    delete (window as { matchMedia?: unknown }).matchMedia;
    return;
  }
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width") ? wide : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

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

beforeEach(() => {
  window.sessionStorage.clear();
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
  setWide(null);
  window.history.replaceState(null, "", "/");
});
afterAll(() => setWide(null));

describe("receipt helpers", () => {
  it("words the unpriced note and prefers in-sync server totals", () => {
    expect(unpricedNote(0)).toBeNull();
    expect(unpricedNote(1)).toBe("+ 1 item priced soon");
    expect(unpricedNote(2)).toBe("+ 2 items priced soon");
    const client = receiptTotals(CATALOG, "standard", SELECTIONS, null)!;
    expect(client.dueAtCheckoutCents).toBe(153900);
    const server = { ...client, dueAtCheckoutCents: 1 };
    expect(receiptTotals(CATALOG, "standard", SELECTIONS, server)).toBe(server);
    expect(receiptTotals(CATALOG, "", SELECTIONS, null)).toBeNull();
    expect(receiptTotals(null, "standard", SELECTIONS, null)).toBeNull();
  });
});

describe("Receipt", () => {
  it("empty before a path: the heading and the UI-SPEC line, no zeros", () => {
    const el = renderReceipt({ path: "", typeChosen: false });
    expect(el.querySelector("#receipt-title")?.textContent).toBe("Your quote");
    expect(el.textContent).toContain(EMPTY_RECEIPT);
    expect(el.textContent).not.toContain("$0");
  });

  it("Standard, monthly: the worked figures, lines and fee notes", () => {
    const el = renderReceipt();
    const t = text(el);
    expect(t).toContain("Standard website");
    expect(t).toContain("Website build$1,500");
    expect(t).toContain("or 6 × $250 with no surcharge");
    expect(t).toContain("Standard plan$39/mo");
    expect(t).toContain("Hosting, support and 10 pages");
    expect(t).toContain("Due at checkout$1,539");
    expect(t).toContain("With 6 build payments: $289 at checkout");
    expect(t).toContain("First-year total$1,968");
    expect(t).toContain("Plus sales tax where applicable.");
    expect(t).toContain(
      "You pay your own payment processor's fees. We take no cut.",
    );
    expect(t).not.toContain("priced soon");
    const care = el.querySelector('input[role="switch"]') as HTMLInputElement;
    expect(care.checked).toBe(false);
    expect(text(el.querySelector(`label[for="${care.id}"]`))).toBe(
      "Add the Care Plan · $99/mo",
    );
  });

  it("ticked add-ons and extras: 'Added now, setup is free' once; unpriced items counted", () => {
    const el = renderReceipt({
      selections: {
        ...SELECTIONS,
        addons: ["testimonials", "credentials"],
        extras: ["copywriting", "logo-design"],
      },
    });
    const t = text(el);
    expect(t).toContain("Testimonials$9/mo");
    expect(t).toContain("CredentialsPrice coming soon");
    expect(t).toContain("Copywriting$300");
    expect(t).toContain("Logo designPrice coming soon");
    expect(t.match(/Added now, setup is free/g)).toHaveLength(1);
    expect(t).toContain("+ 2 items priced soon");
    // $1,500 + $300 + $39 + $9
    expect(t).toContain("Due at checkout$1,848");
  });

  it("one unpriced add-on says '+ 1 item priced soon'", () => {
    const el = renderReceipt({
      selections: { ...SELECTIONS, addons: ["credentials"] },
    });
    expect(el.textContent).toContain("+ 1 item priced soon");
  });

  it("Review and submit is aria-disabled with the hint until path and type, then links to /start/submit", () => {
    const el = renderReceipt({ typeChosen: false });
    const off = Array.from(el.querySelectorAll("a")).find(
      (a) => a.textContent === "Review and submit",
    )!;
    expect(off.getAttribute("aria-disabled")).toBe("true");
    expect(off.hasAttribute("href")).toBe(false);
    expect(
      document.getElementById(off.getAttribute("aria-describedby")!)
        ?.textContent,
    ).toBe(SUBMIT_HINT);
    mounted!.unmount();
    const el2 = renderReceipt({ typeChosen: true });
    const on = Array.from(el2.querySelectorAll("a")).find(
      (a) => a.textContent === "Review and submit",
    )!;
    expect(on.getAttribute("href")).toBe("/start/submit");
    expect(on.hasAttribute("aria-disabled")).toBe(false);
    expect(el2.textContent).not.toContain(SUBMIT_HINT);
  });

  it("the polite live line announces only totals, debounced 1 s", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const el = renderReceipt();
    const live = el.querySelectorAll('[aria-live="polite"]');
    expect(live).toHaveLength(1);
    expect(live[0]!.textContent).toBe("");
    act(() =>
      mounted!.root.render(
        <Receipt
          {...receiptProps({ selections: { ...SELECTIONS, carePlan: true } })}
        />,
      ),
    );
    act(() =>
      mounted!.root.render(
        <Receipt
          {...receiptProps({
            selections: { ...SELECTIONS, carePlan: true, cadence: "yearly" },
          })}
        />,
      ),
    );
    act(() => vi.advanceTimersByTime(999));
    expect(live[0]!.textContent).toBe("");
    act(() => vi.advanceTimersByTime(1));
    // yearly: $1,500 + 10 x $39 + $99 Care Plan monthly
    expect(live[0]!.textContent).toBe(
      "Due at checkout now $1,989. Monthly $138.",
    );
  });

  it("the JS-off receipt has no switch or billing control but lists the Care Plan", () => {
    const el = renderReceipt({
      interactive: false,
      selections: { ...SELECTIONS, carePlan: true },
    });
    expect(el.querySelector('input[role="switch"]')).toBeNull();
    expect(el.querySelector('[role="radiogroup"]')).toBeNull();
    expect(text(el)).toContain("Care Plan$99/mo");
  });
});

describe("Configurator + receipt", () => {
  it("choosing a path fills the rail receipt; Yearly and the Care Plan recompute it", async () => {
    const el = renderConfigurator();
    expect(aside(el).textContent).toContain(EMPTY_RECEIPT);
    click(radio(el, "standard"));
    expect(text(aside(el))).toContain("Due at checkout$1,539");
    const yearly = radio(aside(el), "yearly");
    expect(yearly.textContent).toBe("Yearly, 2 months free");
    click(yearly);
    expect(yearly.getAttribute("aria-checked")).toBe("true");
    expect(text(aside(el))).toContain("Due at checkout$1,890");
    expect(text(aside(el))).toContain("First-year total$1,890");
    expect(aside(el).textContent).toContain(
      "Yearly covers the plan and add-ons. The build fee is the same.",
    );
    click(radio(aside(el), "monthly"));
    const care = aside(el).querySelector(
      'input[role="switch"]',
    ) as HTMLInputElement;
    click(care);
    expect(care.checked).toBe(true);
    const expected = priceQuote(
      CATALOG,
      { ...SELECTIONS, carePlan: true },
      "standard",
      "monthly",
    );
    expect(text(aside(el))).toContain(`Due at checkout$1,638`);
    expect(expected.dueAtCheckoutCents).toBe(163800);
    await flush();
  });

  it("the server's recomputed totals replace the client figures after the save", async () => {
    const serverTotals = {
      ...priceQuote(CATALOG, SELECTIONS, "standard", "monthly"),
      dueAtCheckoutCents: 999999,
    };
    action.chooseQuoteAction.mockResolvedValueOnce({
      quote: quote({ totals: serverTotals }),
      removed: [],
      error: null,
    });
    const el = renderConfigurator();
    click(radio(el, "standard"));
    expect(text(aside(el))).toContain("Due at checkout$1,539");
    await flush();
    expect(text(aside(el))).toContain("Due at checkout$9,999.99");
  });

  it("below 1024 px: the bar shows monthly over build; View quote opens the sheet and focus returns", async () => {
    setWide(false);
    const el = renderConfigurator(quote());
    // No rail: the only receipt is the one inside the sheet.
    expect(el.querySelectorAll("aside")).toHaveLength(1);
    expect(aside(el).closest("dialog")).not.toBeNull();
    const bar = button(document.body, /View quote/)!;
    expect(bar).not.toBeNull();
    const barText = text(bar.parentElement);
    expect(barText).toContain("$39/mo");
    expect(barText).toContain("$1,500 build");
    const dialog = document.querySelector("dialog")!;
    expect(dialog.hasAttribute("open")).toBe(false);
    act(() => bar.focus());
    click(bar);
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(aside(dialog)).not.toBeNull();
    expect(text(aside(dialog))).toContain("Due at checkout$1,539");
    click(button(dialog, "Close quote"));
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(bar);
    await flush();
  });

  it("no bar before a path on a phone", () => {
    setWide(false);
    renderConfigurator();
    expect(button(document.body, /View quote/)).toBeNull();
  });

  it("a restored quote shows the returning Toast once per session", async () => {
    const el = renderConfigurator(quote());
    await flush();
    expect(document.body.textContent).toContain(RETURNING_TOAST);
    expect(el).toBeDefined();
    mounted!.unmount();
    renderConfigurator(quote());
    await flush();
    expect(document.body.textContent).not.toContain(RETURNING_TOAST);
  });

  it("?welcome=1 shows the welcome Toast and strips the param", async () => {
    window.sessionStorage.setItem("cds-start-returned", "1");
    window.history.replaceState(null, "", "/start?welcome=1");
    renderConfigurator(quote());
    await flush();
    expect(document.body.textContent).toContain(WELCOME_TOAST);
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/start");
  });

  it("a first visit (no quote) shows no Toast", async () => {
    renderConfigurator();
    await flush();
    expect(document.body.textContent).not.toContain(RETURNING_TOAST);
  });
});

describe("Save your quote card", () => {
  const TITLE = "Save your quote? Just your email.";
  const card = () =>
    document.querySelector('section[aria-labelledby="save-quote-title"]');

  beforeEach(() => {
    action.saveQuoteAction.mockReset();
  });

  it("is hidden until the second choice, then inline (never a dialog) with verbatim copy", () => {
    renderConfigurator(quote());
    expect(document.body.textContent).not.toContain(TITLE);
    mounted!.unmount();
    const el = renderConfigurator(quote({ businessType: "therapist" }));
    const c = card()!;
    expect(c).not.toBeNull();
    expect(c.closest("dialog, [role=dialog]")).toBeNull();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(c.textContent).toContain(TITLE);
    expect(c.textContent).toContain(
      "We'll send you a link back to this exact quote, and two reminders: tomorrow and in 3 days. Unsubscribe any time.",
    );
    const email = c.querySelector("#save-quote-email") as HTMLInputElement;
    expect(email.type).toBe("email");
    expect(email.autocomplete).toBe("email");
    expect(
      c.querySelector('input[type="hidden"][name="cf-turnstile-response"]'),
    ).not.toBeNull();
    // Secondary, not the accent: Review and submit is the one accent button.
    expect(button(c, "Save quote")!.className).not.toContain("bg-hub-accent");
  });

  it("No thanks hides it for the session", () => {
    renderConfigurator(quote({ businessType: "therapist" }));
    click(button(card()!, "No thanks"));
    expect(card()).toBeNull();
    mounted!.unmount();
    renderConfigurator(quote({ businessType: "therapist" }));
    expect(card()).toBeNull();
  });

  it("a save collapses to the confirmation line; the receipt says Saved to", async () => {
    action.saveQuoteAction.mockResolvedValue({
      status: "saved",
      email: "maria@example.com",
      error: null,
    });
    const el = renderConfigurator(quote({ businessType: "therapist" }));
    typeInto(el.querySelector("#save-quote-email"), "maria@example.com");
    submit(card()!.querySelector("form"));
    await flush();
    expect(action.saveQuoteAction).toHaveBeenCalledTimes(1);
    const fd = action.saveQuoteAction.mock.calls[0]![1] as FormData;
    expect(fd.get("email")).toBe("maria@example.com");
    expect(fd.has("cf-turnstile-response")).toBe(true);
    expect(el.textContent).toContain(
      "Quote saved. We sent a link to maria@example.com.",
    );
    expect(button(el, "Use a different email")).not.toBeNull();
    expect(aside(el).textContent).toContain("Saved to maria@example.com");
    expect(card()).toBeNull();
  });

  it("an error shows inside the card", async () => {
    const ERR_HUMAN =
      "We couldn't confirm you're a person. Try again, or refresh the page.";
    action.saveQuoteAction.mockResolvedValue({
      status: "idle",
      email: null,
      error: ERR_HUMAN,
    });
    const el = renderConfigurator(quote({ businessType: "therapist" }));
    typeInto(el.querySelector("#save-quote-email"), "maria@example.com");
    submit(card()!.querySelector("form"));
    await flush();
    expect(card()!.querySelector('[role="alert"]')?.textContent).toContain(
      ERR_HUMAN,
    );
  });
});
