// @vitest-environment jsdom
// P10 Settings › Billing read side (10-10; 10-UI-SPEC sections 1-3, 7, "Billing banner",
// copy table, a11y): BillingStatusStrip, BillingBanner, PlanSummary,
// SubscriptionItemsList, InvoiceTable.
import { afterEach, describe, expect, it } from "vitest";
import { mount, type Mounted } from "../../test-support/dom";
import { BillingBanner } from "./BillingBanner";
import { BillingStatusStrip } from "./BillingStatusStrip";
import { InvoiceTable } from "./InvoiceTable";
import { PlanSummary } from "./PlanSummary";
import { SubscriptionItemsList } from "./SubscriptionItemsList";
import type {
  BillingStatusView,
  InvoiceRow,
  ItemsView,
  PlanView,
} from "./types";
import { act } from "react";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const status = (over: Partial<BillingStatusView> = {}): BillingStatusView => ({
  state: "paid_up",
  nextBill: { date: "8 Nov 2026", cents: 3900 },
  amountDueCents: null,
  quoteWaiting: null,
  checkoutHref: null,
  updateCardHref: "/hub/billing/portal",
  ...over,
});

function text(m: Mounted): string {
  return m.container.textContent ?? "";
}
function links(m: Mounted): HTMLAnchorElement[] {
  return Array.from(m.container.querySelectorAll("a"));
}

describe("BillingStatusStrip", () => {
  it("paid up: success, date and amount, no action", () => {
    mounted = mount(<BillingStatusStrip view={status()} />);
    expect(text(mounted)).toContain(
      "You're all paid up. Next bill 8 Nov 2026, $39.00.",
    );
    expect(mounted.container.innerHTML).toContain("bg-hub-success-tint");
    expect(links(mounted)).toHaveLength(0);
  });

  it("not paid: info, Go to checkout only when eligible", () => {
    mounted = mount(
      <BillingStatusStrip
        view={status({ state: "not_paid", nextBill: null })}
      />,
    );
    expect(text(mounted)).toContain("You haven't checked out yet.");
    expect(links(mounted)).toHaveLength(0);
    mounted.unmount();
    mounted = mount(
      <BillingStatusStrip
        view={status({
          state: "not_paid",
          nextBill: null,
          checkoutHref: "/hub/checkout",
        })}
      />,
    );
    const [a] = links(mounted);
    expect(a?.textContent).toBe("Go to checkout");
    expect(a?.getAttribute("href")).toBe("/hub/checkout");
    expect(a?.className).not.toContain("bg-hub-accent");
  });

  it("past due: warning with amount and a primary Update card", () => {
    mounted = mount(
      <BillingStatusStrip
        view={status({ state: "past_due", amountDueCents: 15900 })}
      />,
    );
    expect(text(mounted)).toContain(
      "Your last payment of $159.00 didn't go through.",
    );
    expect(mounted.container.innerHTML).toContain("bg-hub-warning-tint");
    expect(mounted.container.innerHTML).not.toContain("hub-danger");
    const [a] = links(mounted);
    expect(a?.textContent).toBe("Update card");
    expect(a?.className).toContain("bg-hub-accent");
    expect(a?.getAttribute("href")).toBe("/hub/billing/portal");
  });

  it("paused: warning, nothing deleted, primary Update card and pay", () => {
    mounted = mount(
      <BillingStatusStrip
        view={status({ state: "paused", amountDueCents: 15900 })}
      />,
    );
    expect(text(mounted)).toContain(
      "Your add-ons are paused because payment stopped. Your site's pages are still live and nothing was deleted. Pay $159.00 to turn everything back on.",
    );
    expect(mounted.container.innerHTML).not.toContain("hub-danger");
    const [a] = links(mounted);
    expect(a?.textContent).toBe("Update card and pay");
    expect(a?.className).toContain("bg-hub-accent");
  });

  it("quote waiting adds a second info strip with Review quote", () => {
    mounted = mount(
      <BillingStatusStrip
        view={status({
          quoteWaiting: { title: "Homepage polish", href: "/hub/quotes/q1" },
        })}
      />,
    );
    expect(text(mounted)).toContain(
      "Support sent you a quote: Homepage polish.",
    );
    const a = links(mounted).find((l) => l.textContent === "Review quote");
    expect(a?.getAttribute("href")).toBe("/hub/quotes/q1");
    expect(a?.className).not.toContain("bg-hub-accent");
  });
});

