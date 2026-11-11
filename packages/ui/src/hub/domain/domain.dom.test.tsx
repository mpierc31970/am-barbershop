// @vitest-environment jsdom
// Hub domain components (14-30 choice 4; 14-UI-SPEC S0-S5, "Accessibility contract").
import { JARGON, P14_COPY } from "@cds/core/dns";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  click,
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { FileDrop } from "../FileDrop";
import { BuildTracker } from "../today/BuildTracker";
import { DOMAIN_STATUS_WORDS, type DomainStatusTone } from "./copy";
import {
  DomainConnectForm,
  DomainStatusLine,
  GateFinding,
  NameserverPair,
  PrimaryHostChoice,
  RecordGroupList,
  RegistrarHint,
  RegistrarSteps,
  SendStepsDialog,
  type RecordGroup,
} from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

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

const DOMAIN = "riverabakery.com";

describe("DomainStatusLine", () => {
  const tones = Object.keys(DOMAIN_STATUS_WORDS) as DomainStatusTone[];
  for (const tone of tones) {
    it(`${tone} renders its word "${DOMAIN_STATUS_WORDS[tone]}"`, () => {
      mounted = mount(<DomainStatusLine tone={tone} sentence="A sentence." />);
      const p = mounted.container.querySelector("[data-domain-status]");
      expect(p?.textContent).toContain(DOMAIN_STATUS_WORDS[tone]);
      expect(p?.textContent).toContain("A sentence.");
    });
  }

  it("never uses the danger tone before something breaks (your turn is warning)", () => {
    mounted = mount(<DomainStatusLine tone="your-turn" sentence="x" />);
    const badge = mounted.container.querySelector("span");
    expect(badge?.className).toMatch(/warning/);
    expect(badge?.className).not.toMatch(/danger/);
  });

  it("renders the optional link", () => {
    mounted = mount(
      <DomainStatusLine
        tone="live"
        sentence="Live."
        link={{ href: "https://riverabakery.com", label: "View site" }}
      />,
    );
    const a = mounted.container.querySelector("a");
    expect(a?.textContent).toBe("View site");
    expect(a?.getAttribute("href")).toBe("https://riverabakery.com");
  });
});

const GROUPS: RecordGroup[] = [
  {
    key: "other",
    records: [{ key: "o1", type: "A", name: "ftp", value: "192.0.2.1" }],
  },
  {
    key: "site",
    records: [
      {
        key: "s1",
        type: "A",
        name: "@",
        value: "192.0.2.10",
        status: "copied",
      },
    ],
  },
  {
    key: "verification",
    records: [
      {
        key: "v1",
        type: "TXT",
        name: "@",
        value: `google-site-verification=${"a".repeat(80)}`,
        status: "checking",
        manager: "yours",
        action: "remove",
      },
    ],
  },
];

