// @vitest-environment jsdom
// Staff › Site › Domain components (14-38 choice 3; DOM-08, DOM-05; 14-UI-SPEC "Staff › Site ›
// Domain"; T-14-38-01, T-14-38-02).
import { P14_COPY, STAFF_PREPARED_WORDS } from "@cds/core/dns";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastRegion } from "../../hub/Toast";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { StaffActionProvider } from "../dialogs";
import {
  DomainSummary,
  GateReport,
  HostsTable,
  MoveDomainButton,
  MoveTimeline,
  PostSwitchAlert,
  STAFF_DOMAIN_COPY,
  type GateReportData,
  type StaffDomainMoveData,
  type StaffDomainStepData,
  type StaffDomainSummaryData,
} from "./index";

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
});

const ORG = "aaaaaaaaaaaaaaa";

function wrap(ui: ReactNode): ReactNode {
  return (
    <ToastRegion>
      <StaffActionProvider
        requestStepUpCode={vi.fn()}
        confirmStepUp={vi.fn()}
        navigate={vi.fn()}
      >
        {ui}
      </StaffActionProvider>
    </ToastRegion>
  );
}

const KEYS = [
  "snapshot",
  "zone",
  "gate",
  "nameservers",
  "delegation",
  "site_records",
  "edge",
  "https",
  "cutover",
  "search",
] as const;

function steps(
  doneThrough: number,
  failedAt: number | null = null,
): StaffDomainStepData[] {
  return KEYS.map((key, i) => {
    if (failedAt !== null && i === failedAt) {
      return {
        key,
        status: "failed" as const,
        startedAt: "2026-10-10T14:00:00.000Z",
        detail: "https_failed:525",
        attempts: 3,
      };
    }
    if (i < doneThrough) {
      return {
        key,
        status: "done" as const,
        startedAt: "2026-10-10T14:00:00.000Z",
        finishedAt: "2026-10-10T14:02:00.000Z",
      };
    }
    return { key, status: "waiting" as const };
  });
}

function move(over: Partial<StaffDomainMoveData> = {}): StaffDomainMoveData {
  return {
    code: "M-14",
    kind: "launch",
    fromHost: "rivera.sites.connectionsdesignstudios.com",
    toHost: "riverabakery.com",
    status: "running",
    currentStep: "gate",
    steps: steps(2),
    failedStep: null,
    prepared: false,
    cancelNote: null,
    ...over,
  };
}

function dialog(): HTMLDialogElement {
  const d = [...document.querySelectorAll("dialog")].find((x) =>
    x.hasAttribute("open"),
  );
  if (!d) throw new Error("no open dialog");
  return d;
}

