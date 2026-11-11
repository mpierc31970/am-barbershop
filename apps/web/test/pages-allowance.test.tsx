// @vitest-environment jsdom
// 11-28 (DASH-08; D185, D273; UI-SPEC "Page allowance and page packs"): the Pages tab count,
// the "Doesn't count" rows, the at-limit panel per role, the server refusal in the Add page
// row and the one-click pages pack purchase through ChargeConfirmDialog.
import { pagesFullCopy, pagesFullMemberCopy } from "@cds/core/content";
import { ToastRegion } from "@cds/ui/hub";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const createPageAction = vi.hoisted(() => vi.fn());
vi.mock("../app/actions/pages", () => ({ createPageAction }));
const billing = vi.hoisted(() => ({
  packPreviewAction: vi.fn(),
  buyPackAction: vi.fn(),
}));
vi.mock("../app/actions/billing", () => billing);
vi.mock("../app/actions/page-settings", () => ({
  openNotFoundPageAction: vi.fn(),
}));

const { PagesTab } = await import("../app/(platform)/hub/website/PagesTab");
const { AddPageRow } = await import("../app/(platform)/hub/website/AddPageRow");
const { PagePacksRemove } =
  await import("../app/(platform)/hub/settings/PagePacksRemove");
const { PagesFullPanel, PAGES_FULL_COPY } =
  await import("../app/(platform)/hub/website/PagesFullPanel");

const IMPERSONATING_BUY =
  "You're viewing as CDS staff, so buying is turned off. Only the owner can add pages.";
const PAUSED_NO_ADD =
  "Your add-ons are paused until your overdue bill is paid. Pay it first, then add new ones.";
const UNPRICED = "We're finalising this price. You'll be able to add it soon.";
const ALLOWANCE_HELP = "Policy, 404, password and landing pages don't count.";

function page(over: Record<string, unknown>) {
  return {
    id: "p",
    slug: "x",
    title: "X",
    status: "published",
    published_at: "2026-09-12T14:14:00Z",
    has_unpublished_changes: false,
    kind: "builder",
    password_protected: false,
    seo: {},
    previous_slugs: [],
    ...over,
  } as never;
}

const OWNER = {
  role: "owner",
  impersonating: false,
  paused: false,
  unpriced: false,
  priceLabel: "$10/mo",
};

function pages(n: number) {
  return Array.from({ length: n }, (_, i) =>
    page({
      id: `p${i}`,
      slug: i === 0 ? "home" : `page-${i}`,
      title: i === 0 ? "Home" : `Page ${i}`,
    }),
  );
}

function ssr(props: Partial<Parameters<typeof PagesTab>[0]>) {
  return renderToStaticMarkup(
    <ToastRegion>
      <PagesTab pages={pages(7)} reserved={[]} {...props} />
    </ToastRegion>,
  );
}

beforeAll(() => {
  // jsdom has no <dialog> modal API.
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

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Pages tab count (D273)", () => {
  it("7 of 10: the count, ALLOWANCE-HELP, Add page and no warning", () => {
    const html = ssr({ usage: { used: 7, allowance: 10 }, who: OWNER });
    expect(html).toContain("7 of 10 pages");
    expect(html).toContain(ALLOWANCE_HELP.replace("'", "&#x27;"));
    expect(html).toContain("Add page");
    expect(html).not.toContain("You&#x27;ve used all");
  });

  it("rows that don't count say so, with the screen-reader reason", () => {
    const html = ssr({
      pages: [
        page({ id: "h", slug: "home", title: "Home" }),
        page({
          id: "s",
          slug: "secret",
          title: "Secret",
          password_protected: true,
        }),
      ],
      usage: { used: 1, allowance: 10 },
      who: OWNER,
    });
    expect(html).toContain("Doesn&#x27;t count");
    expect(html).toContain("Doesn&#x27;t count toward your page allowance");
  });

  it("the count tracks the allowance (15 with one pack)", () => {
    const html = ssr({ usage: { used: 11, allowance: 15 }, who: OWNER });
    expect(html).toContain("11 of 15 pages");
  });
});

