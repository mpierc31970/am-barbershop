// @vitest-environment jsdom
// 14-31: Settings › Domain (DOM-02..05; 14-UI-SPEC "Settings › Domain"; D-UI-P14-6,
// D-UI-P14-28; T-14-31-01, T-14-31-03). The pure view model for every owner domain state (tone,
// sentence, at most one primary, Admin read-only, poll, tab count), the server-rendered panel for
// S0 and S3 (copy present), the Admin render with no owner buttons, and the status poller (only
// in checking/waiting, only while the page is visible).
import { P14_COPY } from "@cds/core/dns";
import type { OwnerDomainState, OwnerDomainView } from "@cds/db";
import { ToastRegion } from "@cds/ui/hub";
import type { ReactNode } from "react";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../../packages/ui/src/test-support/dom";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: nav.refresh, replace: vi.fn() }),
  usePathname: () => "/hub/settings",
  useSearchParams: () => new URLSearchParams(),
}));
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("@cds/db", () => ({ ownerDomainView: vi.fn() }));
const actions = vi.hoisted(() => ({
  connectDomainAction: vi.fn(),
  uploadZoneFileAction: vi.fn(),
  acknowledgeFindingAction: vi.fn(),
  checkNameserversAction: vi.fn(),
  sendStepsAction: vi.fn(),
  useDifferentDomainAction: vi.fn(),
  setPrimaryChoiceAction: vi.fn(),
  domainStatusAction: vi.fn(),
}));
vi.mock("../app/actions/domain", () => actions);

const { buildDomainView, domainTabCount, sentenceText, domainMark } =
  await import("../app/(platform)/hub/settings/domain-view");
const { DomainPanel } =
  await import("../app/(platform)/hub/settings/DomainPanel");
const { DomainStatusPoller } =
  await import("../app/(platform)/hub/settings/DomainStatusPoller");

const NS = ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"];

function view(over: Partial<OwnerDomainView> = {}): OwnerDomainView {
  return {
    state: "none",
    domain: "riverabakery.com",
    previewHost: "rivera.sites.connectionsdesignstudios.com",
    registrar: { id: "godaddy", name: "GoDaddy" },
    expiresAt: "2027-03-03T00:00:00.000Z",
    expiry: "ok",
    email: { provider: "Google Workspace", count: 2 },
    findings: [],
    records: [
      {
        group: "email",
        type: "MX",
        name: "@",
        value: "aspmx.l.google.com",
        priority: 10,
        status: "copied",
      },
      {
        group: "site",
        type: "A",
        name: "@",
        value: "192.0.2.10",
        status: "copied",
      },
    ],
    nameservers: NS,
    oldNameservers: ["ns1.domaincontrol.com", "ns2.domaincontrol.com"],
    lastCheckedAt: null,
    waitingSince: null,
    nsSlow: false,
    steps: [],
    primaryChoice: "apex",
    canAct: true,
    history: null,
    ...over,
  } as OwnerDomainView;
}

const ALL: OwnerDomainState[] = [
  "closed",
  "none",
  "checking",
  "findings",
  "nameservers",
  "waiting",
  "connected",
  "finishing",
  "live",
  "switch_back",
  "lost",
];