describe("MoveTimeline (domain_move timeline)", () => {
  it("renders ten steps and the Prepared row between 5 and 6, in order", () => {
    mounted = mount(
      wrap(
        <MoveTimeline
          orgId={ORG}
          business="Rivera Bakery"
          move={move()}
          canSuper
        />,
      ),
    );
    const ol = mounted.container.querySelector(
      'ol[data-timeline-kind="domain_move"]',
    );
    expect(ol).not.toBeNull();
    const ids = [...ol!.querySelectorAll(":scope > li")].map((li) =>
      li.getAttribute("data-step"),
    );
    expect(ids).toEqual([
      "snapshot",
      "zone",
      "gate",
      "nameservers",
      "delegation",
      "prepared",
      "site_records",
      "edge",
      "https",
      "cutover",
      "search",
    ]);
    expect(ol!.textContent).toContain("1 Snapshot");
    expect(ol!.textContent).toContain("10 Search");
    expect(ol!.textContent).toContain(STAFF_PREPARED_WORDS);
    const heading = mounted.container.querySelector("h2");
    expect(heading?.textContent).toBe(
      "Move · launch · rivera.sites.connectionsdesignstudios.com → riverabakery.com",
    );
    // Done step: started/finished in Central time (14:00Z = 09:00 CDT).
    const first = ol!.querySelector('li[data-step="snapshot"]');
    expect(first?.textContent).toContain("started 10 Oct 09:00");
    expect(first?.getAttribute("data-state")).toBe("done");
  });

  it("a post-launch move has no Prepared row", () => {
    mounted = mount(
      wrap(
        <MoveTimeline
          orgId={ORG}
          business="Rivera Bakery"
          move={move({ kind: "move" })}
          canSuper
        />,
      ),
    );
    expect(
      mounted.container.querySelector('li[data-step="prepared"]'),
    ).toBeNull();
    expect(
      mounted.container.querySelectorAll("ol[data-timeline-kind] > li"),
    ).toHaveLength(10);
  });

  it("expands the failed step by default with its error detail and audit line", () => {
    mounted = mount(
      wrap(
        <MoveTimeline
          orgId={ORG}
          business="Rivera Bakery"
          move={move({
            status: "failed",
            currentStep: "https",
            failedStep: "https",
            prepared: true,
            steps: steps(7, 7),
          })}
          canSuper
          audit={{ https: "Lee retried · 10 Oct 10:02" }}
        />,
      ),
    );
    const failed = mounted.container.querySelector('li[data-step="https"]');
    expect(failed?.getAttribute("data-state")).toBe("failed");
    expect(failed?.textContent).toContain("HTTPS check failed (525)");
    expect(failed?.textContent).toContain("3 attempts");
    const details = failed?.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(true);
    expect(details?.textContent).toContain("https_failed:525");
    expect(details?.textContent).toContain("Lee retried · 10 Oct 10:02");
    // Failed badge carries its word (never colour alone).
    expect(failed?.textContent).toContain("Failed");
    // Other steps have no open disclosure.
    expect(mounted.container.querySelectorAll("details[open]")).toHaveLength(1);
  });

  it("shows Retry step (the only primary) only when a step failed, and runs it", async () => {
    const retry = vi.fn(async () => ({
      ok: true as const,
      data: { message: "Retried step 8 (HTTPS). Done." },
    }));
    mounted = mount(
      wrap(
        <MoveTimeline
          orgId={ORG}
          business="Rivera Bakery"
          move={move()}
          canSuper
          actions={{ retry }}
        />,
      ),
    );
    expect(button(mounted.container, P14_COPY.BTN_RETRY_STEP)).toBeNull();
    mounted.unmount();
    mounted = mount(
      wrap(
        <MoveTimeline
          orgId={ORG}
          business="Rivera Bakery"
          move={move({
            status: "failed",
            currentStep: "https",
            failedStep: "https",
            steps: steps(7, 7),
          })}
          canSuper
          actions={{ retry }}
        />,
      ),
    );
    const btn = button(mounted.container, P14_COPY.BTN_RETRY_STEP);
    expect(btn).not.toBeNull();
    click(btn);
    await flush();
    expect(retry).toHaveBeenCalledWith(ORG);
    expect(document.body.textContent).toContain(
      "Retried step 8 (HTTPS). Done.",
    );
  });

  it("WR-E05: no Retry step on a cancelled move that still has a failed step", () => {
    mounted = mount(
      wrap(
        <MoveTimeline
          orgId={ORG}
          business="Rivera Bakery"
          move={move({
            status: "cancelled",
            currentStep: "https",
            failedStep: "https",
            steps: steps(7, 7),
          })}
          canSuper
          actions={{ retry: vi.fn() }}
        />,
      ),
    );
    expect(button(mounted.container, P14_COPY.BTN_RETRY_STEP)).toBeNull();
  });

  it("Re-take snapshot and Add zone file only before step 4", () => {
    const action = vi.fn();
    mounted = mount(
      wrap(
        <MoveTimeline
          orgId={ORG}
          business="Rivera Bakery"
          move={move()}
          canSuper={false}
          actions={{ retake: action, addZoneFile: action }}
        />,
      ),
    );
    expect(
      button(mounted.container, P14_COPY.BTN_RETAKE_SNAPSHOT),
    ).not.toBeNull();
    expect(
      button(mounted.container, P14_COPY.BTN_ADD_ZONE_FILE_STAFF),
    ).not.toBeNull();
    mounted.unmount();
    mounted = mount(
      wrap(
        <MoveTimeline
          orgId={ORG}
          business="Rivera Bakery"
          move={move({
            currentStep: "nameservers",
            status: "waiting_owner",
            steps: steps(3),
          })}
          canSuper={false}
          actions={{ retake: action, addZoneFile: action }}
        />,
      ),
    );
    expect(button(mounted.container, P14_COPY.BTN_RETAKE_SNAPSHOT)).toBeNull();
    expect(
      button(mounted.container, P14_COPY.BTN_ADD_ZONE_FILE_STAFF),
    ).toBeNull();
  });

  it("a support_agent sees Cancel move disabled with Super Admin only", () => {
    mounted = mount(
      wrap(
        <MoveTimeline
          orgId={ORG}
          business="Rivera Bakery"
          move={move()}
          canSuper={false}
          actions={{ cancel: vi.fn() }}
        />,
      ),
    );
    const btn = button(mounted.container, P14_COPY.BTN_CANCEL_MOVE);
    expect(btn?.disabled).toBe(true);
    const hint = document.getElementById(
      btn!.getAttribute("aria-describedby")!,
    );
    expect(hint?.textContent).toBe("Super Admin only");
  });

  it("Cancel move after delegation adds CANCEL-DELEGATED and needs a 10+ character reason", async () => {
    const cancel = vi.fn(async () => ({
      ok: true as const,
      data: { message: "Move cancelled." },
    }));
    mounted = mount(
      wrap(
        <MoveTimeline
          orgId={ORG}
          business="Rivera Bakery"
          move={move({
            currentStep: "site_records",
            status: "prepared",
            prepared: true,
            steps: steps(5),
          })}
          canSuper
          actions={{ cancel }}
        />,
      ),
    );
    click(button(mounted.container, P14_COPY.BTN_CANCEL_MOVE));
    const d = dialog();
    expect(d.textContent).toContain("Cancel the move to riverabakery.com?");
    expect(d.textContent).toContain(P14_COPY.CANCEL_DELEGATED);
    const confirm = d.querySelector<HTMLButtonElement>("[data-case-primary]");
    typeInto(d.querySelector("textarea"), "too short");
    expect(confirm?.disabled).toBe(true);
    typeInto(d.querySelector("textarea"), "Owner asked to stop the launch.");
    expect(confirm?.disabled).toBe(false);
    click(confirm);
    await flush();
    expect(cancel).toHaveBeenCalledWith(ORG, "Owner asked to stop the launch.");
  });

  it("Cancel move before delegation says the zone is deleted, without CANCEL-DELEGATED", () => {
    mounted = mount(
      wrap(
        <MoveTimeline
          orgId={ORG}
          business="Rivera Bakery"
          move={move()}
          canSuper
          actions={{ cancel: vi.fn() }}
        />,
      ),
    );
    click(button(mounted.container, P14_COPY.BTN_CANCEL_MOVE));
    const d = dialog();
    expect(d.textContent).toContain("The CDS zone is deleted.");
    expect(d.textContent).not.toContain(P14_COPY.CANCEL_DELEGATED);
    // Destructive: the safe button has focus.
    expect(document.activeElement?.textContent).toBe(P14_COPY.BTN_KEEP_MOVE);
  });

  it("no move: says so", () => {
    mounted = mount(
      wrap(
        <MoveTimeline
          orgId={ORG}
          business="Rivera Bakery"
          move={null}
          canSuper
        />,
      ),
    );
    expect(mounted.container.textContent).toContain(
      STAFF_DOMAIN_COPY.timeline.noMove,
    );
  });
});

