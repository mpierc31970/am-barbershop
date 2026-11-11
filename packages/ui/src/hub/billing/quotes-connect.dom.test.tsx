// @vitest-environment jsdom
// P10 Settings › Payments and quotes (10-19; 10-UI-SPEC "Settings › Payments", "Quotes
// from CDS", "Quote page", copy table, destructive actions): StripeConnectPanel,
// WorkOrderCard, QuoteDetail.
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../test-support/dom";
import { ToastRegion } from "../Toast";
import { StripeConnectPanel } from "./StripeConnectPanel";
import { QuoteDetail, WorkOrderCard, sortWorkOrders } from "./index";
import type {
  ConnectPanelView,
  QuoteView,
  WorkOrderStatus,
  WorkOrderSummary,
} from "./types";

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
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function body(): string {
  return document.body.textContent ?? "";
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const FEES =
  "You own this account, you are the seller, and you pay Stripe's fees directly (for example 2.9% + 30¢ online). Support takes no cut.";

function connectView(over: Partial<ConnectPanelView> = {}): ConnectPanelView {
  return {
    state: "not_connected",
    displayName: null,
    accountSuffix: null,
    checkedLabel: null,
    role: "owner",
    impersonating: false,
    testMode: false,
    checking: false,
    helpHref: "/hub/help/stripe",
    dashboardHref: null,
    ...over,
  };
}

const connected = connectView({
  state: "connected",
  displayName: "Rivera Bakery",
  accountSuffix: "4f2Q",
  checkedLabel: "2 minutes ago",
  dashboardHref: "https://dashboard.stripe.com/",
});

function renderPanel(
  view: ConnectPanelView,
  onConnect = vi.fn(async () => ({ ok: true })),
  onCheckAgain: () => Promise<boolean | void> = vi.fn(async () => {}),
) {
  mounted = mount(
    <StripeConnectPanel
      view={view}
      onConnect={onConnect}
      onCheckAgain={onCheckAgain}
    />,
  );
  return { onConnect, onCheckAgain };
}

function primaries(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button")).filter((b) =>
    b.className.includes("bg-hub-accent"),
  );
}