describe("domain-view: every state (14-31 choice 2)", () => {
  const cases: [OwnerDomainState, string, string][] = [
    ["closed", "none", P14_COPY.DOM_CLOSED],
    [
      "none",
      "none",
      "Your site is on its preview address, rivera.sites.connectionsdesignstudios.com.",
    ],
    ["checking", "checking", "Checking riverabakery.com."],
    [
      "nameservers",
      "your-turn",
      "Every record is copied. Next: change your nameservers.",
    ],
    ["waiting", "waiting", "Waiting for your nameservers to change."],
    [
      "connected",
      "ready",
      "Ready. Goes live at riverabakery.com when Support approves your launch.",
    ],
    ["finishing", "finishing", P14_COPY.LAUNCH_FINISHING],
    ["live", "live", "Your site is live at riverabakery.com."],
    [
      "switch_back",
      "broken",
      "Switch your nameservers back. Your email is safer there.",
    ],
    ["lost", "broken", "riverabakery.com no longer points to us."],
  ];

  it.each(cases)("%s: tone %s and its one sentence", (state, tone, text) => {
    const m = buildDomainView(view({ state }));
    expect(m.tone).toBe(tone);
    expect(sentenceText(m.sentence)).toBe(text);
  });

  it("bolds the domain or preview host in the status sentence", () => {
    const live = buildDomainView(view({ state: "live" }));
    expect(live.sentence.find((r) => r.strong)?.text).toBe("riverabakery.com");
    expect(live.link).toEqual({
      href: "https://riverabakery.com",
      label: "View site",
    });
    const www = buildDomainView(view({ state: "live", primaryChoice: "www" }));
    expect(www.mainHost).toBe("www.riverabakery.com");
    const s0 = buildDomainView(view({ state: "none" }));
    expect(s0.sentence.find((r) => r.strong)?.text).toBe(
      "rivera.sites.connectionsdesignstudios.com",
    );
  });

  it("findings: owner things are count-aware 'Your turn'; Support-only is 'Support is reviewing'", () => {
    const one = buildDomainView(
      view({
        state: "findings",
        findings: [
          { kind: "dnssec", registrar: "GoDaddy", hardBlock: true },
          { kind: "cds_review", registrar: "GoDaddy", hardBlock: false },
        ],
      }),
    );
    expect(one.tone).toBe("your-turn");
    expect(sentenceText(one.sentence)).toBe(
      "One thing to do before riverabakery.com can switch.",
    );
    expect(one.secondary).toContain("check_again");
    const two = buildDomainView(
      view({
        state: "findings",
        findings: [
          { kind: "spf", registrar: "GoDaddy", count: 2, hardBlock: true },
          {
            kind: "email_forwarding",
            registrar: "Namecheap",
            ackKey: "G5:email_forwarding",
            hardBlock: false,
          },
        ],
      }),
    );
    expect(sentenceText(two.sentence)).toBe(
      "2 things to do before riverabakery.com can switch.",
    );
    const cds = buildDomainView(
      view({
        state: "findings",
        findings: [
          {
            kind: "cds_review",
            registrar: "GoDaddy",
            count: 1,
            hardBlock: false,
          },
        ],
      }),
    );
    expect(cds.tone).toBe("cds");
    expect(sentenceText(cds.sentence)).toBe(
      "Support is reviewing one record with you. Usually within 1 business day.",
    );
  });

  it("at most one primary action in every state (D-UI-P14-6); S0 and S3 have it", () => {
    for (const state of ALL) {
      const m = buildDomainView(view({ state }));
      expect(m.secondary).not.toContain(m.primary ?? "-");
      expect(typeof m.primary === "string" || m.primary === null).toBe(true);
    }
    expect(buildDomainView(view({ state: "none" })).primary).toBe(
      "check_domain",
    );
    expect(buildDomainView(view({ state: "nameservers" })).primary).toBe(
      "ive_changed",
    );
    expect(buildDomainView(view({ state: "waiting" })).primary).toBeNull();
  });

  it("Admin reads: no primary, links only, DOMAIN-ADMIN-READ (T-14-31-01)", () => {
    for (const state of ALL) {
      const m = buildDomainView(view({ state, canAct: false, nsSlow: true }));
      expect(m.readOnly).toBe(true);
      expect(m.primary).toBeNull();
      for (const a of m.secondary) {
        expect(["dns_records", "view_site", "how_to_renew"]).toContain(a);
      }
      if (state !== "closed") expect(m.adminNote).toBe(P14_COPY.DOM_ADMIN_READ);
    }
  });

  it("S6 live sends a domain move to Support, never self-service (D-UI-P14-28)", () => {
    const m = buildDomainView(view({ state: "live" }));
    expect(m.secondary).toContain("ask_support");
    expect(m.secondary).not.toContain("check_domain");
    expect(m.primary).toBeNull();
  });

  it("expiry overlays S5/S6: 30 days warning, 7 days error with focus", () => {
    const w = buildDomainView(view({ state: "live", expiry: "30d" }));
    expect(w.tone).toBe("renew-soon");
    expect(w.expiry).toEqual({
      tone: "warning",
      text: "Renew riverabakery.com at GoDaddy before 3 Mar, or your site and email stop.",
      focus: false,
    });
    const e = buildDomainView(view({ state: "connected", expiry: "7d" }));
    expect(e.tone).toBe("broken");
    expect(e.expiry?.tone).toBe("error");
    expect(e.focusAlert).toBe(true);
    expect(
      buildDomainView(view({ state: "waiting", expiry: "7d" })).expiry,
    ).toBeNull();
  });

  it("polls only in checking and waiting (T-14-31-03)", () => {
    const polling = ALL.filter(
      (state) => buildDomainView(view({ state })).poll,
    );
    expect(polling).toEqual(["checking", "waiting"]);
  });

  it("'Domain · 1' while the owner has a step or something is broken", () => {
    const OWNER_FINDING = {
      kind: "dnssec",
      registrar: "GoDaddy",
      hardBlock: true,
    } as const;
    const counted = ALL.filter(
      (state) =>
        domainTabCount(view({ state, findings: [OWNER_FINDING] })) === 1,
    );
    expect(counted).toEqual(["findings", "nameservers", "switch_back", "lost"]);
    // WR-D04: a CDS-only review is not the owner's step.
    expect(
      domainTabCount(
        view({
          state: "findings",
          findings: [
            { kind: "cds_review", registrar: "GoDaddy", hardBlock: false },
          ],
        }),
      ),
    ).toBe(0);
    expect(domainTabCount(view({ state: "waiting", nsSlow: true }))).toBe(1);
    expect(domainTabCount(view({ state: "live", expiry: "30d" }))).toBe(1);
    expect(domainTabCount(view({ state: "live" }))).toBe(0);
  });
});