const SUMMARY: StaffDomainSummaryData = {
  domain: "riverabakery.com",
  registrar: "GoDaddy",
  expiresAt: "2027-03-03T12:00:00.000Z",
  dnssec: "on",
  zone: { id: "zone123", status: "active" },
  nameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
  delegatedAt: "2026-10-10T14:14:00.000Z",
  primaryHost: "riverabakery.com",
  lastHealth: { at: "2026-10-17T11:00:00.000Z", incidents: [] },
};

describe("DomainSummary and HostsTable", () => {
  it("renders the rail as an open <details> with DNSSEC 'On at parent' in danger", () => {
    mounted = mount(wrap(<DomainSummary summary={SUMMARY} hosts={[]} />));
    const det = mounted.container.querySelector("details[data-domain-summary]");
    expect(det?.hasAttribute("open")).toBe(true);
    expect(det?.querySelector("summary")?.textContent).toBe("Domain details");
    const dnssec = mounted.container.querySelector("[data-dnssec]");
    expect(dnssec?.textContent).toBe("On at parent");
    expect(dnssec?.className).toContain("text-hub-danger");
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("GoDaddy · expires 3 Mar 2027");
    expect(text).toContain("ada.ns.cloudflare.com");
    expect(text).toContain("10 Oct 09:14");
    expect(text).toContain("17 Oct 06:00 · HTTPS ok · email records unchanged");
  });

  it("HostsTable shows kinds incl. redirect → x, and host text stays text", () => {
    mounted = mount(
      <HostsTable
        hosts={[
          {
            host: "riverabakery.com",
            kind: "custom",
            redirectTo: null,
            primary: true,
            verified: true,
            httpsOk: true,
            certDays: null,
          },
          {
            host: "old.example",
            kind: "redirect",
            redirectTo: "riverabakery.com",
            primary: false,
            verified: true,
            httpsOk: false,
            certDays: 12,
          },
          {
            host: "<img src=x onerror=alert(1)>",
            kind: "preview",
            redirectTo: null,
            primary: false,
            verified: true,
            httpsOk: null,
            certDays: null,
          },
        ]}
      />,
    );
    const table = mounted.container.querySelector("table");
    expect(table?.querySelector("caption")?.textContent).toBe(
      "Hosts for this site",
    );
    expect(table?.querySelectorAll('th[scope="col"]')).toHaveLength(5);
    expect(table?.textContent).toContain("redirect → riverabakery.com");
    expect(table?.textContent).toContain("failing · 12 days");
    expect(table?.querySelector("img")).toBeNull();
  });
});

