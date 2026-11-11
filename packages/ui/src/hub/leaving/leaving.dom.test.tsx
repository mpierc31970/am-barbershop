// @vitest-environment jsdom
// Leaving CDS components (14-42 choice 7; LIFE-01, D282; 14-UI-SPEC "Leaving CDS (owner)").
import { P14_COPY } from "@cds/core/dns";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import {
  HandbackFlow,
  LEAVING_UI_COPY,
  LeaveStartPanel,
  LeavingBanner,
  LeavingChecklist,
  type HandbackZoneUi,
  type LeavingChecklistProps,
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

const ENDS = "14 Nov 2026";

describe("LeavingBanner", () => {
  it("is a named region with the static BANNER text, the number bold, and Open checklist", () => {
    mounted = mount(<LeavingBanner days={23} next="move your DNS" />);
    const region = mounted.container.querySelector('[role="region"]');
    expect(region?.getAttribute("aria-label")).toBe("Leaving CDS");
    expect(region?.textContent).toContain(
      "Leaving CDS · 23 days left · Next: move your DNS",
    );
    expect(region?.querySelector("strong")?.textContent).toBe("23");
    const link = region?.querySelector("a");
    expect(link?.textContent).toBe(P14_COPY.BTN_OPEN_CHECKLIST);
    expect(link?.getAttribute("href")).toBe("/hub/leaving");
    // Not dismissible: no buttons.
    expect(region?.querySelector("button")).toBeNull();
  });

  it("hides the link on the checklist itself", () => {
    mounted = mount(<LeavingBanner days={1} next="move your DNS" hideLink />);
    expect(mounted.container.querySelector("a")).toBeNull();
    expect(mounted.container.textContent).toContain("1 day left");
  });
});

describe("LeaveStartPanel", () => {
  const base = {
    endsOn: ENDS,
    endsOnShort: "14 Nov",
    keepHref: "/hub/settings?tab=billing",
  };

  it("states the five consequences in order before the code and the one danger button", () => {
    mounted = mount(
      <LeaveStartPanel
        {...base}
        billingLines={[`Your plan ends on ${ENDS}.`]}
        requestCode={vi.fn()}
        start={vi.fn()}
      />,
    );
    const items = Array.from(
      mounted.container.querySelectorAll("[data-leave-lines] li"),
    ).map((li) => li.textContent);
    expect(items).toHaveLength(5);
    expect(items[0]).toMatch(/^First, your DNS moves back to you/);
    expect(items[1]).toBe(`Your site stays up for 30 days, until ${ENDS}.`);
    expect(items[2]).toMatch(/Download everything/);
    expect(items[3]).toBe(`Your plan ends on ${ENDS}.`);
    expect(items[4]).toBe(
      "On 14 Nov your site closes. It's deleted 30 days after that.",
    );
    expect(mounted.container.textContent).toContain(P14_COPY.LEAVE_INTRO);
    // No retention offer.
    expect(mounted.container.textContent).not.toMatch(/discount|% off|offer/i);
    expect(button(mounted.container, P14_COPY.BTN_START_NOTICE)).not.toBeNull();
    const keep = Array.from(mounted.container.querySelectorAll("a")).find(
      (a) => a.textContent === P14_COPY.BTN_KEEP_MY_SITE,
    );
    expect(keep?.getAttribute("href")).toBe("/hub/settings?tab=billing");
  });

  it("adds the annual prepay and launch-price lines when the plan has them", () => {
    mounted = mount(
      <LeaveStartPanel
        {...base}
        billingLines={[
          `Your plan ends on ${ENDS}.`,
          "Your annual prepay isn't refunded.",
          "You lose your launch price. If you come back later, current prices apply.",
        ]}
        requestCode={vi.fn()}
        start={vi.fn()}
      />,
    );
    const line = mounted.container.querySelectorAll("[data-leave-lines] li")[3];
    expect(line?.textContent).toContain("Your annual prepay isn't refunded.");
    expect(line?.textContent).toContain("You lose your launch price.");
  });

  it("first press emails the code, the second starts the notice with the reason and note", async () => {
    const requestCode = vi.fn(async () => ({
      ok: true as const,
      data: { otpId: "abcdefghijklmno", maskedEmail: "m•••@gmail.com" },
    }));
    const start = vi.fn(async () => ({ ok: true as const, data: null }));
    const onStarted = vi.fn();
    mounted = mount(
      <LeaveStartPanel
        {...base}
        billingLines={[]}
        requestCode={requestCode}
        start={start}
        onStarted={onStarted}
      />,
    );
    const form = mounted.container.querySelector("form");
    const select = mounted.container.querySelector("select")!;
    select.value = "cost";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    typeInto(mounted.container.querySelector("textarea"), "Too pricey");
    submit(form);
    await flush();
    expect(requestCode).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain(
      "To confirm, we emailed a code to m•••@gmail.com.",
    );
    typeInto(mounted.container.querySelector('input[name="code"]'), "123456");
    submit(form);
    await flush();
    expect(start).toHaveBeenCalledWith({
      reasonCategory: "cost",
      note: "Too pricey",
      otpId: "abcdefghijklmno",
      code: "123456",
    });
    expect(onStarted).toHaveBeenCalled();
  });

  it("shows a wrong code in an alert and does not start", async () => {
    const start = vi.fn(async () => ({
      ok: false as const,
      code: "forbidden",
      message: "That code didn't match.",
    }));
    const onStarted = vi.fn();
    mounted = mount(
      <LeaveStartPanel
        {...base}
        billingLines={[]}
        requestCode={async () => ({
          ok: true,
          data: { otpId: "abcdefghijklmno", maskedEmail: "m•••@x.com" },
        })}
        start={start}
        onStarted={onStarted}
      />,
    );
    const form = mounted.container.querySelector("form");
    submit(form);
    await flush();
    typeInto(mounted.container.querySelector('input[name="code"]'), "000000");
    submit(form);
    await flush();
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toBe(
      "That code didn't match.",
    );
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("is turned off under impersonation with IMPERSONATING-LEAVE", async () => {
    const requestCode = vi.fn();
    mounted = mount(
      <LeaveStartPanel
        {...base}
        billingLines={[]}
        impersonating
        requestCode={requestCode}
        start={vi.fn()}
      />,
    );
    const btn = button(mounted.container, P14_COPY.BTN_START_NOTICE);
    expect(btn?.getAttribute("aria-disabled")).toBe("true");
    expect(mounted.container.textContent).toContain(
      P14_COPY.IMPERSONATING_LEAVE,
    );
    click(btn);
    submit(mounted.container.querySelector("form"));
    await flush();
    expect(requestCode).not.toHaveBeenCalled();
  });
});

const ZONE: HandbackZoneUi = {
  domain: "riverabakery.com",
  registrarId: "godaddy",
  registrarName: "GoDaddy",
  groups: {
    copy_exactly: [
      { type: "MX", name: "@", value: "smtp.google.com", priority: 1 },
      { type: "TXT", name: "@", value: "v=spf1 include:_spf.google.com ~all" },
    ],
    points_to_cds: [{ type: "A", name: "@", value: "82.180.132.176" }],
    remove: [
      {
        type: "CNAME",
        name: "abc._domainkey",
        value: "abc.dkim.amazonses.com",
      },
    ],
  },
  destination: null,
  destinationNameservers: [],
  cdsNameservers: ["ana.ns.cloudflare.com", "bob.ns.cloudflare.com"],
  results: [],
  canCheckBefore: true,
  status: "open",
  message: null,
};

function checklistProps(
  over: Partial<LeavingChecklistProps> = {},
): LeavingChecklistProps {
  return {
    endsOn: ENDS,
    daysLeft: 23,
    steps: [
      { key: "dns_handback", status: "open" },
      { key: "download", status: "locked" },
      { key: "addons", status: "locked" },
      { key: "services", status: "locked" },
      { key: "billing", status: "locked" },
      { key: "close", status: "locked" },
    ],
    downloadLine: `Available until ${ENDS}.`,
    addons: { items: [], line: P14_COPY.ADDONS_NA },
    services: [
      { key: "stripe", label: "Stripe", state: "not connected" },
      {
        key: "analytics",
        label: "Google Analytics and Search Console",
        state: `Transfer to your own Google account before ${ENDS}`,
      },
    ],
    billingLines: [`Your plan ends on ${ENDS}.`],
    closeLine: `${ENDS}. Deleted 30 days later, on 14 Dec 2026.`,
    ...over,
  };
}

describe("LeavingChecklist", () => {
  it("locks every step after DNS with LOCKED and aria-disabled content, no actions", () => {
    mounted = mount(
      <LeavingChecklist
        {...checklistProps()}
        dns={<p>dns flow</p>}
        onStepDone={vi.fn()}
        onDownloadData={vi.fn()}
        onStay={vi.fn()}
      />,
    );
    const rows = Array.from(
      mounted.container.querySelectorAll("li[data-step]"),
    );
    expect(rows.map((r) => r.getAttribute("data-step"))).toEqual([
      "dns_handback",
      "download",
      "addons",
      "services",
      "billing",
      "close",
    ]);
    expect(rows[0]?.textContent).toContain("dns flow");
    for (const r of rows.slice(1)) {
      expect(r.getAttribute("data-step-status")).toBe("locked");
      expect(r.textContent).toContain(P14_COPY.LOCKED);
      expect(r.querySelector('[aria-disabled="true"]')).not.toBeNull();
      expect(r.querySelector("button")).toBeNull();
    }
    expect(mounted.container.textContent).toContain(
      "Notice ends 14 Nov 2026 · 23 days left",
    );
  });

  it("opens the later steps once DNS is not applicable (HANDBACK-NA)", () => {
    mounted = mount(
      <LeavingChecklist
        {...checklistProps({
          steps: [
            { key: "dns_handback", status: "not_applicable" },
            { key: "download", status: "open" },
            { key: "addons", status: "open" },
            { key: "services", status: "open" },
            { key: "billing", status: "open" },
            { key: "close", status: "open" },
          ],
        })}
        onStepDone={vi.fn(async () => ({ ok: true as const, data: null }))}
        onDownloadData={vi.fn()}
      />,
    );
    expect(mounted.container.textContent).toContain(P14_COPY.HANDBACK_NA);
    expect(mounted.container.textContent).not.toContain(P14_COPY.LOCKED);
    expect(
      button(mounted.container, P14_COPY.BTN_DOWNLOAD_DATA),
    ).not.toBeNull();
    expect(button(mounted.container, "Mark Add-ons as done")).not.toBeNull();
    expect(mounted.container.textContent).toContain(P14_COPY.ADDONS_NA);
  });

  it("lists the GA4 / Search Console line in both states (transfer / not connected)", () => {
    mounted = mount(<LeavingChecklist {...checklistProps()} />);
    const ga = mounted.container.querySelector('[data-service="analytics"]');
    expect(ga?.textContent).toBe(
      `Google Analytics and Search Console · Transfer to your own Google account before ${ENDS}`,
    );
    mounted.unmount();
    mounted = mount(
      <LeavingChecklist
        {...checklistProps({
          services: [
            {
              key: "analytics",
              label: "Google Analytics and Search Console",
              state: "not connected",
            },
          ],
        })}
      />,
    );
    expect(
      mounted.container.querySelector('[data-service="analytics"]')
        ?.textContent,
    ).toBe("Google Analytics and Search Console · not connected");
  });

  it("is read-only for Admins: no buttons, no Stay with CDS", () => {
    mounted = mount(
      <LeavingChecklist
        {...checklistProps({
          steps: [
            { key: "dns_handback", status: "done" },
            { key: "download", status: "open" },
            { key: "addons", status: "open" },
            { key: "services", status: "open" },
            { key: "billing", status: "open" },
            { key: "close", status: "open" },
          ],
        })}
        readOnly
        onStepDone={vi.fn()}
        onDownloadData={vi.fn()}
        onStay={vi.fn()}
      />,
    );
    expect(mounted.container.querySelector("button")).toBeNull();
    expect(mounted.container.textContent).toContain(LEAVING_UI_COPY.readOnly);
  });

  it("Stay with CDS opens a dialog with STAY-B (+ the handed-back line) and the safe default", async () => {
    const onStay = vi.fn(async () => ({ ok: true as const, data: null }));
    const onStayed = vi.fn();
    mounted = mount(
      <LeavingChecklist
        {...checklistProps()}
        dnsHandedBack
        stayHandedBackLine="Your domain no longer points to CDS. Connect it again from Settings › Domain."
        onStay={onStay}
        onStayed={onStayed}
      />,
    );
    click(button(mounted.container, P14_COPY.BTN_STAY));
    const dialog = mounted.container.querySelector("dialog");
    expect(dialog?.textContent).toContain(P14_COPY.STAY_H);
    expect(dialog?.textContent).toContain(P14_COPY.STAY_B);
    expect(dialog?.textContent).toContain("no longer points to CDS");
    expect(button(dialog!, P14_COPY.BTN_KEEP_LEAVING)).not.toBeNull();
    const stay = button(dialog!, P14_COPY.BTN_STAY);
    expect(stay?.className).toMatch(/bg-hub-accent/);
    click(stay);
    await flush();
    expect(onStay).toHaveBeenCalled();
    expect(onStayed).toHaveBeenCalled();
  });
});

describe("HandbackFlow", () => {
  it("open: zone file button, the three handback groups, destination choice, check button", () => {
    mounted = mount(
      <HandbackFlow
        zone={ZONE}
        actions={{
          downloadZoneFile: vi.fn(),
          choose: vi.fn(),
          check: vi.fn(),
          confirm: vi.fn(),
        }}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(
      button(mounted.container, P14_COPY.BTN_DOWNLOAD_ZONE_FILE),
    ).not.toBeNull();
    expect(text).toContain("smtp.google.com");
    expect(text).toContain("82.180.132.176");
    expect(text).toContain("abc.dkim.amazonses.com");
    expect(text).toContain("Back to GoDaddy's DNS");
    expect(text).toContain("Another DNS host");
    expect(
      button(mounted.container, P14_COPY.BTN_CHECK_NEW_DNS),
    ).not.toBeNull();
    expect(
      mounted.container.querySelector("[data-handback-switch]"),
    ).toBeNull();
  });

  it("downloads the zone file through the action", async () => {
    const saveFile = vi.fn();
    mounted = mount(
      <HandbackFlow
        zone={ZONE}
        saveFile={saveFile}
        actions={{
          downloadZoneFile: async () => ({
            ok: true,
            data: { filename: "riverabakery.com-zone.txt", text: "; zone" },
          }),
          choose: vi.fn(),
          check: vi.fn(),
          confirm: vi.fn(),
        }}
      />,
    );
    click(button(mounted.container, P14_COPY.BTN_DOWNLOAD_ZONE_FILE));
    await flush();
    expect(saveFile).toHaveBeenCalledWith(
      "riverabakery.com-zone.txt",
      "; zone",
    );
  });

  it("first check saves the choice; ready_to_switch shows found rows, HANDBACK-AFTER and I've changed them", async () => {
    const after = P14_COPY.HANDBACK_AFTER({ registrar: "GoDaddy" });
    const choose = vi.fn(async () => ({
      ok: true as const,
      data: {
        ...ZONE,
        destination: "registrar" as const,
        destinationNameservers: ["ns1.godaddy.com", "ns2.godaddy.com"],
        status: "ready_to_switch" as const,
        canCheckBefore: false,
        message: after,
        results: [
          { record: ZONE.groups.copy_exactly[0]!, found: true },
          { record: ZONE.groups.copy_exactly[1]!, found: false },
        ],
      },
    }));
    const confirm = vi.fn(async () => ({
      ok: true as const,
      data: { ...ZONE, status: "waiting" as const },
    }));
    mounted = mount(
      <HandbackFlow
        zone={ZONE}
        actions={{ downloadZoneFile: vi.fn(), choose, check: vi.fn(), confirm }}
      />,
    );
    const radio = mounted.container.querySelector<HTMLInputElement>(
      'input[type="radio"][value="registrar"]',
    );
    click(radio);
    click(button(mounted.container, P14_COPY.BTN_CHECK_NEW_DNS));
    await flush();
    expect(choose).toHaveBeenCalledWith("riverabakery.com", {
      kind: "registrar",
    });
    const text = mounted.container.textContent ?? "";
    expect(text).toContain(after);
    expect(text).toContain("Found at your new DNS");
    expect(text).toContain("Not found yet");
    expect(text).toContain("Now change your nameservers to GoDaddy's");
    expect(text).toContain("ns1.godaddy.com");
    click(button(mounted.container, P14_COPY.BTN_IVE_CHANGED));
    await flush();
    expect(confirm).toHaveBeenCalledWith("riverabakery.com");
    expect(
      mounted.container
        .querySelector("[data-handback-status]")
        ?.getAttribute("data-handback-status"),
    ).toBe("waiting");
    expect(mounted.container.textContent).toContain(P14_COPY.WAITING_BODY);
  });

  it("another host sends both nameservers", async () => {
    const choose = vi.fn(async () => ({ ok: true as const, data: ZONE }));
    mounted = mount(
      <HandbackFlow
        zone={ZONE}
        actions={{
          downloadZoneFile: vi.fn(),
          choose,
          check: vi.fn(),
          confirm: vi.fn(),
        }}
      />,
    );
    click(
      mounted.container.querySelector('input[type="radio"][value="other"]'),
    );
    const fields =
      mounted.container.querySelectorAll<HTMLInputElement>(
        'input[type="text"]',
      );
    typeInto(fields[0], "ns1.newhost.net");
    typeInto(fields[1], "ns2.newhost.net");
    click(button(mounted.container, P14_COPY.BTN_CHECK_NEW_DNS));
    await flush();
    expect(choose).toHaveBeenCalledWith("riverabakery.com", {
      kind: "other",
      nameservers: ["ns1.newhost.net", "ns2.newhost.net"],
    });
  });

  it("rate limited shows the wait line", async () => {
    mounted = mount(
      <HandbackFlow
        zone={{ ...ZONE, destination: "registrar" }}
        actions={{
          downloadZoneFile: vi.fn(),
          choose: vi.fn(),
          check: async () => ({
            ok: false,
            code: "rate_limited",
            message: "x",
          }),
          confirm: vi.fn(),
        }}
      />,
    );
    click(button(mounted.container, P14_COPY.BTN_CHECK_NEW_DNS));
    await flush();
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toBe(
      LEAVING_UI_COPY.rateLimited,
    );
  });

  it("mismatch: HANDBACK-MISMATCH, CDS's nameservers and the missing records", () => {
    const msg = P14_COPY.HANDBACK_MISMATCH({ count: 1 });
    mounted = mount(
      <HandbackFlow
        zone={{
          ...ZONE,
          destination: "registrar",
          status: "mismatch",
          message: msg,
          results: [
            { record: ZONE.groups.copy_exactly[0]!, found: false },
            { record: ZONE.groups.copy_exactly[1]!, found: true },
          ],
        }}
        readOnly
      />,
    );
    const box = mounted.container.querySelector("[data-handback-mismatch]");
    expect(box?.textContent).toContain(msg);
    expect(box?.textContent).toContain("ana.ns.cloudflare.com");
    expect(box?.textContent).toContain("smtp.google.com");
    expect(box?.textContent).not.toContain("v=spf1");
    expect(mounted.container.querySelector("button[type='submit']")).toBeNull();
  });

  it("done: HANDBACK-DONE only", () => {
    mounted = mount(
      <HandbackFlow
        zone={{ ...ZONE, status: "done", message: P14_COPY.HANDBACK_DONE }}
      />,
    );
    expect(mounted.container.textContent).toContain(P14_COPY.HANDBACK_DONE);
    expect(mounted.container.querySelector("table")).toBeNull();
  });

  it("read-only shows records but no buttons or radios", () => {
    mounted = mount(<HandbackFlow zone={ZONE} readOnly />);
    expect(mounted.container.textContent).toContain("smtp.google.com");
    expect(mounted.container.querySelector('input[type="radio"]')).toBeNull();
    expect(
      button(mounted.container, P14_COPY.BTN_DOWNLOAD_ZONE_FILE),
    ).toBeNull();
  });
});

describe("WR-E02: HandbackFlow tells the page when the handback changes", () => {
  it("onChanged runs after a check and after I've changed them, not after a refusal", async () => {
    const onChanged = vi.fn();
    const ready = {
      ...ZONE,
      destination: "registrar" as const,
      destinationNameservers: ["ns1.godaddy.com", "ns2.godaddy.com"],
      status: "ready_to_switch" as const,
    };
    const check = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        code: "x",
        message: "Not yet.",
      })
      .mockResolvedValueOnce({ ok: true as const, data: ready });
    const confirm = vi.fn(async () => ({
      ok: true as const,
      data: { ...ready, status: "waiting" as const },
    }));
    mounted = mount(
      <HandbackFlow
        zone={{ ...ZONE, destination: "registrar" }}
        actions={{ downloadZoneFile: vi.fn(), choose: vi.fn(), check, confirm }}
        onChanged={onChanged}
      />,
    );
    click(button(mounted.container, P14_COPY.BTN_CHECK_NEW_DNS));
    await flush();
    expect(onChanged).not.toHaveBeenCalled();
    click(button(mounted.container, P14_COPY.BTN_CHECK_NEW_DNS));
    await flush();
    expect(onChanged).toHaveBeenLastCalledWith(ready);
    click(button(mounted.container, P14_COPY.BTN_IVE_CHANGED));
    await flush();
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(onChanged.mock.calls[1]![0].status).toBe("waiting");
  });
});

describe("WR-E09: HandbackFlow nameserver checks", () => {
  const other = {
    ...ZONE,
    destination: "other" as const,
    destinationNameservers: ["ns1.example.com", "ns2.example.com"],
    status: "checking" as const,
  };

  it("the same nameservers in another case, with spaces and a trailing dot, re-check (no re-choose)", async () => {
    const choose = vi.fn();
    const check = vi.fn(async () => ({ ok: true as const, data: other }));
    mounted = mount(
      <HandbackFlow
        zone={other}
        actions={{ downloadZoneFile: vi.fn(), choose, check, confirm: vi.fn() }}
      />,
    );
    const fields =
      mounted.container.querySelectorAll<HTMLInputElement>(
        'input[type="text"]',
      );
    typeInto(fields[0], " NS1.Example.com. ");
    typeInto(fields[1], "ns2.example.COM");
    click(button(mounted.container, P14_COPY.BTN_CHECK_NEW_DNS));
    await flush();
    expect(check).toHaveBeenCalledWith("riverabakery.com");
    expect(choose).not.toHaveBeenCalled();
  });

  it("empty or identical nameservers are refused under the field, no action", async () => {
    const choose = vi.fn();
    mounted = mount(
      <HandbackFlow
        zone={ZONE}
        actions={{
          downloadZoneFile: vi.fn(),
          choose,
          check: vi.fn(),
          confirm: vi.fn(),
        }}
      />,
    );
    click(
      mounted.container.querySelector('input[type="radio"][value="other"]'),
    );
    click(button(mounted.container, P14_COPY.BTN_CHECK_NEW_DNS));
    await flush();
    expect(choose).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain(LEAVING_UI_COPY.nsEmpty);
    const fields =
      mounted.container.querySelectorAll<HTMLInputElement>(
        'input[type="text"]',
      );
    expect(fields[0]!.getAttribute("aria-invalid")).toBe("true");
    typeInto(fields[0], "ns1.newhost.net");
    typeInto(fields[1], "NS1.newhost.net.");
    click(button(mounted.container, P14_COPY.BTN_CHECK_NEW_DNS));
    await flush();
    expect(choose).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain(LEAVING_UI_COPY.nsSame);
  });
});

describe("WR-E03: LeaveStartPanel moves focus after React renders the target", () => {
  it("the code field takes focus once the code is sent; the first error takes focus", async () => {
    mounted = mount(
      <LeaveStartPanel
        endsOn="14 Nov 2026"
        endsOnShort="14 Nov"
        billingLines={[]}
        keepHref="/hub/settings?tab=billing"
        requestCode={async () => ({
          ok: true,
          data: { otpId: "abcdefghijklmno", maskedEmail: "m•••@x.com" },
        })}
        start={async () => ({
          ok: false as const,
          code: "forbidden",
          message: "That code didn't match.",
        })}
      />,
    );
    const form = mounted.container.querySelector("form");
    submit(form);
    await flush();
    const codeInput = mounted.container.querySelector(
      'input[name="code"]',
    ) as HTMLInputElement;
    expect(codeInput).not.toBeNull();
    expect(
      (document.activeElement as HTMLElement | null)?.tagName === "INPUT" &&
        mounted.container.contains(document.activeElement),
    ).toBe(true);
    typeInto(codeInput, "000000");
    submit(form);
    await flush();
    const alert = mounted.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("That code didn't match.");
    const errorBox = alert?.closest("[tabindex='-1']") ?? alert;
    expect(document.activeElement).toBe(errorBox);
  });
});

describe("WR-E04: Send a new code is guarded while a request runs", () => {
  it("a double press sends one code and clears the old error", async () => {
    let n = 0;
    let release: (() => void) | null = null;
    const requestCode = vi.fn(async () => {
      n += 1;
      if (n > 1) await new Promise<void>((r) => (release = r));
      return {
        ok: true as const,
        data: { otpId: `otp-${n}-abcdefghijk`, maskedEmail: "m•••@x.com" },
      };
    });
    mounted = mount(
      <LeaveStartPanel
        endsOn="14 Nov 2026"
        endsOnShort="14 Nov"
        billingLines={[]}
        keepHref="/hub/settings?tab=billing"
        requestCode={requestCode}
        start={async () => ({
          ok: false as const,
          code: "forbidden",
          message: "That code didn't match.",
        })}
      />,
    );
    const form = mounted.container.querySelector("form");
    submit(form);
    await flush();
    typeInto(mounted.container.querySelector('input[name="code"]'), "000000");
    submit(form);
    await flush();
    expect(mounted.container.textContent).toContain("That code didn't match.");
    const resendBtn = button(mounted.container, LEAVING_UI_COPY.resendCode);
    click(resendBtn);
    click(resendBtn);
    await flush();
    expect(requestCode).toHaveBeenCalledTimes(2);
    expect(mounted.container.textContent).not.toContain(
      "That code didn't match.",
    );
    expect(
      button(mounted.container, LEAVING_UI_COPY.resendCode)?.disabled,
    ).toBe(true);
    (release as (() => void) | null)?.();
    await flush();
    expect(requestCode).toHaveBeenCalledTimes(2);
    expect(
      button(mounted.container, LEAVING_UI_COPY.resendCode)?.disabled,
    ).toBe(false);
  });
});
