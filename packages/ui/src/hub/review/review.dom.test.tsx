// @vitest-environment jsdom
// Launch review components (14-34 choice 6; DOM-10, D172, D26; 14-UI-SPEC "Launch review",
// a11y contract): checklist progress + per-item actions + read mode; key facts with the
// FACTS-EMAIL block; phone check QR role/label, link, phone fallback class; submit panel locked
// (aria-disabled + described reasons), unlocked, sent and resubmit.
import { P14_COPY } from "@cds/core/dns";
import { qrSvg } from "@cds/core/qr";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../test-support/dom";
import {
  KeyFactsConfirm,
  PhoneCheckPanel,
  ReviewChecklist,
  ReviewSubmitPanel,
  compactWeeklyHours,
  hoursRange,
  type ReviewChecklistView,
} from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

const ok = () => Promise.resolve({ ok: true as const, data: null });

function view(over: Partial<ReviewChecklistView> = {}): ReviewChecklistView {
  return {
    items: [
      {
        id: "pages_reviewed",
        label: "Every page looked over",
        done: false,
        at: null,
        count: 3,
        of: 7,
      },
      {
        id: "changes_sent",
        label: "Changes you asked for",
        done: true,
        at: null,
        count: 0,
        of: 0,
      },
      {
        id: "key_facts",
        label: "Your key details confirmed",
        done: true,
        at: "2026-10-12 15:00:00.000Z",
        count: null,
        of: null,
      },
      {
        id: "phone_check",
        label: "Checked on your phone",
        done: false,
        at: null,
        count: null,
        of: null,
      },
      {
        id: "test_form",
        label: "Test form received",
        done: true,
        at: null,
        count: null,
        of: null,
      },
      {
        id: "no_open_requests",
        label: "No open change requests",
        done: true,
        at: null,
        count: 0,
        of: null,
      },
    ],
    done: 4,
    total: 6,
    pages: [
      { id: "p1", title: "Home", path: "/", status: "looks_good" },
      { id: "p2", title: "About us", path: "/about", status: "changed_since" },
      { id: "p3", title: "Contact", path: "/contact", status: "not_looked" },
    ],
    hasForm: true,
    ...over,
  };
}

const ACTIONS = {
  reviewHref: "https://rivera.sites.example/_site/review/start?t=x",
  pageHrefs: { p1: "https://rivera.sites.example/x1" },
  requestsHref: "/hub/support?tab=tickets",
  factsHref: "/hub/review?step=facts",
  phoneHref: "/hub/review?step=phone",
  testFormHref: "https://rivera.sites.example/contact",
  inboxHref: "/hub/inbox",
};

describe("ReviewChecklist", () => {
  it("shows 4 of 6 done with the progressbar and six rows with one action each", () => {
    mounted = mount(
      <ReviewChecklist view={view()} actions={ACTIONS} timeZone="UTC" />,
    );
    const root = mounted.container;
    const bar = root.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuetext")).toBe("4 of 6 done");
    expect(bar.getAttribute("aria-valuenow")).toBe("4");
    expect(root.textContent).toContain("4 of 6 done");
    const rows = root.querySelectorAll("ol > li");
    expect(rows).toHaveLength(6);
    // Reset page wins the sub-line; the review link opens in a new tab.
    const first = root.querySelector('[data-review-item="pages_reviewed"]')!;
    expect(first.textContent).toContain(
      "About us changed after you approved it. Look at it again.",
    );
    const review = first.querySelector("[data-review-action]")!;
    expect(review.getAttribute("target")).toBe("_blank");
    expect(review.textContent).toContain("Review on your preview address");
    // Key facts done: ghost action + date.
    const facts = root.querySelector('[data-review-item="key_facts"]')!;
    expect(facts.textContent).toContain("Confirmed 12 Oct");
    expect(facts.querySelector("a")!.className).toContain("bg-transparent");
    // Test form done -> Open Inbox; no requests -> no action.
    expect(
      root.querySelector('[data-review-item="test_form"] a')!.textContent,
    ).toBe("Open Inbox");
    expect(
      root.querySelector('[data-review-item="no_open_requests"] a'),
    ).toBeNull();
    // Show pages: native details with status words.
    const details = root.querySelector("details")!;
    expect(details.textContent).toContain("Looks good");
    expect(details.textContent).toContain("Changed since");
    expect(details.textContent).toContain("Not looked at");
  });

  it("no form: TESTFORM-NA and no Send a test message", () => {
    mounted = mount(
      <ReviewChecklist view={view({ hasForm: false })} actions={ACTIONS} />,
    );
    const row = mounted.container.querySelector(
      '[data-review-item="test_form"]',
    )!;
    expect(row.textContent).toContain(
      "Your site has no form, so there's nothing to test.",
    );
    expect(row.querySelector("a")).toBeNull();
  });

  it("read mode (Admin): no actions, owner-only Label", () => {
    mounted = mount(
      <ReviewChecklist view={view()} actions={ACTIONS} readOnly />,
    );
    const root = mounted.container;
    expect(root.querySelector("[data-review-action]")).toBeNull();
    expect(root.textContent).toContain(
      "Only the owner can approve the launch.",
    );
    expect(root.querySelector("details a")).toBeNull();
  });
});