describe("PostSwitchAlert", () => {
  it("renders nothing when closed", () => {
    mounted = mount(
      wrap(<PostSwitchAlert orgId={ORG} open={false} records={[]} />),
    );
    expect(mounted.container.textContent).toBe("");
  });

  it("names the differing records and re-runs the check", async () => {
    const rerun = vi.fn(async () => ({
      ok: true as const,
      data: { message: "Post-switch check passed." },
    }));
    mounted = mount(
      wrap(
        <PostSwitchAlert
          orgId={ORG}
          open
          ownerToldAt="2026-10-10T15:42:00.000Z"
          records={[
            {
              type: "MX",
              name: "riverabakery.com",
              copy: "10 mx.mail.example",
              publicAnswer: ["10 old.mail.example"],
            },
          ]}
          rerun={rerun}
        />,
      ),
    );
    const alert = mounted.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      "Post-switch check failed · 1 email-critical record differs at 1.1.1.1 and 8.8.8.8 · owner told to switch back 10 Oct 10:42",
    );
    expect(alert?.textContent).toContain("10 old.mail.example");
    click(button(mounted.container, P14_COPY.BTN_RERUN_POST_SWITCH));
    await flush();
    expect(rerun).toHaveBeenCalledWith(ORG);
    expect(document.body.textContent).toContain("Post-switch check passed.");
  });
});

const GATE: GateReportData = {
  snapshotAt: "2026-10-10T14:02:00.000Z",
  recordCount: 49,
  readBackFrom: "ada.ns.cloudflare.com",
  rules: [
    {
      rule: "G1",
      name: "G1 Exact copy",
      result: "fail",
      hardBlock: true,
      overridable: false,
    },
    {
      rule: "G2",
      name: "G2 Mail provider complete",
      result: "fail",
      hardBlock: false,
      overridable: true,
    },
    {
      rule: "G3",
      name: "G3 DNSSEC off",
      result: "pass",
      hardBlock: true,
      overridable: false,
    },
    {
      rule: "G4",
      name: "G4 CAA allows Let's Encrypt",
      result: "overridden",
      hardBlock: false,
      overridable: false,
      overriddenBy: "Lee",
      reason: "CAA added by CDS after review.",
    },
    {
      rule: "G5",
      name: "G5 Registrar-only services",
      result: "acknowledged",
      hardBlock: false,
      overridable: false,
    },
    {
      rule: "G6",
      name: "G6 One SPF",
      result: "pass",
      hardBlock: true,
      overridable: false,
    },
    {
      rule: "G7",
      name: "G7 Fresh (≤ 24 h)",
      result: "pass",
      hardBlock: false,
      overridable: false,
    },
  ],
  records: [
    {
      group: "site",
      type: "A",
      name: "riverabakery.com",
      original: "1.2.3.4",
      copy: "1.2.3.4",
      sources: ["zone_file", "sweep"],
      result: "match",
    },
    {
      group: "email",
      type: "MX",
      name: "riverabakery.com",
      original: "10 mx.example",
      copy: null,
      sources: ["scan"],
      result: "missing",
    },
    {
      group: "verification",
      type: "TXT",
      name: "riverabakery.com",
      original: "<script>alert(1)</script>",
      copy: "<script>alert(1)</script>",
      sources: ["zone_file"],
      result: "ttl",
    },
  ],
};