function render(v: OwnerDomainView): string {
  return renderToStaticMarkup(
    <ToastRegion>
      <DomainPanel view={v} model={buildDomainView(v)} />
    </ToastRegion>,
  );
}

function textOf(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
}

describe("DomainPanel server render (14-31 choice 3)", () => {
  it("S0: Connect your domain with DOM-OWN and Check my domain", () => {
    const html = render(view({ state: "none", domain: null }));
    const text = textOf(html);
    expect(text).toContain(P14_COPY.EMPTY_H);
    expect(text).toContain(
      "Your domain stays registered in your name. Support never buys or transfers domains.",
    );
    expect(text).toContain(P14_COPY.BTN_CHECK_DOMAIN);
    expect(text).toContain(P14_COPY.DOM_WHY_NOW);
    expect(html).toContain('data-domain-status="none"');
  });

  it("S3: NS-REPLACE for the registrar, the two nameservers, I've changed them + Send steps", () => {
    const html = render(view({ state: "nameservers" }));
    const text = textOf(html);
    expect(text).toContain(P14_COPY.NS_REPLACE({ registrar: "GoDaddy" }));
    expect(text).toContain(NS[0]);
    expect(text).toContain(NS[1]);
    expect(text).toContain(P14_COPY.BTN_IVE_CHANGED);
    expect(text).toContain(P14_COPY.BTN_SEND_STEPS_SOMEONE);
    expect(text).toContain(P14_COPY.NS_SAFE);
    // One <h2> for the active section (the closed Send steps Dialog carries its own title).
    expect(html.match(/<h2 id="domain-[a-z-]+"/g)).toEqual([
      '<h2 id="domain-nameservers"',
    ]);
  });

  it("Admin S3: the same nameservers, no owner buttons, DOMAIN-ADMIN-READ", () => {
    const html = render(view({ state: "nameservers", canAct: false }));
    const text = textOf(html);
    expect(text).toContain(NS[0]);
    expect(text).toContain(P14_COPY.DOM_ADMIN_READ);
    expect(text).not.toContain(P14_COPY.BTN_IVE_CHANGED);
    expect(text).not.toContain(P14_COPY.BTN_SEND_STEPS_SOMEONE);
  });

  it("Admin S0: no form and no Check my domain", () => {
    const html = render(view({ state: "none", canAct: false }));
    expect(html).not.toContain("<form");
    expect(textOf(html)).not.toContain(P14_COPY.BTN_CHECK_DOMAIN);
    expect(textOf(html)).toContain(P14_COPY.DOM_OWN);
  });

  it("S2: summary, findings with fixes, What we'll copy, zone file disclosure", () => {
    const html = render(
      view({
        state: "findings",
        findings: [
          {
            kind: "email_forwarding",
            registrar: "Namecheap",
            ackKey: "G5:email_forwarding",
            hardBlock: false,
          },
          {
            kind: "mail_incomplete",
            registrar: "GoDaddy",
            provider: "Google Workspace",
            hardBlock: false,
          },
        ],
      }),
    );
    const text = textOf(html);
    expect(text).toContain(
      P14_COPY.EMAIL_FOUND({ provider: "Google Workspace", count: 2 }),
    );
    expect(text).toContain("I understand my email forwarding stops");
    expect(text).toContain("Add your zone file (most complete)");
    expect(html).toMatch(/<details[^>]*open/);
    expect(text).toContain(P14_COPY.BTN_USE_DIFFERENT_DOMAIN);
  });

  it("S6 live: DOM-MOVE-HELP with Ask Support; no connect form", () => {
    const text = textOf(render(view({ state: "live" })));
    expect(text).toContain(P14_COPY.DOM_MOVE_HELP);
    expect(text).toContain(P14_COPY.BTN_ASK_SUPPORT);
    expect(text).not.toContain(P14_COPY.BTN_CHECK_DOMAIN);
  });

  it("S7: the error alert with the old nameservers and I've switched them back", () => {
    const html = render(view({ state: "switch_back" }));
    const text = textOf(html);
    expect(text).toContain(P14_COPY.MISMATCH_T({ registrar: "GoDaddy" }));
    expect(text).toContain("ns1.domaincontrol.com");
    expect(text).toContain(P14_COPY.BTN_SWITCHED_BACK);
    expect(html).toContain("data-focus-once");
  });

  it("S-closed: EmptyState with DOM-CLOSED and no button", () => {
    const html = render(view({ state: "closed", domain: null }));
    expect(textOf(html)).toContain(P14_COPY.DOM_CLOSED);
    expect(html).not.toContain("<button");
  });
});