describe("StripeConnectPanel", () => {
  const states: ConnectPanelView[] = [
    connectView(),
    connectView({ state: "setup_unfinished" }),
    connected,
    connectView({ state: "restricted" }),
    connectView({ state: "disconnected" }),
    connectView({ role: "admin" }),
    connectView({ impersonating: true }),
    connectView({ checking: true }),
  ];

  it.each(
    states.map(
      (v) =>
        [`${v.state}/${v.role}/${v.impersonating}/${v.checking}`, v] as const,
    ),
  )(
    "always shows heading, intro, fees box, help link and NO-STRIPE (%s)",
    (_name, view) => {
      renderPanel(view);
      expect(document.querySelector("h2")?.textContent).toContain(
        "Take payments on your site",
      );
      expect(body()).toContain(
        "Money goes straight to your Stripe account, never through Support.",
      );
      const fees = document.querySelector("[data-fees-box]");
      expect(fees?.textContent).toBe(FEES);
      expect(fees?.className).toContain("bg-hub-surface-2");
      const help = Array.from(document.querySelectorAll("a")).find(
        (a) => a.textContent === "Help me set up Stripe",
      );
      expect(help?.getAttribute("href")).toBe("/hub/help/stripe");
      expect(body()).toContain(
        "No Stripe yet? Customers can still book and pay you in person.",
      );
      // D-UI-P10-9: never a Disconnect button.
      for (const b of Array.from(document.querySelectorAll("button"))) {
        expect(b.textContent ?? "").not.toMatch(/disconnect/i);
      }
    },
  );

  it("not connected: helper, badge and Connect your Stripe account", () => {
    renderPanel(connectView());
    expect(body()).toContain("Not connected");
    expect(body()).toContain("Already use Stripe?");
    expect(primaries().map((b) => b.textContent)).toEqual([
      "Connect your Stripe account",
    ]);
  });

  it("setup unfinished: warning and Finish Stripe setup", () => {
    renderPanel(connectView({ state: "setup_unfinished" }));
    expect(body()).toContain("Setup not finished");
    expect(body()).toContain("Your Stripe account isn't finished yet");
    expect(primaries().map((b) => b.textContent)).toEqual([
      "Finish Stripe setup",
    ]);
  });

  it("restricted: warning and Finish Stripe setup", () => {
    renderPanel(connectView({ state: "restricted" }));
    expect(body()).toContain("Needs attention");
    expect(body()).toContain("Stripe has paused payments on your account");
    expect(primaries().map((b) => b.textContent)).toEqual([
      "Finish Stripe setup",
    ]);
  });

  it("disconnected: warning and Connect your Stripe account", () => {
    renderPanel(connectView({ state: "disconnected" }));
    expect(body()).toContain("Your Stripe account was disconnected");
    expect(primaries().map((b) => b.textContent)).toEqual([
      "Connect your Stripe account",
    ]);
  });

  it("connected: account list, Check again, dashboard link, disconnect help, no primary", () => {
    const { onCheckAgain } = renderPanel(connected);
    expect(body()).toContain("Connected");
    const dl = document.querySelector("dl");
    expect(dl?.textContent).toContain("Rivera Bakery (acct ending 4f2Q)");
    expect(dl?.textContent).toContain("Online payments");
    expect(dl?.textContent).toContain("On");
    expect(dl?.textContent).toContain("2 minutes ago");
    expect(primaries()).toHaveLength(0);
    const dash = Array.from(document.querySelectorAll("a")).find((a) =>
      (a.textContent ?? "").includes("Open your Stripe dashboard"),
    );
    expect(dash?.getAttribute("target")).toBe("_blank");
    expect(dash?.getAttribute("rel")).toContain("noopener");
    expect(dash?.textContent).toMatch(/opens Stripe in a new tab/);
    expect(body()).toContain(
      "To disconnect, remove Connections Design Studios under Settings › Connected accounts",
    );
    click(button(document, "Check again"));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it("WR-C09: Check again is pending while it runs, one at a time, and a failure says so", async () => {
    const d = deferred<boolean>();
    const onCheckAgain = vi.fn(() => d.promise);
    renderPanel(connected, undefined, onCheckAgain);
    click(button(document, "Check again"));
    expect(body()).toContain("Checking your Stripe account…");
    click(document.querySelector("dl button"));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
    await act(async () => {
      d.resolve(false);
      await d.promise;
    });
    await flush();
    expect(document.querySelector("[role=alert]")?.textContent).toContain(
      "We couldn't check your Stripe account just now.",
    );
    // A rejection is caught (no unhandled rejection) and shows the same error.
    onCheckAgain.mockImplementationOnce(() => Promise.reject(new Error("x")));
    click(button(document, "Check again"));
    await flush();
    expect(onCheckAgain).toHaveBeenCalledTimes(2);
    expect(document.querySelector("[role=alert]")).not.toBeNull();
  });

  it("admin: no buttons, owner-only line", () => {
    renderPanel(connectView({ role: "admin" }));
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(body()).toContain(
      "Only the site owner can connect or change Stripe.",
    );
    renderPanelAgain(
      connectView({
        role: "admin",
        state: "connected",
        displayName: "X",
        accountSuffix: "1234",
        dashboardHref: "https://dashboard.stripe.com/",
      }),
    );
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });

  it("impersonating: no buttons, IMPERSONATING-CONNECT", () => {
    renderPanel(connectView({ impersonating: true, state: "restricted" }));
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(body()).toContain(
      "You're viewing as support staff, so Stripe changes are turned off.",
    );
  });

  it("connect: pending shows Opening Stripe…, failure shows ERR-CONNECT", async () => {
    const d = deferred<{ ok: boolean }>();
    const onConnect = vi.fn(() => d.promise);
    renderPanel(connectView(), onConnect);
    click(button(document, "Connect your Stripe account"));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(body()).toContain("Opening Stripe…");
    await act(async () => {
      d.resolve({ ok: false });
      await d.promise;
    });
    await flush();
    const alert = document.querySelector("[role=alert]");
    expect(alert?.textContent).toContain(
      "We couldn't open Stripe just now. Nothing changed. Try again in a minute.",
    );
    expect(button(document, "Connect your Stripe account")).not.toBeNull();
  });

  it("WR-C04: back from Stripe (bfcache restore) brings Connect back", async () => {
    const onConnect = vi.fn(async () => ({ ok: true }));
    renderPanel(connectView(), onConnect);
    click(button(document, "Connect your Stripe account"));
    await flush();
    expect(body()).toContain("Opening Stripe…");
    act(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: false }),
      );
    });
    expect(body()).toContain("Opening Stripe…");
    act(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
    });
    expect(body()).not.toContain("Opening Stripe…");
    click(button(document, "Connect your Stripe account"));
    expect(onConnect).toHaveBeenCalledTimes(2);
  });

  it("connect: a thrown action also shows ERR-CONNECT", async () => {
    const onConnect = vi.fn(async () => {
      throw new Error("boom");
    });
    renderPanel(connectView(), onConnect);
    click(button(document, "Connect your Stripe account"));
    await flush();
    expect(document.querySelector("[role=alert]")?.textContent).toContain(
      "We couldn't open Stripe just now.",
    );
  });

  it("checking: polite live region and no state block", () => {
    renderPanel(connectView({ checking: true }));
    const live = document.querySelector("[aria-live=polite]");
    expect(live?.textContent).toContain("Checking your Stripe account…");
    expect(primaries()).toHaveLength(0);
  });

  it("test mode adds TEST-CONNECT", () => {
    renderPanel(connectView({ testMode: true }));
    expect(body()).toContain(
      "Test mode: this connects a pretend Stripe account.",
    );
  });
});