describe("RecordGroupList", () => {
  it("renders Your email first even when empty, with the empty line", () => {
    mounted = mount(
      <RecordGroupList
        mode="check"
        groups={GROUPS}
        domain={DOMAIN}
        layout="table"
      />,
    );
    const sections = [...mounted.container.querySelectorAll("section")];
    expect(sections.map((s) => s.getAttribute("data-group"))).toEqual([
      "email",
      "verification",
      "site",
      "other",
    ]);
    expect(sections[0]?.textContent).toContain("Your email");
    expect(sections[0]?.textContent).toContain("No email records found.");
  });

  it("uses a real table with caption and column headers at desktop layout", () => {
    mounted = mount(
      <RecordGroupList
        mode="check"
        groups={GROUPS}
        domain={DOMAIN}
        layout="table"
      />,
    );
    const site = mounted.container.querySelector('[data-group="site"]');
    const table = site?.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelector("caption")?.textContent).toBe(
      "Your site: 1 record",
    );
    expect(table?.querySelectorAll('th[scope="col"]').length).toBe(4);
    expect(site?.querySelector("dl")).toBeNull();
    // @ shows as the domain; the status badge carries its word.
    expect(site?.textContent).toContain(DOMAIN);
    expect(site?.textContent).toContain("Copied");
    expect(site?.textContent).toContain(
      "These keep showing your current website until launch day.",
    );
  });

  it("uses one <dl> per record in the stacked layout", () => {
    mounted = mount(
      <RecordGroupList
        mode="check"
        groups={GROUPS}
        domain={DOMAIN}
        layout="stacked"
      />,
    );
    expect(mounted.container.querySelector("table")).toBeNull();
    expect(mounted.container.querySelectorAll("dl").length).toBe(3);
    expect(
      mounted.container
        .querySelector("[data-record-groups]")
        ?.getAttribute("data-layout"),
    ).toBe("stacked");
  });

  it("auto layout renders both shapes, split at the md breakpoint", () => {
    mounted = mount(
      <RecordGroupList mode="check" groups={GROUPS} domain={DOMAIN} />,
    );
    expect(mounted.container.querySelector("table")?.className).toMatch(
      /(^| )hidden( .*)? md:table( |$)/,
    );
    expect(
      mounted.container.querySelector("[data-stacked]")?.className,
    ).toMatch(/md:hidden/);
  });

  it("shows the first 64 characters and a Show full value disclosure", () => {
    mounted = mount(
      <RecordGroupList
        mode="check"
        groups={GROUPS}
        domain={DOMAIN}
        layout="table"
      />,
    );
    const row = mounted.container.querySelector('[data-record-row="v1"]');
    const value = row?.querySelector("[data-record-value]");
    expect(value?.textContent).toBe(
      `${`google-site-verification=${"a".repeat(80)}`.slice(0, 64)}…`,
    );
    const toggle = [...(row?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes("Show full value"),
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    click(toggle);
    expect(value?.textContent).toBe(
      `google-site-verification=${"a".repeat(80)}`,
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  });

  it("writes MX values with their priority", () => {
    mounted = mount(
      <RecordGroupList
        mode="check"
        domain={DOMAIN}
        layout="table"
        groups={[
          {
            key: "email",
            records: [
              {
                key: "m1",
                type: "MX",
                name: "@",
                value: "smtp.google.com",
                priority: 10,
              },
            ],
          },
        ]}
      />,
    );
    expect(
      mounted.container.querySelector("[data-record-value]")?.textContent,
    ).toBe("10 smtp.google.com");
  });

  it("manage mode shows who manages it and a named Remove action", () => {
    const onRemove = vi.fn();
    mounted = mount(
      <RecordGroupList
        mode="manage"
        groups={GROUPS}
        domain={DOMAIN}
        layout="table"
        onRemove={onRemove}
      />,
    );
    const row = mounted.container.querySelector('[data-record-row="v1"]');
    expect(row?.textContent).toContain("Yours");
    const remove = row?.querySelector(
      `button[aria-label="Remove TXT record for ${DOMAIN}"]`,
    );
    expect(remove).not.toBeNull();
    click(remove);
    expect(onRemove).toHaveBeenCalledWith(
      expect.objectContaining({ key: "v1" }),
    );
    expect(mounted.container.textContent).toContain(
      "No email records. Set up email for my domain to add them.",
    );
  });

  it("read-only manage mode has no actions", () => {
    mounted = mount(
      <RecordGroupList
        mode="manage"
        groups={GROUPS}
        domain={DOMAIN}
        layout="table"
        onRemove={() => {}}
        readOnly
      />,
    );
    expect(
      mounted.container.querySelector('button[aria-label^="Remove"]'),
    ).toBeNull();
  });

  it("never renders record values as HTML", () => {
    mounted = mount(
      <RecordGroupList
        mode="check"
        domain={DOMAIN}
        layout="table"
        groups={[
          {
            key: "other",
            records: [
              {
                key: "x",
                type: "TXT",
                name: "@",
                value: "<img src=x onerror=1>",
              },
            ],
          },
        ]}
      />,
    );
    expect(mounted.container.querySelector("img")).toBeNull();
    expect(mounted.container.textContent).toContain("<img src=x onerror=1>");
  });
});

describe("GateFinding", () => {
  it("DNSSEC is a warning hard block that says it can't be skipped", () => {
    mounted = mount(
      <GateFinding finding={{ kind: "dnssec" }} registrar="GoDaddy">
        <p>fix</p>
      </GateFinding>,
    );
    const box = mounted.container.querySelector("[data-finding]");
    expect(box?.getAttribute("data-tone")).toBe("warning");
    expect(box?.className).not.toMatch(/danger/);
    expect(box?.textContent).toContain(
      P14_COPY.FIND_DNSSEC_T({ registrar: "GoDaddy" }),
    );
    expect(box?.textContent).toContain("This step can't be skipped.");
    expect(box?.textContent).toContain("fix");
  });

  it("forwarding is an acknowledgement, not a hard block", () => {
    mounted = mount(
      <GateFinding
        finding={{ kind: "email_forwarding" }}
        registrar="Namecheap"
      />,
    );
    expect(mounted.container.textContent).not.toContain(
      "This step can't be skipped.",
    );
  });

  it("CDS review is info with the CDS byline and the wait line", () => {
    mounted = mount(
      <GateFinding
        finding={{ kind: "cds_review", count: 1, cdsName: "Mara" }}
        registrar="GoDaddy"
      />,
    );
    const box = mounted.container.querySelector("[data-finding]");
    expect(box?.getAttribute("data-tone")).toBe("info");
    expect(box?.querySelector("[data-cds-identity]")).not.toBeNull();
    expect(box?.textContent).toContain("Mara from CDS");
    expect(box?.textContent).toContain(P14_COPY.FIND_CDS_WAIT);
  });
});

describe("NameserverPair", () => {
  it("names each copy button and announces the copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    mounted = mount(
      <NameserverPair
        values={["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]}
      />,
    );
    const b1 = mounted.container.querySelector(
      'button[aria-label="Copy nameserver 1"]',
    );
    const b2 = mounted.container.querySelector(
      'button[aria-label="Copy nameserver 2"]',
    );
    expect(b1).not.toBeNull();
    expect(b2).not.toBeNull();
    expect(mounted.container.textContent).toContain("ada.ns.cloudflare.com");
    click(b2);
    await flush();
    expect(writeText).toHaveBeenCalledWith("bob.ns.cloudflare.com");
    expect(
      mounted.container.querySelector("[data-nameserver-live]")?.textContent,
    ).toBe("Copied nameserver 2");
  });
});

describe("SendStepsDialog", () => {
  it("refuses an invalid address without calling the action", async () => {
    const action = vi.fn();
    mounted = mount(
      <SendStepsDialog
        open
        onClose={() => {}}
        domain={DOMAIN}
        registrar="GoDaddy"
        action={action}
      />,
    );
    expect(mounted.container.textContent).toContain(
      "For the person who manages riverabakery.com. They get the two nameservers and the steps for GoDaddy.",
    );
    const email = mounted.container.querySelector('input[name="email"]');
    typeInto(email, "not-an-address");
    submit(mounted.container.querySelector("form"));
    await flush();
    expect(action).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain(
      "Enter an email address like name@example.com.",
    );
    expect(email?.getAttribute("aria-invalid")).toBe("true");
  });

  it("sends a valid address and reports the toast words", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, data: null });
    const onSent = vi.fn();
    const onClose = vi.fn();
    mounted = mount(
      <SendStepsDialog
        open
        onClose={onClose}
        domain={DOMAIN}
        registrar="GoDaddy"
        action={action}
        onSent={onSent}
      />,
    );
    typeInto(
      mounted.container.querySelector('input[name="email"]'),
      "sam@example.com",
    );
    submit(mounted.container.querySelector("form"));
    await flush();
    expect(action).toHaveBeenCalledWith({ email: "sam@example.com", note: "" });
    expect(onSent).toHaveBeenCalledWith("Steps sent to sam@example.com.");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("PrimaryHostChoice", () => {
  it("is a radio group with the legend Your main address", () => {
    const onChange = vi.fn();
    mounted = mount(
      <PrimaryHostChoice domain={DOMAIN} value="apex" onChange={onChange} />,
    );
    expect(mounted.container.querySelector("legend")?.textContent).toBe(
      "Your main address",
    );
    const radios = [
      ...mounted.container.querySelectorAll<HTMLInputElement>(
        'input[type="radio"]',
      ),
    ];
    expect(radios).toHaveLength(2);
    expect(radios[0]?.name).toBe(radios[1]?.name);
    expect(radios[0]?.checked).toBe(true);
    expect(mounted.container.textContent).toContain(
      "Recommended. www.riverabakery.com sends visitors here.",
    );
    click(radios[1]);
    expect(onChange).toHaveBeenCalledWith("www");
  });
});

describe("DomainConnectForm", () => {
  it("normalises a pasted URL on blur and shows We'll use", () => {
    mounted = mount(
      <DomainConnectForm
        previewHost="rivera.sites.connectionsdesignstudios.com"
        action={vi.fn()}
      />,
    );
    expect(mounted.container.textContent).toContain(JARGON.domain);
    const input = mounted.container.querySelector<HTMLInputElement>(
      'input[name="domain"]',
    );
    typeInto(input, "https://www.RiveraBakery.com/menu");
    act(() => {
      input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(
      mounted.container.querySelector("[data-domain-preview]")?.textContent,
    ).toBe("We'll use riverabakery.com.");
  });

  it("refuses a CDS address locally and focuses the error", async () => {
    const action = vi.fn();
    mounted = mount(
      <DomainConnectForm
        previewHost="rivera.sites.connectionsdesignstudios.com"
        action={action}
      />,
    );
    typeInto(
      mounted.container.querySelector('input[name="domain"]'),
      "rivera.sites.connectionsdesignstudios.com",
    );
    submit(mounted.container.querySelector("form"));
    await flush();
    expect(action).not.toHaveBeenCalled();
    const alert = mounted.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(P14_COPY.DOM_RESERVED);
    expect(
      mounted.container
        .querySelector('input[name="domain"]')
        ?.getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("calls the action with the normalised domain and shows a server error", async () => {
    const action = vi.fn().mockResolvedValue({
      ok: false,
      code: "DOM-CF-REGISTRAR",
      message: P14_COPY.DOM_CF_REGISTRAR({ domain: DOMAIN }),
    });
    mounted = mount(
      <DomainConnectForm
        previewHost="rivera.sites.connectionsdesignstudios.com"
        action={action}
        askSupportHref="/hub/support/new?type=question"
      />,
    );
    typeInto(
      mounted.container.querySelector('input[name="domain"]'),
      "www.riverabakery.com",
    );
    submit(mounted.container.querySelector("form"));
    await flush();
    expect(action).toHaveBeenCalledWith(DOMAIN);
    const alert = mounted.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("registered at Cloudflare");
    expect(alert?.querySelector("a")?.textContent).toBe("Ask CDS Support");
  });
});

describe("RegistrarHint and RegistrarSteps", () => {
  it("shows the registrar and renewal date, or the unknown line", () => {
    mounted = mount(<RegistrarHint registrar="GoDaddy" renews="3 Mar 2027" />);
    expect(mounted.container.textContent).toBe(
      "Registered at GoDaddy, in your name. Renews 3 Mar 2027.",
    );
    mounted.unmount();
    mounted = mount(<RegistrarHint registrar={null} renews={null} />);
    expect(mounted.container.textContent).toBe(P14_COPY.RDAP_UNKNOWN);
  });

  it("preselects the registrar and lists its steps with bold words", () => {
    mounted = mount(<RegistrarSteps kind="nameservers" registrar="godaddy" />);
    const select = mounted.container.querySelector("select");
    expect(select?.value).toBe("godaddy");
    const items = mounted.container.querySelectorAll("ol li");
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[items.length - 1]?.textContent).toBe(
      "Save. You're done there.",
    );
    expect(mounted.container.querySelector("ol strong")).not.toBeNull();
    expect(mounted.container.textContent).not.toContain("**");
  });
});

describe("primitive extensions (14-30 choice 2)", () => {
  it("FileDrop takes accept and hint for the zone file", () => {
    mounted = mount(
      <FileDrop
        onText={() => {}}
        onError={() => {}}
        maxBytes={262144}
        accept=".txt,.zone,.db,.bind,text/plain"
        hint="Drop your zone file here, or"
      />,
    );
    expect(
      mounted.container
        .querySelector('input[type="file"]')
        ?.getAttribute("accept"),
    ).toBe(".txt,.zone,.db,.bind,text/plain");
    expect(mounted.container.textContent).toContain(
      "Drop your zone file here, or choose a file",
    );
  });

  it("BuildTracker takes a heading and the vertical orientation", () => {
    mounted = mount(
      <BuildTracker
        heading="Launch steps"
        orientation="vertical"
        timeZone="America/Chicago"
        steps={
          [
            { id: "a", label: "Records copied", state: "done", at: null },
            {
              id: "b",
              label: "Nameservers changed",
              state: "current",
              at: null,
            },
          ] as never
        }
      />,
    );
    expect(mounted.container.querySelector("h2")?.textContent).toBe(
      "Launch steps",
    );
    const ol = mounted.container.querySelector("ol");
    expect(ol?.getAttribute("data-orientation")).toBe("vertical");
    expect(ol?.className).not.toMatch(/md:grid/);
  });
});