describe("GateReport and GateRuleList", () => {
  it("hard blocks show No override and no button; overridable fails get Override", () => {
    mounted = mount(
      wrap(
        <GateReport
          mode="forward"
          orgId={ORG}
          domain="riverabakery.com"
          gate={GATE}
          canSuper
          override={vi.fn()}
        />,
      ),
    );
    const g1 = mounted.container.querySelector('tr[data-rule="G1"]');
    expect(g1?.textContent).toContain("Fail");
    expect(g1?.textContent).toContain("No override");
    expect(g1?.querySelector("button")).toBeNull();
    const g3 = mounted.container.querySelector('tr[data-rule="G3"]');
    expect(g3?.textContent).toContain("Pass");
    expect(g3?.textContent).toContain(P14_COPY.NO_OVERRIDE);
    const g2 = mounted.container.querySelector('tr[data-rule="G2"]');
    expect(g2?.querySelector("button")?.textContent).toBe("Override");
    expect(g2?.textContent).not.toContain("No override");
    const g4 = mounted.container.querySelector('tr[data-rule="G4"]');
    expect(g4?.textContent).toContain("Overridden by Lee");
    expect(g4?.querySelector("[title]")?.getAttribute("title")).toBe(
      "CAA added by CDS after review.",
    );
    expect(
      mounted.container.querySelector('tr[data-rule="G5"]')?.textContent,
    ).toContain("Acknowledged by owner");
  });

  it("Override opens the case dialog with Keep the block focused and sends the reason", async () => {
    const override = vi.fn(async () => ({
      ok: true as const,
      data: { message: "G2 overridden." },
    }));
    mounted = mount(
      wrap(
        <GateReport
          mode="forward"
          orgId={ORG}
          domain="riverabakery.com"
          gate={GATE}
          canSuper
          override={override}
        />,
      ),
    );
    click(button(mounted.container, "Override G2"));
    const d = dialog();
    expect(d.textContent).toContain("Override G2 for riverabakery.com?");
    expect(d.textContent).toContain("The owner's nameserver step unlocks.");
    expect(document.activeElement?.textContent).toBe(P14_COPY.BTN_KEEP_BLOCK);
    typeInto(
      d.querySelector("textarea"),
      "Provider confirmed set is complete.",
    );
    click(d.querySelector("[data-case-primary]"));
    await flush();
    expect(override).toHaveBeenCalledWith(
      ORG,
      "G2",
      "Provider confirmed set is complete.",
    );
  });

  it("a support_agent sees Override disabled with Super Admin only", () => {
    mounted = mount(
      wrap(
        <GateReport
          mode="forward"
          orgId={ORG}
          domain="riverabakery.com"
          gate={GATE}
          canSuper={false}
          override={vi.fn()}
        />,
      ),
    );
    const g2 = mounted.container.querySelector('tr[data-rule="G2"]');
    expect(g2?.querySelector("button")?.disabled).toBe(true);
    expect(g2?.textContent).toContain("Super Admin only");
  });

  it("records: grouped email first, Problems by default, All shows everything; values stay text", () => {
    mounted = mount(
      wrap(
        <GateReport
          mode="forward"
          orgId={ORG}
          domain="riverabakery.com"
          gate={GATE}
          canSuper
        />,
      ),
    );
    const table = () =>
      mounted!.container.querySelector("table[data-gate-records]")!;
    const headers = [...table().querySelectorAll('thead th[scope="col"]')].map(
      (th) => th.textContent,
    );
    expect(headers).toEqual([
      "Type",
      "Name",
      "Original",
      "Copy (read from assigned NS)",
      "Source",
      "Result",
    ]);
    // Problems first: only the missing MX.
    expect(table().querySelectorAll("tbody tr[data-result]")).toHaveLength(1);
    expect(table().textContent).toContain("Missing");
    click(mounted.container.querySelector('[role="radio"][data-value="all"]'));
    const groups = [...table().querySelectorAll("tbody[data-group]")].map((t) =>
      t.getAttribute("data-group"),
    );
    expect(groups).toEqual(["email", "verification", "site"]);
    expect(table().textContent).toContain("zone file, sweep");
    expect(table().textContent).toContain("Match · TTL differs");
    expect(table().querySelector("script")).toBeNull();
    expect(table().textContent).toContain("<script>alert(1)</script>");
    expect(
      mounted.container.querySelector("[data-gate-footer]")?.textContent,
    ).toBe(
      "Snapshot 10 Oct 09:02 · 49 records · read back from ada.ns.cloudflare.com",
    );
  });

  it("reverse mode relabels Original/Copy and hides G2-G7", () => {
    mounted = mount(
      wrap(
        <GateReport
          mode="reverse"
          orgId={ORG}
          domain="riverabakery.com"
          gate={GATE}
          canSuper
          override={vi.fn()}
        />,
      ),
    );
    const rules = [...mounted.container.querySelectorAll("tr[data-rule]")].map(
      (r) => r.getAttribute("data-rule"),
    );
    expect(rules).toEqual(["G1"]);
    const headers = [
      ...mounted.container.querySelectorAll(
        "table[data-gate-records] thead th",
      ),
    ].map((th) => th.textContent);
    expect(headers).toContain("CDS zone");
    expect(headers).toContain("Destination answers");
    expect(headers).not.toContain("Original");
    expect(button(mounted.container, /Override/)).toBeNull();
  });

  it("no snapshot: says so", () => {
    mounted = mount(
      wrap(
        <GateReport
          mode="forward"
          orgId={ORG}
          domain="x.com"
          gate={null}
          canSuper
        />,
      ),
    );
    expect(mounted.container.textContent).toContain("No snapshot yet.");
  });
});