describe("KeyFactsConfirm", () => {
  const facts = {
    name: "Rivera Bakery",
    phone: "(512) 555-0100",
    email: "maria@gmail.com",
    emailConfirmed: false,
    address: "1 Main St, Austin, TX 78701",
    hours: "Mon–Fri 9–5",
  };
  const edits = {
    name: "/hub/settings?tab=business&next=x",
    phone: "/hub/settings?tab=business&next=x",
    email: "/hub/settings?tab=email&next=x",
    address: "/hub/settings?tab=business&next=x",
    hours: "/hub/settings?tab=team-hours&next=x",
  };

  it("unconfirmed email blocks Confirm with FACTS-EMAIL and Resend", async () => {
    const onConfirm = vi.fn(ok);
    const onResend = vi.fn(ok);
    mounted = mount(
      <KeyFactsConfirm
        facts={facts}
        editHrefs={edits}
        unconfirmedEmail="maria@gmail.com"
        backHref="/hub/review"
        onConfirm={onConfirm}
        onResend={onResend}
      />,
    );
    const root = mounted.container;
    expect(root.textContent).toContain(
      "Confirm your email address first. We sent the link to maria@gmail.com.",
    );
    expect(root.textContent).toContain("Not confirmed yet");
    const confirm = root.querySelector("[data-confirm-facts]")!;
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    click(confirm);
    await flush();
    expect(onConfirm).not.toHaveBeenCalled();
    click(button(root, "Resend confirmation"));
    await flush();
    expect(onResend).toHaveBeenCalledOnce();
    expect(root.querySelectorAll("dl a")).toHaveLength(5);
  });

  it("confirm calls the action then onConfirmed; a refusal shows its message", async () => {
    const onConfirmed = vi.fn();
    const onConfirm = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "forbidden", message: "Nope." })
      .mockResolvedValueOnce({ ok: true, data: null });
    mounted = mount(
      <KeyFactsConfirm
        facts={{ ...facts, emailConfirmed: true }}
        editHrefs={edits}
        unconfirmedEmail=""
        backHref="/hub/review"
        onConfirm={onConfirm}
        onConfirmed={onConfirmed}
      />,
    );
    const root = mounted.container;
    click(root.querySelector("[data-confirm-facts]"));
    await flush();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain(
      "Nope.",
    );
    expect(onConfirmed).not.toHaveBeenCalled();
    click(root.querySelector("[data-confirm-facts]"));
    await flush();
    expect(onConfirmed).toHaveBeenCalledOnce();
  });

  it("read mode: no Edit, no Confirm", () => {
    mounted = mount(
      <KeyFactsConfirm
        facts={facts}
        editHrefs={edits}
        unconfirmedEmail=""
        backHref="/hub/review"
        onConfirm={ok}
        readOnly
      />,
    );
    const root = mounted.container;
    expect(root.querySelectorAll("dl a")).toHaveLength(0);
    expect(root.querySelector("[data-confirm-facts]")).toBeNull();
    expect(root.textContent).toContain(
      "Only the owner can approve the launch.",
    );
  });
});