function renderPanelAgain(view: ConnectPanelView) {
  mounted?.unmount();
  document.body.innerHTML = "";
  renderPanel(view);
}

function order(over: Partial<WorkOrderSummary> = {}): WorkOrderSummary {
  return {
    id: "wo1",
    title: "Homepage design polish",
    status: "sent",
    sentLabel: "8 Oct",
    totalCents: 36000,
    href: "/hub/settings/quotes/wo1",
    ...over,
  };
}

describe("WorkOrderCard", () => {
  it("sent: Waiting for you badge and Review quote", () => {
    mounted = mount(<WorkOrderCard order={order()} />);
    expect(body()).toContain("Homepage design polish");
    expect(body()).toContain("Waiting for you");
    expect(body()).toContain("Sent 8 Oct · $360");
    const link = document.querySelector("a");
    expect(link?.textContent).toContain("Review quote");
    expect(link?.getAttribute("href")).toBe("/hub/settings/quotes/wo1");
  });

  const words: [WorkOrderStatus, string][] = [
    ["accepted", "Accepted"],
    ["deposit_paid", "Deposit paid"],
    ["delivered", "Delivered"],
    ["paid", "Paid"],
    ["declined", "Declined"],
    ["expired", "Expired"],
  ];
  it.each(words)("%s: badge %s and View quote", (status, word) => {
    mounted = mount(<WorkOrderCard order={order({ status })} />);
    expect(body()).toContain(word);
    expect(document.querySelector("a")?.textContent).toContain("View quote");
  });

  it("sortWorkOrders puts waiting quotes first, keeping order otherwise", () => {
    const list = [
      order({ id: "a", status: "paid" }),
      order({ id: "b", status: "sent" }),
      order({ id: "c", status: "declined" }),
      order({ id: "d", status: "sent" }),
    ];
    expect(sortWorkOrders(list).map((o) => o.id)).toEqual(["b", "d", "a", "c"]);
  });
});

