// @vitest-environment jsdom
// 09-04: @cds/ui/hub/legal presentational components (09-UI-SPEC "Signing screen",
// "Settings › Legal"; CONTEXT A2-Q1, A6-Q2; D216, D287).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { click, flush, mount, type Mounted } from "../../test-support/dom";
import { ToastRegion } from "../Toast";
import { Badge } from "../Badge";
import { AcceptProgress } from "./AcceptProgress";
import {
  AgreementHistoryTable,
  type AgreementHistoryRow,
} from "./AgreementHistoryTable";
import { ConsentCard } from "./ConsentCard";
import { LegalProse } from "./LegalProse";
import { PolicyCard, type PolicyCardProps } from "./PolicyCard";
import { SignaturePanel, type SignaturePanelProps } from "./SignaturePanel";
import { SIGNING_COPY } from "./signing-state";
import {
  SITE_POLICY_COPY,
  SitePolicyPanel,
  type SitePolicyNoticeView,
  type SitePolicyPanelProps,
  type SitePolicyRowView,
} from "./SitePolicyPanel";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const BULLETS = [
  "CDS builds and hosts your site.",
  "You own your words and photos.",
  "Either side can end it with 30 days' notice.",
] as const;

function policyProps(over: Partial<PolicyCardProps> = {}): PolicyCardProps {
  return {
    policyKey: "service-agreement",
    title: "Service Agreement",
    metaLine: "Version 1 · Effective 1 Oct 2026",
    summary: BULLETS,
    bodyHtml: "<h2>Scope</h2><p>Full text.</p>",
    fullTextHref: "/legal/service-agreement/v1",
    checked: false,
    readOnly: false,
    ...over,
  };
}

const NO_ACCEPT_ALL = /accept all|tick all|select all/i;