describe("PhoneCheckPanel", () => {
  const link = "https://rivera.sites.example/%5Fsite/review/start?t=v1.abc";
  const label = "QR code that opens your site in review mode on a phone";

  it("renders the QR as role=img with its label, the link, and the phone fallback class", async () => {
    const onChecked = vi.fn(ok);
    const onDone = vi.fn();
    mounted = mount(
      <PhoneCheckPanel
        svg={qrSvg(link, { px: 160, label })}
        svgLarge={qrSvg(link, { px: 200, label })}
        shortLink={link}
        backHref="/hub/review"
        onChecked={onChecked}
        onDone={onDone}
      />,
    );
    const root = mounted.container;
    const imgs = root.querySelectorAll('svg[role="img"]');
    expect(imgs).toHaveLength(2);
    expect(imgs[0]!.getAttribute("aria-label")).toBe(label);
    expect(imgs[0]!.getAttribute("width")).toBe("160");
    expect(imgs[1]!.getAttribute("width")).toBe("200");
    expect(root.querySelector("[data-review-link]")!.textContent).toBe(link);
    expect(root.textContent).toContain(
      "The link works for 60 minutes and only for you.",
    );
    // >= 640px block hidden on phones; the phone block hidden from 640px.
    expect(root.querySelector("[data-phone-desktop]")!.className).toContain(
      "hidden",
    );
    expect(root.querySelector("[data-phone-desktop]")!.className).toContain(
      "sm:flex",
    );
    const mobile = root.querySelector("[data-phone-mobile]")!;
    expect(mobile.className).toContain("sm:hidden");
    expect(mobile.textContent).toContain("You're on your phone already.");
    expect(mobile.querySelector("a")!.getAttribute("href")).toBe(link);
    click(root.querySelector("[data-phone-desktop] [data-phone-checked]"));
    await flush();
    expect(onChecked).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("read mode and no link: no QR", () => {
    mounted = mount(
      <PhoneCheckPanel
        svg={null}
        shortLink={null}
        backHref="/hub/review"
        onChecked={ok}
        readOnly
      />,
    );
    expect(mounted.container.querySelector("svg[role=img]")).toBeNull();
    expect(mounted.container.textContent).toContain(
      "Only the owner can approve the launch.",
    );
  });
});

describe("ReviewSubmitPanel", () => {
  it("locked: aria-disabled with described reasons; click does nothing", async () => {
    const onSubmit = vi.fn(ok);
    mounted = mount(
      <ReviewSubmitPanel
        locked={false}
        reasons={[
          { text: "Finish 2 more items above." },
          {
            text: "Your domain isn't ready yet. Finish connecting it in Settings › Domain.",
            href: "/hub/settings?tab=domain",
          },
        ]}
        domain="riverabakery.com"
        sent={false}
        domainHref="/hub/settings?tab=domain"
        onSubmit={onSubmit}
      />,
    );
    const root = mounted.container;
    expect(root.querySelector("h2")!.textContent).toBe(
      "Your site goes live at riverabakery.com.",
    );
    const btn = root.querySelector("[data-ready-to-launch]")!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    const reasons = root.querySelector(
      `#${CSS.escape(btn.getAttribute("aria-describedby")!)}`,
    )!;
    expect(reasons.textContent).toContain("Finish 2 more items above.");
    expect(reasons.textContent).toContain("Your domain isn't ready yet.");
    click(btn);
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("no domain: the connect heading and link, locked", () => {
    mounted = mount(
      <ReviewSubmitPanel
        locked={false}
        reasons={[]}
        domain={null}
        sent={false}
        domainHref="/hub/settings?tab=domain"
        onSubmit={ok}
      />,
    );
    const root = mounted.container;
    expect(root.querySelector("h2")!.textContent).toBe(
      "Connect your domain to choose where your site goes live.",
    );
    expect(root.querySelector("a")!.textContent).toBe("Connect your domain");
    expect(
      root
        .querySelector("[data-ready-to-launch]")!
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("unlocked: submits and calls onSent; sent replaces the panel", async () => {
    const onSubmit = vi.fn(ok);
    const onSent = vi.fn();
    mounted = mount(
      <ReviewSubmitPanel
        locked={false}
        reasons={[]}
        domain="riverabakery.com"
        sent={false}
        domainHref="/x"
        onSubmit={onSubmit}
        onSent={onSent}
      />,
    );
    const btn = mounted.container.querySelector("[data-ready-to-launch]")!;
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    click(btn);
    await flush();
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSent).toHaveBeenCalledOnce();
    mounted.unmount();
    mounted = mount(
      <ReviewSubmitPanel
        locked={false}
        reasons={[]}
        domain="riverabakery.com"
        sent
        domainHref="/x"
        onSubmit={onSubmit}
      />,
    );
    expect(mounted.container.textContent).toContain(
      "CDS is giving it a final look.",
    );
    expect(mounted.container.querySelector("button")).toBeNull();
  });

  it("sent then edited: RESUBMIT warning and the panel again; read mode has no button", () => {
    mounted = mount(
      <ReviewSubmitPanel
        locked={false}
        reasons={[]}
        domain="riverabakery.com"
        sent
        resubmit={["About us"]}
        domainHref="/x"
        onSubmit={ok}
        readOnly
      />,
    );
    const root = mounted.container;
    expect(root.textContent).toContain(
      "You changed About us after sending. Look at it again so CDS can launch.",
    );
    expect(root.querySelector("button")).toBeNull();
    expect(root.textContent).toContain(
      "Only the owner can approve the launch.",
    );
  });
});

describe("compactWeeklyHours", () => {
  it("joins runs of equal days", () => {
    const open = { open: true, ranges: [{ start: "09:00", end: "17:00" }] };
    const closed = { open: false, ranges: [] };
    expect(
      compactWeeklyHours({
        mon: open,
        tue: open,
        wed: open,
        thu: open,
        fri: open,
        sat: { open: true, ranges: [{ start: "10:00", end: "14:30" }] },
        sun: closed,
      }),
    ).toBe("Mon–Fri 9am–5pm, Sat 10am–2:30pm");
    expect(compactWeeklyHours(null)).toBe("");
  });

  it("WR-E06: am/pm tells 8am–8pm from 8pm–8am; shared halves collapse", () => {
    expect(hoursRange("08:00", "20:00")).toBe("8am–8pm");
    expect(hoursRange("20:00", "08:00")).toBe("8pm–8am");
    expect(hoursRange("09:00", "11:30")).toBe("9–11:30am");
    expect(hoursRange("13:00", "17:00")).toBe("1–5pm");
    expect(hoursRange("00:00", "06:00")).toBe("12–6am");
    expect(hoursRange("12:00", "14:00")).toBe("12–2pm");
    expect(hoursRange("17:00", "24:00")).toBe("5pm–12am");
  });
});

describe("WR-E01: a thrown server action shows ERR_GENERIC", () => {
  it("PhoneCheckPanel: I've checked it on my phone rejecting shows the error, no onDone", async () => {
    const onChecked = vi.fn(async () => {
      throw new Error("network");
    });
    const onDone = vi.fn();
    mounted = mount(
      <PhoneCheckPanel
        svg={qrSvg("https://rivera.sites.example/x", { px: 160, label: "QR" })}
        shortLink="https://rivera.sites.example/x"
        backHref="/hub/review"
        onChecked={onChecked}
        onDone={onDone}
      />,
    );
    click(
      mounted.container.querySelector(
        "[data-phone-desktop] [data-phone-checked]",
      ),
    );
    await flush();
    expect(onChecked).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain(P14_COPY.ERR_GENERIC);
  });
});