function quote(over: Partial<QuoteView> = {}): QuoteView {
  return {
    title: "Homepage design polish",
    status: "sent",
    metaLine: "Quote from Support · Sent 8 Oct 2026 · Valid until 7 Nov 2026",
    scopeHtml: "<p>Tighten the hero.</p><ul><li>New photo crop</li></ul>",
    kind: "polish",
    priceRows: [
      {
        label: "Design polish, 3-hour block · 3 h × $120",
        amountLabel: "$360",
      },
    ],
    payNowCents: 36000,
    acceptedLabel: null,
    deliveredLabel: null,
    statusDateLabel: null,
    payHref: null,
    canAct: true,
    impersonating: false,
    ...over,
  };
}

function renderQuote(
  view: QuoteView,
  onAccept = vi.fn(async () => ({ ok: true })),
  onDecline = vi.fn(async () => ({ ok: true })),
) {
  mounted = mount(
    <ToastRegion>
      <QuoteDetail view={view} onAccept={onAccept} onDecline={onDecline} />
    </ToastRegion>,
  );
  return { onAccept, onDecline };
}

function acceptButton(): HTMLButtonElement {
  const b = button(document, /^Accept and pay/);
  if (!b) throw new Error("no accept button");
  return b;
}

describe("QuoteDetail", () => {
  it("sent: heading, meta, scope, receipt, Pay now and tax line", () => {
    renderQuote(quote());
    expect(document.querySelector("h2")?.textContent).toContain(
      "Homepage design polish",
    );
    expect(body()).toContain("Waiting for you");
    expect(body()).toContain("Quote from Support · Sent 8 Oct 2026");
    expect(body()).toContain("What Support will do");
    expect(document.querySelector("[data-quote-scope] li")?.textContent).toBe(
      "New photo crop",
    );
    expect(body()).toContain("Design polish, 3-hour block · 3 h × $120");
    const pay = document.querySelector("[data-pay-now]");
    expect(pay?.textContent).toContain("$360");
    expect(body()).toContain("Plus sales tax where applicable.");
  });

  it("add-on kind: deposit, balance and maintenance rows", () => {
    renderQuote(
      quote({
        kind: "private_addon",
        priceRows: [
          { label: "Build price", amountLabel: "$4,000" },
          { label: "Deposit today (50%)", amountLabel: "$2,000" },
          { label: "Balance when delivered", amountLabel: "$2,000" },
          {
            label: "Maintenance after delivery",
            amountLabel: "$50/mo on your monthly bill",
          },
        ],
        payNowCents: 200000,
      }),
    );
    expect(document.querySelectorAll("[data-price-row]")).toHaveLength(4);
    expect(body()).toContain("Deposit today (50%)");
    expect(acceptButton().textContent).toBe("Accept and pay $2,000");
  });

  it("checkbox is never pre-ticked; Accept is aria-disabled until ticked", () => {
    const { onAccept } = renderQuote(quote());
    const box = document.querySelector<HTMLInputElement>(
      "input[type=checkbox]",
    );
    expect(box?.checked).toBe(false);
    expect(box?.closest("label")?.textContent).toContain(
      "I accept this quote and its scope.",
    );
    const accept = acceptButton();
    expect(accept.getAttribute("aria-disabled")).toBe("true");
    expect(body()).toContain("Tick the box above to accept.");
    const reasonId = accept.getAttribute("aria-describedby");
    expect(reasonId && document.getElementById(reasonId)?.textContent).toBe(
      "Tick the box above to accept.",
    );
    click(accept);
    expect(onAccept).not.toHaveBeenCalled();
    click(box);
    expect(acceptButton().getAttribute("aria-disabled")).toBeNull();
    expect(body()).not.toContain("Tick the box above to accept.");
  });

  it("accepting shows Opening your invoice…, failure shows ERR-QUOTE-PAY", async () => {
    const d = deferred<{ ok: boolean }>();
    const onAccept = vi.fn(() => d.promise);
    renderQuote(quote(), onAccept);
    click(document.querySelector("input[type=checkbox]"));
    click(acceptButton());
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(body()).toContain("Opening your invoice…");
    await act(async () => {
      d.resolve({ ok: false });
      await d.promise;
    });
    await flush();
    expect(document.querySelector("[role=alert]")?.textContent).toContain(
      "We couldn't open your invoice. Your acceptance is saved; try again in a minute.",
    );
  });

  it("WR-C04: back from the hosted invoice (bfcache restore) brings Accept and Decline back", async () => {
    const onAccept = vi.fn(async () => ({ ok: true }));
    renderQuote(quote(), onAccept);
    click(document.querySelector("input[type=checkbox]"));
    click(acceptButton());
    await flush();
    expect(body()).toContain("Opening your invoice…");
    expect(button(document, "Decline this quote")?.disabled).toBe(true);
    act(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
    });
    expect(body()).not.toContain("Opening your invoice…");
    expect(button(document, "Decline this quote")?.disabled).toBe(false);
  });

  it("decline opens a danger dialog with Keep quote focused", async () => {
    const { onDecline } = renderQuote(quote());
    click(button(document, "Decline this quote"));
    const dialog = document.querySelector("dialog");
    expect(dialog?.hasAttribute("open")).toBe(true);
    expect(dialog?.textContent).toContain("Decline this quote?");
    expect(dialog?.textContent).toContain(
      "Support is told, and no work starts. You can ask for a new quote any time.",
    );
    expect(document.activeElement?.textContent).toBe("Keep quote");
    click(button(dialog!, "Decline quote"));
    await flush();
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(dialog?.hasAttribute("open")).toBe(false);
  });

  it("decline failure keeps the dialog open with an error", async () => {
    renderQuote(
      quote(),
      undefined,
      vi.fn(async () => ({ ok: false })),
    );
    click(button(document, "Decline this quote"));
    const dialog = document.querySelector("dialog")!;
    click(button(dialog, "Decline quote"));
    await flush();
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.querySelector("[role=alert]")).not.toBeNull();
  });

  it("accepted with an invoice: info line and Pay link", () => {
    renderQuote(
      quote({
        status: "accepted",
        acceptedLabel: "9 Oct",
        payHref: "https://invoice.stripe.com/i/1",
      }),
    );
    expect(body()).toContain(
      "Accepted on 9 Oct. Pay the invoice to start the work.",
    );
    const pay = Array.from(document.querySelectorAll("a")).find(
      (a) => a.textContent === "Pay $360",
    );
    expect(pay?.getAttribute("href")).toBe("https://invoice.stripe.com/i/1");
    expect(document.querySelector("input[type=checkbox]")).toBeNull();
  });

  it.each(["deposit_paid", "paid"] as const)("%s: QUOTE-STARTED", (status) => {
    renderQuote(quote({ status, statusDateLabel: "9 Oct" }));
    expect(body()).toContain(
      "Paid on 9 Oct. Support has started the work and will message you when it's ready.",
    );
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });

  it("delivered: QUOTE-BALANCE and Pay the balance", () => {
    renderQuote(
      quote({
        status: "delivered",
        deliveredLabel: "20 Oct",
        payNowCents: 200000,
        payHref: "/test-pay/inv2",
      }),
    );
    expect(body()).toContain(
      "Support delivered this work on 20 Oct. Pay the balance to finish; your monthly maintenance starts with your next bill.",
    );
    const pay = Array.from(document.querySelectorAll("a")).find(
      (a) => a.textContent === "Pay the balance $2,000",
    );
    expect(pay?.getAttribute("href")).toBe("/test-pay/inv2");
  });

  it("declined and expired lines", () => {
    renderQuote(quote({ status: "declined", statusDateLabel: "9 Oct" }));
    expect(body()).toContain("You declined this quote on 9 Oct.");
    mounted?.unmount();
    document.body.innerHTML = "";
    renderQuote(quote({ status: "expired", statusDateLabel: "7 Nov" }));
    expect(body()).toContain(
      "This quote expired on 7 Nov. Ask Support for a new one.",
    );
  });

  it("impersonating: read-only with IMPERSONATING-PAY", () => {
    renderQuote(quote({ impersonating: true, canAct: false }));
    expect(body()).toContain(
      "You're viewing as support staff, so payment is turned off. Only the owner can pay.",
    );
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(document.querySelector("input[type=checkbox]")).toBeNull();
  });
});