describe("At the limit (PagesFullPanel)", () => {
  it("owner: the D185 sentence and one button", () => {
    const html = ssr({ usage: { used: 10, allowance: 10 }, who: OWNER });
    expect(html).toContain(pagesFullCopy(10).replace("You've", "You&#x27;ve"));
    expect(html).toContain("Add 5 more pages, $10/mo");
    expect(html).not.toMatch(/>Add page</);
  });

  it("owner: the sentence quotes the catalog price, never a typed one (WR-C02)", () => {
    const html = ssr({
      usage: { used: 10, allowance: 10 },
      who: { ...OWNER, priceLabel: "$12/mo" },
    });
    expect(html).toContain("Add 5 more pages for $12/mo.");
    expect(html).not.toContain("$10");
  });

  it("unpriced owner: no price in the sentence (WR-C02)", () => {
    const html = ssr({
      usage: { used: 10, allowance: 10 },
      who: { ...OWNER, unpriced: true, priceLabel: null },
    });
    expect(html).not.toContain("more pages for");
    expect(html).not.toContain("$");
  });

  it("editor and admin: member copy, no button", () => {
    for (const role of ["editor", "admin"]) {
      const html = ssr({
        usage: { used: 10, allowance: 10 },
        who: { ...OWNER, role },
      });
      expect(html).toContain(
        pagesFullMemberCopy(10).replace("You've", "You&#x27;ve"),
      );
      expect(html).not.toContain("Add 5 more pages");
    }
  });

  it("impersonating staff: IMPERSONATING-BUY, no button", () => {
    const html = ssr({
      usage: { used: 10, allowance: 10 },
      who: { ...OWNER, impersonating: true },
    });
    expect(html).toContain(IMPERSONATING_BUY.replace("You're", "You&#x27;re"));
    expect(html).not.toContain("Add 5 more pages");
  });

  it("paused billing: PAUSED-NO-ADD and Update card and pay", () => {
    const html = ssr({
      usage: { used: 10, allowance: 10 },
      who: { ...OWNER, paused: true },
    });
    expect(html).toContain(PAUSED_NO_ADD);
    expect(html).toContain("Update card and pay");
    expect(html).not.toContain("Add 5 more pages,");
  });

  it("unpriced pack: aria-disabled button with UNPRICED-ADDON", () => {
    m = mount(
      <PagesFullPanel
        role="owner"
        impersonating={false}
        paused={false}
        unpriced
        priceLabel={null}
        allowance={10}
        onBuy={vi.fn()}
      />,
    );
    const b = m.container.querySelector("button");
    expect(b?.getAttribute("aria-disabled")).toBe("true");
    expect(m.container.textContent).toContain(UNPRICED);
  });

  it("copy ids are exported for the how-to", () => {
    expect(PAGES_FULL_COPY.impersonating).toBe(IMPERSONATING_BUY);
  });
});

function mountRow(over: Partial<Parameters<typeof AddPageRow>[0]> = {}) {
  m = mount(
    <ToastRegion>
      <AddPageRow
        count={9}
        limit={10}
        taken={["home"]}
        reserved={[]}
        navTopCount={2}
        who={OWNER}
        {...over}
      >
        <p>list</p>
      </AddPageRow>
    </ToastRegion>,
  );
  return m;
}