describe("BillingBanner", () => {
  it("past due: warning copy and a secondary sm Update card, no dismiss", () => {
    mounted = mount(
      <BillingBanner
        state="past_due"
        amountCents={15900}
        updateCardHref="/hub/billing/portal"
      />,
    );
    expect(text(mounted)).toContain(
      "Your last card payment didn't go through. Update your card to keep your add-ons on.",
    );
    const [a] = links(mounted);
    expect(a?.textContent).toBe("Update card");
    expect(a?.className).toContain("h-8");
    expect(a?.className).not.toContain("bg-hub-accent");
    expect(mounted.container.querySelectorAll("button")).toHaveLength(0);
    expect(mounted.container.innerHTML).not.toContain("hub-danger");
  });

  it("paused: PauseCircle icon, nothing deleted, Update card and pay", () => {
    mounted = mount(
      <BillingBanner
        state="paused"
        amountCents={15900}
        updateCardHref="/hub/billing/portal"
      />,
    );
    expect(text(mounted)).toContain("nothing was deleted");
    expect(text(mounted)).toContain("Pay $159.00");
    expect(
      mounted.container.querySelector(
        "svg.lucide-circle-pause, svg.lucide-pause-circle",
      ),
    ).not.toBeNull();
    expect(links(mounted)[0]?.textContent).toBe("Update card and pay");
    expect(mounted.container.querySelectorAll("button")).toHaveLength(0);
    expect(mounted.container.innerHTML).not.toContain("hub-danger");
  });
});

const plan = (over: Partial<PlanView> = {}): PlanView => ({
  planLine: "Standard website, billed monthly",
  nextBillLine: "8 Nov 2026 · $39.00 plus sales tax",
  cardLine: "Visa ending 4242, expires 08/28",
  priceLockedUntil: null,
  ...over,
});

describe("PlanSummary", () => {
  it("renders plan, next bill, card with Update card, and cadence help", () => {
    mounted = mount(
      <PlanSummary view={plan()} updateCardHref="/hub/billing/portal" />,
    );
    const t = text(mounted);
    expect(t).toContain("Standard website, billed monthly");
    expect(t).toContain("8 Nov 2026 · $39.00 plus sales tax");
    expect(t).toContain("Visa ending 4242, expires 08/28");
    expect(t).toContain(
      "Want to switch between monthly and yearly billing? Ask Support",
    );
    expect(t).not.toContain("Price lock");
    const a = links(mounted).find((l) => l.textContent === "Update card");
    expect(a?.getAttribute("href")).toBe("/hub/billing/portal");
    expect(a?.className).toContain("h-8");
    expect(mounted.container.querySelector("dl")).not.toBeNull();
  });

  it("shows the price lock only when set", () => {
    mounted = mount(
      <PlanSummary
        view={plan({ priceLockedUntil: "8 Oct 2028" })}
        updateCardHref="/p"
      />,
    );
    expect(text(mounted)).toContain("Your prices are locked until 8 Oct 2028.");
  });
});

const items: ItemsView = {
  rows: [
    {
      name: "Standard plan",
      sub: "Hosting, support and 10 pages",
      amountLabel: "$39/mo",
      paused: false,
      note: null,
    },
    {
      name: "Testimonials",
      sub: null,
      amountLabel: "$9/mo",
      paused: true,
      note: null,
    },
    {
      name: "Website build, payment 3 of 6",
      sub: null,
      amountLabel: "$250/mo",
      paused: false,
      note: "Ends after 8 Mar 2027.",
    },
  ],
  monthlyTotalCents: 15900,
};