describe("DomainStatusPoller (14-31 choice 4; T-14-31-03)", () => {
  let mounted: Mounted | null = null;
  let visibility: DocumentVisibilityState = "visible";

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    actions.domainStatusAction.mockReset();
    nav.refresh.mockReset();
  });
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    vi.useRealTimers();
  });

  const v = view({ state: "checking" });

  it("polls every 5 s while visible, refreshes and announces once on a change", async () => {
    actions.domainStatusAction.mockResolvedValue({
      ok: true,
      data: { state: "checking", mark: domainMark(v) },
    });
    mounted = mount(
      <DomainStatusPoller active state="checking" mark={domainMark(v)} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(actions.domainStatusAction).toHaveBeenCalledTimes(1);
    expect(nav.refresh).not.toHaveBeenCalled();
    actions.domainStatusAction.mockResolvedValue({
      ok: true,
      data: { state: "nameservers", mark: "nameservers:2:0:godaddy:0" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    const live = mounted.container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe(P14_COPY.GATE_PASS);
  });

  it("does not poll while hidden, nor outside checking/waiting", async () => {
    visibility = "hidden";
    mounted = mount(
      <DomainStatusPoller active state="waiting" mark={domainMark(v)} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(actions.domainStatusAction).not.toHaveBeenCalled();
    mounted.unmount();
    visibility = "visible";
    mounted = mount(
      <DomainStatusPoller active={false} state="live" mark="live:0:0::0" />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(actions.domainStatusAction).not.toHaveBeenCalled();
    expect(
      mounted.container.querySelector('[data-domain-poller="off"]'),
    ).not.toBeNull();
  });
});

describe("WR-D05: domain islands catch a rejected server action", () => {
  let mounted: Mounted | null = null;
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it("CheckButton shows the generic error and stops spinning", async () => {
    const { CheckButton } =
      await import("../app/(platform)/hub/settings/DomainControls");
    actions.checkNameserversAction.mockReset();
    actions.checkNameserversAction.mockRejectedValue(new Error("network"));
    mounted = mount(
      <ToastRegion>
        <CheckButton label="Check again" from="findings" />
      </ToastRegion>,
    );
    const btn = mounted.container.querySelector("button")!;
    await act(async () => {
      btn.click();
    });
    expect(mounted.container.textContent).toContain(P14_COPY.ERR_GENERIC);
    expect(btn.getAttribute("aria-busy")).not.toBe("true");
  });

  it("PrimaryChoiceIsland reverts the choice and leaves Saving… on a throw", async () => {
    const { PrimaryChoiceIsland } =
      await import("../app/(platform)/hub/settings/DomainControls");
    actions.setPrimaryChoiceAction.mockReset();
    actions.setPrimaryChoiceAction.mockRejectedValue(new Error("skew"));
    mounted = mount(
      <PrimaryChoiceIsland domain="riverabakery.com" value="apex" />,
    );
    const radios = [
      ...mounted.container.querySelectorAll<HTMLInputElement>(
        'input[type="radio"]',
      ),
    ];
    const other = radios.find((r) => !r.checked)!;
    await act(async () => {
      other.click();
    });
    expect(actions.setPrimaryChoiceAction).toHaveBeenCalledTimes(1);
    expect(mounted.container.textContent).toContain(P14_COPY.ERR_GENERIC);
    expect(mounted.container.textContent).not.toContain("Saving…");
    expect(radios.find((r) => r.checked)?.value).not.toBe(other.value);
  });
});