describe("PolicyCard", () => {
  it("renders the title, meta, exactly the bullets, the disclosure and an unticked box", () => {
    mounted = mount(
      <ol>
        <PolicyCard {...policyProps()} />
      </ol>,
    );
    const c = mounted.container;
    expect(c.querySelector("li")).not.toBeNull();
    expect(c.querySelector("h2")?.textContent).toBe("Service Agreement");
    expect(c.textContent).toContain("Version 1 · Effective 1 Oct 2026");
    const bullets = Array.from(c.querySelectorAll("ul > li")).map(
      (li) => li.textContent,
    );
    expect(bullets).toEqual([...BULLETS]);
    const details = c.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.querySelector("summary")?.textContent).toContain(
      "Read the full text",
    );
    const link = c.querySelector(
      'a[aria-label="Open the Service Agreement in a new tab"]',
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/legal/service-agreement/v1");
    expect(link!.getAttribute("target")).toBe("_blank");
    const box = c.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.closest("label")?.textContent).toBe(
      "I have read and agree to the Service Agreement.",
    );
    expect(c.textContent).not.toMatch(NO_ACCEPT_ALL);
  });

  it("opening the full text never ticks the box", () => {
    const onChange = vi.fn();
    mounted = mount(
      <ol>
        <PolicyCard {...policyProps({ onCheckedChange: onChange })} />
      </ol>,
    );
    const details = mounted.container.querySelector("details")!;
    click(details.querySelector("summary"));
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(onChange).not.toHaveBeenCalled();
    const box = mounted.container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(box.checked).toBe(false);
  });

  it("ticking calls onCheckedChange(true)", () => {
    const onChange = vi.fn();
    mounted = mount(
      <ol>
        <PolicyCard {...policyProps({ onCheckedChange: onChange })} />
      </ol>,
    );
    click(mounted.container.querySelector('input[type="checkbox"]'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("Hide the full text closes the disclosure and focuses its summary", () => {
    mounted = mount(
      <ol>
        <PolicyCard {...policyProps()} />
      </ol>,
    );
    const details = mounted.container.querySelector("details")!;
    act(() => {
      details.open = true;
    });
    const hide = Array.from(details.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Hide the full text",
    );
    expect(hide).toBeDefined();
    click(hide);
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(details.querySelector("summary"));
  });

  it("read-only renders the box disabled and unticked even when checked is passed", () => {
    mounted = mount(
      <ol>
        <PolicyCard {...policyProps({ readOnly: true, checked: true })} />
      </ol>,
    );
    const box = mounted.container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
  });

  it("WR-B07: disabled (signing pending) disables the box and keeps the tick", () => {
    mounted = mount(
      <ol>
        <PolicyCard {...policyProps({ disabled: true, checked: true })} />
      </ol>,
    );
    const box = mounted.container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(true);
  });

  it("shows a What changed line when given", () => {
    mounted = mount(
      <ol>
        <PolicyCard
          {...policyProps({ whatChanged: "Notice period is now 60 days." })}
        />
      </ol>,
    );
    expect(mounted.container.textContent).toContain(
      "What changed: Notice period is now 60 days.",
    );
  });
});

describe("ConsentCard", () => {
  it("renders the meta line and the consent checkbox, never pre-ticked", () => {
    mounted = mount(
      <ConsentCard
        metaLine="Electronic signature consent · Version 1"
        checked={false}
        readOnly={false}
      />,
    );
    const c = mounted.container;
    expect(c.textContent).toContain("Electronic signature consent · Version 1");
    const box = c.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.closest("label")?.textContent).toBe(SIGNING_COPY.consentText);
    expect(c.querySelector("details")).toBeNull();
  });

  it("read-only disables and unticks the box", () => {
    mounted = mount(<ConsentCard metaLine="Consent" checked readOnly />);
    const box = mounted.container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
  });
});

describe("AcceptProgress", () => {
  it("is a labelled progressbar with a visible count", () => {
    mounted = mount(<AcceptProgress done={2} total={5} />);
    const bar = mounted.container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-label")).toBe("Policies accepted");
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
    expect(mounted.container.textContent).toContain("2 of 5 accepted");
    expect(
      mounted.container.querySelector('[aria-live="polite"]'),
    ).not.toBeNull();
  });
});

describe("LegalProse", () => {
  it("renders the given sanitised HTML", () => {
    mounted = mount(<LegalProse html="<h2>Scope</h2><p>Body</p>" />);
    expect(mounted.container.querySelector("h2")?.textContent).toBe("Scope");
    expect(mounted.container.querySelector("p")?.textContent).toBe("Body");
  });
});

function panelProps(
  over: Partial<SignaturePanelProps> = {},
): SignaturePanelProps {
  return {
    consent: {
      metaLine: "Electronic signature consent · Version 1",
      checked: false,
      readOnly: false,
    },
    name: "",
    onBehalfOf: "Rivera Wellness LLC",
    dateLabel: "8 Oct 2026",
    missingBoxes: 2,
    pending: false,
    readOnly: false,
    onSign: vi.fn(),
    focusFirstMissing: vi.fn(),
    ...over,
  };
}

function signButton(c: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(c.querySelectorAll("button")).find((b) =>
    /Sign and accept|Signing…/.test(b.textContent ?? ""),
  );
}

describe("SignaturePanel", () => {
  it("incomplete: aria-disabled, focusable, described by a polite reason; click focuses the first missing item", () => {
    const props = panelProps();
    mounted = mount(<SignaturePanel {...props} />);
    const btn = signButton(mounted.container)!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.hasAttribute("disabled")).toBe(false);
    const reasonId = btn.getAttribute("aria-describedby")!;
    const reason = document.getElementById(reasonId)!;
    expect(reason.getAttribute("aria-live")).toBe("polite");
    expect(reason.textContent).toBe(
      "Tick 2 more boxes and type your name to sign.",
    );
    click(btn);
    expect(props.focusFirstMissing).toHaveBeenCalledTimes(1);
    expect(props.onSign).not.toHaveBeenCalled();
  });

  it("complete: clicking signs once", () => {
    const props = panelProps({ missingBoxes: 0, name: "Ana Rivera" });
    mounted = mount(<SignaturePanel {...props} />);
    const btn = signButton(mounted.container)!;
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    click(btn);
    expect(props.onSign).toHaveBeenCalledTimes(1);
    expect(props.focusFirstMissing).not.toHaveBeenCalled();
  });

  it("an invalid name counts as missing even when every box is ticked", () => {
    mounted = mount(
      <SignaturePanel {...panelProps({ missingBoxes: 0, name: " A " })} />,
    );
    const btn = signButton(mounted.container)!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(mounted.container.textContent).toContain("Type your name to sign.");
  });

  it("pending: Signing…, inputs disabled, no double submit", () => {
    const props = panelProps({
      missingBoxes: 0,
      name: "Ana Rivera",
      pending: true,
      consent: { metaLine: "Consent", checked: true, readOnly: false },
    });
    mounted = mount(<SignaturePanel {...props} />);
    const btn = signButton(mounted.container)!;
    expect(btn.textContent).toContain("Signing…");
    const input = mounted.container.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    const box = mounted.container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(true);
    click(btn);
    expect(props.onSign).not.toHaveBeenCalled();
  });

  it("the name field is labelled, never pre-filled and has the signing attributes", () => {
    mounted = mount(<SignaturePanel {...panelProps()} />);
    const input = mounted.container.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement;
    const label = mounted.container.querySelector(`label[for="${input.id}"]`);
    expect(label?.textContent).toBe("Your full legal name");
    expect(input.value).toBe("");
    expect(input.getAttribute("autocomplete")).toBe("name");
    expect(input.getAttribute("autocapitalize")).toBe("words");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(mounted.container.textContent).toContain(SIGNING_COPY.nameHelper);
  });

  it("the signing statement follows the typed name", () => {
    mounted = mount(<SignaturePanel {...panelProps()} />);
    expect(mounted.container.textContent).toContain(
      "You're signing for Rivera Wellness LLC on 8 Oct 2026.",
    );
    mounted.unmount();
    mounted = mount(<SignaturePanel {...panelProps({ name: "Ana Rivera" })} />);
    expect(mounted.container.textContent).toContain(
      "Ana Rivera, you're signing for Rivera Wellness LLC on 8 Oct 2026. The time and your IP address are recorded with your signature.",
    );
  });

  it("renders the error inside an alert region above the button", () => {
    mounted = mount(
      <SignaturePanel {...panelProps({ error: "We couldn't record it." })} />,
    );
    const alert = mounted.container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("We couldn't record it.");
    const btn = signButton(mounted.container)!;
    expect(
      alert.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("read-only: no button, every input disabled and unticked", () => {
    mounted = mount(
      <SignaturePanel
        {...panelProps({
          readOnly: true,
          name: "Ana Rivera",
          consent: { metaLine: "Consent", checked: true, readOnly: true },
        })}
      />,
    );
    expect(signButton(mounted.container)).toBeUndefined();
    const inputs = Array.from(mounted.container.querySelectorAll("input"));
    expect(inputs.length).toBeGreaterThan(0);
    for (const i of inputs) expect(i.disabled).toBe(true);
    const box = mounted.container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(box.checked).toBe(false);
    const text = mounted.container.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement;
    expect(text.value).toBe("");
    expect(mounted.container.textContent).not.toMatch(NO_ACCEPT_ALL);
  });
});

const ROWS: AgreementHistoryRow[] = [
  {
    id: "s2",
    dateLabel: "1 Jan 2027",
    timeLabel: "9:02 am",
    signerName: "Ana Rivera",
    signerEmail: "ana@example.com",
    items: ["Service Agreement · version 2"],
    typeLabel: "Updated terms",
    downloadHref: "/hub/agreement/download/s2",
    downloadAriaLabel: "Download the agreement signed 1 Jan 2027",
  },
  {
    id: "s1",
    dateLabel: "8 Oct 2026",
    timeLabel: "2:14 pm",
    signerName: "Ana Rivera",
    signerEmail: "ana@example.com",
    items: ["Service Agreement · version 1", "Terms of Service · version 1"],
    typeLabel: "First signing",
    downloadHref: "/hub/agreement/download/s1",
    downloadAriaLabel: "Download the agreement signed 8 Oct 2026",
  },
];

describe("AgreementHistoryTable", () => {
  it("renders a table with the headers and dated download names, plus a card list", () => {
    mounted = mount(<AgreementHistoryTable rows={ROWS} />);
    const table = mounted.container.querySelector("table")!;
    const headers = Array.from(table.querySelectorAll("th")).map((th) =>
      th.textContent?.trim(),
    );
    expect(headers).toEqual([
      "Signed",
      "Signed by",
      "What was signed",
      "Type",
      "Copy",
    ]);
    expect(table.querySelector("thead th:last-child")?.className).toContain(
      "sr-only",
    );
    const links = Array.from(table.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("aria-label"))).toEqual([
      "Download the agreement signed 1 Jan 2027",
      "Download the agreement signed 8 Oct 2026",
    ]);
    expect(links[0]!.getAttribute("href")).toBe("/hub/agreement/download/s2");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
    const cards = mounted.container.querySelectorAll(
      '[data-layout="cards"] > li',
    );
    expect(cards).toHaveLength(2);
    expect(cards[1]!.textContent).toContain("Terms of Service · version 1");
    expect(cards[1]!.querySelector("a")?.getAttribute("aria-label")).toBe(
      "Download the agreement signed 8 Oct 2026",
    );
  });

  it("renders nothing for zero rows", () => {
    mounted = mount(<AgreementHistoryTable rows={[]} />);
    expect(mounted.container.innerHTML).toBe("");
  });
});

describe("Badge legal tones", () => {
  it("signed: success on tint", () => {
    mounted = mount(<Badge tone="signed">Signed</Badge>);
    const b = mounted.container.firstElementChild!;
    expect(b.className).toContain("bg-hub-success-tint");
    expect(b.className).toContain("text-hub-success");
    expect(b.textContent).toBe("Signed");
  });
  it("not-signed: the needed colours", () => {
    mounted = mount(<Badge tone="not-signed">Not signed</Badge>);
    const b = mounted.container.firstElementChild!;
    expect(b.className).toContain("bg-hub-warning-tint");
    expect(b.className).toContain("text-hub-warning");
  });
  it("update-waiting: warning on tint with a 14px icon", () => {
    mounted = mount(<Badge tone="update-waiting">Update waiting</Badge>);
    const b = mounted.container.firstElementChild!;
    expect(b.className).toContain("bg-hub-warning-tint");
    const svg = b.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("width")).toBe("14");
    expect(b.textContent).toBe("Update waiting");
  });
});

// 09-23: SitePolicyPanel (Settings › Legal section 2; D217, D287; CONTEXT A5-Q3).
describe("SitePolicyPanel", () => {
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

  const WARN: SitePolicyNoticeView = {
    key: "warn-legal",
    tone: "warning",
    title: "CDS is not a law firm",
    text: "CDS gives no legal advice.",
    link: null,
  };
  const ROWS: SitePolicyRowView[] = [
    {
      page: "privacy",
      label: "Privacy policy",
      badge: { tone: "draft", text: "Not published" },
      covers: "Covers: Contact forms · Analytics",
    },
    {
      page: "terms",
      label: "Terms",
      badge: { tone: "draft", text: "Not published" },
      covers: null,
    },
  ];

  function props(
    over: Partial<SitePolicyPanelProps> = {},
  ): SitePolicyPanelProps {
    return {
      rows: ROWS,
      notices: [WARN],
      canPublish: true,
      readOnlyReason: null,
      published: false,
      updateWaiting: false,
      ackedLine: null,
      missingInputs: false,
      onPreview: vi.fn(async () => ({
        title: "Privacy policy",
        html: "<h2>Who we are</h2><p>Rivera Bakery</p>",
      })),
      onPublish: vi.fn(async () => ({ ok: true })),
      viewHrefs: { privacy: null, terms: null },
      ...over,
    };
  }

  function render(p: SitePolicyPanelProps) {
    mounted = mount(
      <ToastRegion>
        <SitePolicyPanel {...p} />
      </ToastRegion>,
    );
    return mounted.container;
  }

  function publishButton(c: HTMLElement) {
    return Array.from(c.querySelectorAll("button")).find((b) =>
      /Publish/.test(b.textContent ?? ""),
    );
  }

  it("always shows the legal warning first, for every caller", () => {
    for (const p of [
      props(),
      props({
        canPublish: false,
        readOnlyReason: "Only the site owner can publish these pages.",
      }),
    ]) {
      const c = render(p);
      expect(c.textContent).toContain("CDS is not a law firm");
      expect(c.querySelector("button[aria-label*='Dismiss']")).toBeNull();
      mounted?.unmount();
      mounted = null;
    }
  });

  it("Publish is aria-disabled with a reason until the box is ticked, then publishes", async () => {
    const p = props();
    const c = render(p);
    const box = c.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(box.checked).toBe(false);
    const btn = publishButton(c)!;
    expect(btn.textContent).toContain("Publish policy pages");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(c.textContent).toContain("Tick the box above to publish.");
    click(btn);
    expect(p.onPublish).not.toHaveBeenCalled();
    click(box);
    expect(publishButton(c)!.getAttribute("aria-disabled")).toBeNull();
    click(publishButton(c));
    await flush();
    expect(p.onPublish).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      "Policy pages published. Links are in your site's footer.",
    );
    expect(c.querySelector("input[type=checkbox]")).toBeNull();
  });

  it("update waiting: the button reads Publish the update", () => {
    const c = render(props({ published: true, updateWaiting: true }));
    expect(publishButton(c)!.textContent).toContain("Publish the update");
  });

  it("read-only callers get the reason and no checkbox or button", () => {
    const c = render(
      props({
        canPublish: false,
        readOnlyReason: "Only the site owner can publish these pages.",
      }),
    );
    expect(c.querySelector("input[type=checkbox]")).toBeNull();
    expect(publishButton(c)).toBeUndefined();
    expect(c.textContent).toContain(
      "Only the site owner can publish these pages.",
    );
  });

  it("Preview opens the drawer with the returned html", async () => {
    const p = props();
    const c = render(p);
    const preview = c.querySelector<HTMLButtonElement>(
      "button[aria-label='Preview page: Privacy policy']",
    )!;
    click(preview);
    await flush();
    expect(p.onPreview).toHaveBeenCalledWith("privacy");
    const dialog = c.querySelector("dialog")!;
    expect(dialog.getAttribute("aria-label")).toBe("Privacy policy preview");
    expect(dialog.innerHTML).toContain("<h2>Who we are</h2>");
    expect(dialog.textContent).toContain(
      "This is how it reads today. Your site shows it in your theme.",
    );
  });

  it("WR-B05: a rejected publish shows the error alert and re-enables the block", async () => {
    const p = props({
      onPublish: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    const c = render(p);
    click(c.querySelector<HTMLInputElement>("input[type=checkbox]"));
    click(publishButton(c));
    await flush();
    expect(c.textContent).toContain(SITE_POLICY_COPY.errPublish);
    expect(publishButton(c)!.textContent).not.toContain("Publishing");
    expect(
      c.querySelector<HTMLInputElement>("input[type=checkbox]")!.disabled,
    ).toBe(false);
  });

  it("WR-B05: a rejected preview shows an error, never a stuck skeleton", async () => {
    const p = props({
      onPreview: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    const c = render(p);
    click(c.querySelector("button[aria-label='Preview page: Privacy policy']"));
    await flush();
    expect(c.querySelector("dialog")!.textContent).toContain(
      SITE_POLICY_COPY.errPreview,
    );
  });

  it("WR-B05: a stale preview response never overwrites a newer open", async () => {
    const resolvers: ((v: { title: string; html: string }) => void)[] = [];
    const p = props({
      onPreview: vi.fn(
        () =>
          new Promise<{ title: string; html: string }>((r) =>
            resolvers.push(r),
          ),
      ),
    });
    const c = render(p);
    const open = () =>
      click(
        c.querySelector("button[aria-label='Preview page: Privacy policy']"),
      );
    open();
    open();
    resolvers[1]!({ title: "Privacy policy", html: "<p>new</p>" });
    await flush();
    resolvers[0]!({ title: "Privacy policy", html: "<p>old</p>" });
    await flush();
    const dialog = c.querySelector("dialog")!;
    expect(dialog.innerHTML).toContain("<p>new</p>");
    expect(dialog.innerHTML).not.toContain("<p>old</p>");
  });

  it("missing inputs: no publish block and Preview does nothing", async () => {
    const p = props({ missingInputs: true });
    const c = render(p);
    expect(c.querySelector("input[type=checkbox]")).toBeNull();
    click(c.querySelector("button[aria-label='Preview page: Terms']"));
    await flush();
    expect(p.onPreview).not.toHaveBeenCalled();
  });

  it("published: View on your site opens in a new tab, and the acked line shows", () => {
    const c = render(
      props({
        published: true,
        ackedLine:
          "Published by Ana Rivera on 8 Oct 2026 (template version 1).",
        viewHrefs: {
          privacy: "https://rivera.example/privacy",
          terms: "https://rivera.example/terms",
        },
      }),
    );
    const links = c.querySelectorAll<HTMLAnchorElement>("a[target=_blank]");
    expect(links.length).toBe(2);
    expect(links[0]!.href).toBe("https://rivera.example/privacy");
    expect(links[0]!.rel).toContain("noopener");
    expect(c.textContent).toContain("Published by Ana Rivera");
    expect(c.querySelector("input[type=checkbox]")).toBeNull();
  });
});