describe("SubscriptionItemsList", () => {
  it("renders rows, paused badge, note, total and Manage add-ons", () => {
    mounted = mount(
      <SubscriptionItemsList view={items} manageHref="/hub/add-ons" />,
    );
    const lis = mounted.container.querySelectorAll("li");
    expect(lis).toHaveLength(4);
    expect(lis[0]?.textContent).toContain("Hosting, support and 10 pages");
    expect(lis[0]?.textContent).toContain("$39/mo");
    expect(lis[0]?.textContent).not.toContain("Paused");
    expect(lis[1]?.textContent).toContain("Paused");
    expect(lis[2]?.textContent).toContain("Ends after 8 Mar 2027.");
    expect(text(mounted)).toContain("Monthly total · $159.00 plus sales tax");
    const a = links(mounted).find((l) => l.textContent === "Manage add-ons");
    expect(a?.getAttribute("href")).toBe("/hub/add-ons");
  });
});

const invoices = (n: number): InvoiceRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `in_${i}`,
    date: `${i + 1} Oct 2026`,
    number: `Support-${String(42 - i).padStart(4, "0")}`,
    whatFor: "Monthly plan, November",
    amountCents: 153900,
    taxCents: 0,
    status: (["paid", "due", "unpaid", "refunded", "void"] as const)[i % 5]!,
    href:
      i === 1 ? "/test-pay/invoice/in_1" : `https://invoice.stripe.com/i/${i}`,
  }));

describe("InvoiceTable", () => {
  it("renders a table with headers, 12 rows, then Show more", () => {
    mounted = mount(<InvoiceTable rows={invoices(15)} />);
    const table = mounted.container.querySelector("table");
    expect(table).not.toBeNull();
    const heads = Array.from(table!.querySelectorAll("thead th")).map(
      (th) => th.textContent,
    );
    expect(heads.slice(0, 5)).toEqual([
      "Date",
      "Invoice",
      "What for",
      "Amount",
      "Status",
    ]);
    const hidden = table!.querySelectorAll("thead th")[5];
    expect(hidden?.textContent).toBe("Invoice");
    expect(hidden?.querySelector(".sr-only")).not.toBeNull();
    expect(table!.querySelectorAll("tbody tr")).toHaveLength(12);
    expect(text(mounted)).toContain("$1,539.00");
    expect(text(mounted)).toContain("incl. $0.00 tax");
    const more = Array.from(mounted.container.querySelectorAll("button")).find(
      (b) => b.textContent === "Show more",
    );
    expect(more).toBeDefined();
    act(() => more!.click());
    expect(table!.querySelectorAll("tbody tr")).toHaveLength(15);
    expect(
      Array.from(mounted.container.querySelectorAll("button")).some(
        (b) => b.textContent === "Show more",
      ),
    ).toBe(false);
  });

  it("names each link and marks off-platform links as opening Stripe", () => {
    mounted = mount(<InvoiceTable rows={invoices(2)} />);
    const tableLinks = Array.from(
      mounted.container.querySelectorAll("table a"),
    );
    expect(tableLinks[0]?.getAttribute("aria-label")).toBe(
      "View invoice Support-0042 from 1 Oct 2026 (opens Stripe)",
    );
    expect(tableLinks[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(tableLinks[1]?.getAttribute("aria-label")).toBe(
      "View invoice Support-0041 from 2 Oct 2026",
    );
  });

  it("maps every status to a badge with its word", () => {
    mounted = mount(<InvoiceTable rows={invoices(5)} />);
    const rows = mounted.container.querySelectorAll("table tbody tr");
    const words = Array.from(rows).map(
      (r) => r.querySelectorAll("td")[4]?.textContent,
    );
    expect(words).toEqual(["Paid", "Due", "Unpaid", "Refunded", "Cancelled"]);
  });

  it("renders cards below 768px as list items", () => {
    mounted = mount(<InvoiceTable rows={invoices(3)} />);
    expect(mounted.container.querySelectorAll("ul > li")).toHaveLength(3);
  });

  it("renders the empty state with no rows", () => {
    mounted = mount(<InvoiceTable rows={[]} />);
    expect(mounted.container.querySelector("table")).toBeNull();
    expect(text(mounted)).toContain("No invoices yet");
    expect(text(mounted)).toContain(
      "Your invoices show here after your first payment. Each one has a PDF to download for your records.",
    );
    expect(
      mounted.container.querySelector("svg.lucide-receipt"),
    ).not.toBeNull();
  });
});