describe("Server refusal keeps the typed title", () => {
  it("page_limit shows PAGES-FULL inline and the owner link", async () => {
    mountRow();
    click(button(m!.container, "Add page"));
    const title = m!.container.querySelector(
      "#new-page-title",
    ) as HTMLInputElement;
    typeInto(title, "Our story");
    createPageAction.mockResolvedValue({
      ok: false,
      code: "page_limit",
      message: pagesFullCopy(10),
      allowance: 10,
    });
    click(button(m!.container, "Create page"));
    await flush();
    expect(
      (m!.container.querySelector("#new-page-title") as HTMLInputElement).value,
    ).toBe("Our story");
    const alert = m!.container.querySelector('[role="alert"], [role="status"]');
    expect(m!.container.textContent).toContain(pagesFullCopy(10));
    expect(alert).not.toBeNull();
    expect(button(m!.container, "Add 5 more pages")).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("an editor gets the member copy and no buy link", async () => {
    mountRow({ who: { ...OWNER, role: "editor" } });
    click(button(m!.container, "Add page"));
    typeInto(m!.container.querySelector("#new-page-title"), "Our story");
    createPageAction.mockResolvedValue({
      ok: false,
      code: "page_limit",
      message: pagesFullCopy(10),
      allowance: 10,
    });
    click(button(m!.container, "Create page"));
    await flush();
    expect(m!.container.textContent).toContain(pagesFullMemberCopy(10));
    expect(button(m!.container, "Add 5 more pages")).toBeNull();
  });
});

const PREVIEW_PAID = {
  title: "Add 5 more pages?",
  what: "Your site can have 15 pages.",
  todayCents: 323,
  todayLabel: "For the rest of October",
  thenText: "$10/mo on your monthly bill",
  cardLine: "Plus sales tax. Charged to Visa ending 4242.",
  confirmLabel: "Add and pay $3.23",
  token: "tok-1",
};

describe("Buy the pack (P10 purchase path)", () => {
  it("owner click -> preview -> confirm -> buy -> toast and refresh", async () => {
    billing.packPreviewAction.mockResolvedValue({
      ok: true,
      preview: PREVIEW_PAID,
    });
    billing.buyPackAction.mockResolvedValue({
      ok: true,
      toast: "5 pages added. You can now have 15.",
    });
    mountRow({ count: 10, limit: 10 });
    expect(button(m!.container, "Add page")).toBeNull();
    click(button(m!.container, "Add 5 more pages, $10/mo"));
    await flush();
    expect(billing.packPreviewAction).toHaveBeenCalledWith("pages-5");
    expect(document.body.textContent).toContain("Add 5 more pages?");
    expect(document.body.textContent).toContain("Today · $3.23");
    const confirm = button(document.body, "Add and pay $3.23");
    click(confirm);
    // A second click while pending is ignored.
    click(confirm);
    await flush();
    expect(billing.buyPackAction).toHaveBeenCalledTimes(1);
    expect(billing.buyPackAction).toHaveBeenCalledWith("pages-5", "tok-1");
    expect(document.body.textContent).toContain(
      "5 pages added. You can now have 15.",
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("before checkout the dialog says it joins the order", async () => {
    billing.packPreviewAction.mockResolvedValue({
      ok: true,
      preview: {
        ...PREVIEW_PAID,
        todayCents: 0,
        cardLine: "",
        confirmLabel: "Add 5 pages",
        orderNote: "It joins your order: $10/mo from checkout.",
      },
    });
    mountRow({ count: 10, limit: 10 });
    click(button(m!.container, "Add 5 more pages, $10/mo"));
    await flush();
    expect(document.body.textContent).toContain(
      "It joins your order: $10/mo from checkout.",
    );
    expect(document.body.textContent).not.toContain("Today ·");
  });
});

describe("Settings › Billing: Remove one pages pack", () => {
  const REFUSED =
    "You have 13 pages, more than the 10 you'd have left. Delete 3 pages first, then remove the pack.";

  it("refused in place with PAGES-PACK-REFUSED, no dialog", () => {
    const onRemove = vi.fn();
    m = mount(
      <ToastRegion>
        <PagePacksRemove
          view={{
            qty: 1,
            allowance: 15,
            dropLabel: "$10",
            removeRefusal: REFUSED,
          }}
          onRemove={onRemove}
        />
      </ToastRegion>,
    );
    click(button(m.container, "Remove one"));
    expect(m.container.textContent).toContain(REFUSED);
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("otherwise the danger confirm: Remove a 5-page pack?", async () => {
    const onRemove = vi.fn(async () => ({
      ok: true as const,
      toast: "5-page pack removed. You can now have 10.",
    }));
    m = mount(
      <ToastRegion>
        <PagePacksRemove
          view={{
            qty: 1,
            allowance: 15,
            dropLabel: "$10",
            removeRefusal: null,
          }}
          onRemove={onRemove}
        />
      </ToastRegion>,
    );
    click(button(m.container, "Remove one"));
    expect(document.body.textContent).toContain("Remove a 5-page pack?");
    expect(document.body.textContent).toContain(
      "You go from 15 pages to 10 and your bill drops by $10 a month, credited for the rest of this month.",
    );
    click(button(document.body, "Remove pack"));
    await flush();
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      "5-page pack removed. You can now have 10.",
    );
  });
});