describe("MoveDomainDialog", () => {
  it("support_agent sees Move domain disabled with Super Admin only; not live renders nothing", () => {
    mounted = mount(
      wrap(
        <MoveDomainButton
          orgId={ORG}
          business="Rivera Bakery"
          currentDomain="riverabakery.com"
          canSuper={false}
          live
          action={vi.fn()}
        />,
      ),
    );
    expect(button(mounted.container, P14_COPY.BTN_MOVE_DOMAIN)?.disabled).toBe(
      true,
    );
    expect(mounted.container.textContent).toContain("Super Admin only");
    mounted.unmount();
    mounted = mount(
      wrap(
        <MoveDomainButton
          orgId={ORG}
          business="Rivera Bakery"
          currentDomain="riverabakery.com"
          canSuper
          live={false}
          action={vi.fn()}
        />,
      ),
    );
    expect(mounted.container.textContent).toBe("");
  });

  it("new domain, then the case dialog with a reason, then Start move", async () => {
    const message =
      "Move started. Rivera Bakery's owner was asked to connect riverabakery.net.";
    const action = vi.fn(async () => ({
      ok: true as const,
      data: { message },
    }));
    mounted = mount(
      wrap(
        <MoveDomainButton
          orgId={ORG}
          business="Rivera Bakery"
          currentDomain="riverabakery.com"
          canSuper
          live
          action={action}
        />,
      ),
    );
    click(button(mounted.container, P14_COPY.BTN_MOVE_DOMAIN));
    let d = dialog();
    expect(d.textContent).toContain(
      "The site stays on riverabakery.com until the move finishes.",
    );
    typeInto(d.querySelector("input"), "shop.riverabakery.net");
    click(button(d, "Next"));
    expect(d.textContent).toContain("Enter the main domain, not a subdomain.");
    typeInto(d.querySelector("input"), "https://www.RiveraBakery.net/");
    click(button(d, "Next"));
    d = dialog();
    expect(d.textContent).toContain("Move Rivera Bakery to riverabakery.net?");
    expect(document.activeElement?.textContent).toBe(P14_COPY.BTN_NOT_NOW);
    const confirm = d.querySelector<HTMLButtonElement>("[data-case-primary]");
    expect(confirm?.textContent).toBe(P14_COPY.BTN_START_MOVE);
    expect(confirm?.disabled).toBe(true);
    typeInto(
      d.querySelector("textarea"),
      "Owner rebranded to the .net domain.",
    );
    click(confirm);
    await flush();
    expect(action).toHaveBeenCalledWith(ORG, {
      domain: "riverabakery.net",
      reason: "Owner rebranded to the .net domain.",
    });
    expect(document.body.textContent).toContain(message);
  });
});
