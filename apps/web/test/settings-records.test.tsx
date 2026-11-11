// @vitest-environment jsdom
// 14-32: Settings › Domain › DNS records, email setup and Integrations (choice 5; DOM-03, ONB-10,
// CONT-16; T-14-32-01..03). The view models (groups, actions per row, preview changes, current
// provider), the server render of the records view (groups in order, owner toolbar, Admin
// read-only), the email setup view (owner flow vs Admin read), and the actions: input narrowed
// before any @cds/db call, the session ctx passed, refusals mapped to their field and copy, and
// Ask to change filing a P12 change ticket.
import { Forbidden, InvalidInput } from "@cds/core";
import { P14_COPY, SpfMergeError } from "@cds/core/dns";
import type { EmailSetupPreview, OwnerDnsRecordsView } from "@cds/db";
import { ToastRegion } from "@cds/ui/hub";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/hub/settings",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(async () => false),
  requireHubSession: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("../lib/agreement-gate", () => ({ AGREEMENT_GATE_COPY: "gate" }));

const db = vi.hoisted(() => {
  class OwnerRecordRefused extends Error {
    readonly code = "invalid_input";
    constructor(
      readonly reason: string,
      message: string,
    ) {
      super(message);
    }
  }
  class EmailSetupWriteFailed extends Error {
    readonly code = "email_write_failed";
  }
  return {
    OwnerRecordRefused,
    EmailSetupWriteFailed,
    ownerAddRecord: vi.fn(),
    ownerRemoveRecord: vi.fn(),
    ownerEmailSetupPreview: vi.fn(),
    ownerApplyEmailSetup: vi.fn(),
    fileTicket: vi.fn(),
    ownerDomainView: vi.fn(),
  };
});
vi.mock("@cds/db", () => db);

// The client islands import the actions; the render tests use stubs, the action tests the
// real module (importActual) over the mocked @cds/db.
vi.mock("../app/actions/dns-records", () => ({
  addRecordAction: vi.fn(),
  removeRecordAction: vi.fn(),
  emailSetupPreviewAction: vi.fn(),
  applyEmailSetupAction: vi.fn(),
  askToChangeAction: vi.fn(),
  askEmailSetupAction: vi.fn(),
}));
const A = await vi.importActual<typeof import("../app/actions/dns-records")>(
  "../app/actions/dns-records",
);
const { recordGroups, emailPreviewView, currentEmail, relativeName } =
  await import("../app/(platform)/hub/settings/records-view");
const { DnsRecordsView } =
  await import("../app/(platform)/hub/settings/DnsRecordsView");
const { EmailSetupView } =
  await import("../app/(platform)/hub/settings/EmailSetupView");
const { buildIntegrationsView, agoWords } =
  await import("../app/(platform)/hub/settings/integrations-view");
const { IntegrationsPanel } =
  await import("../app/(platform)/hub/settings/IntegrationsPanel");
const { HUB_SECTIONS } = await import("../app/(platform)/hub/sections");
const { SETTINGS_TABS } = await import("../app/(platform)/hub/settings/tabs");
const { composeAddonRegistry } = await import("@cds/core/addons");

const DOMAIN = "riverabakery.com";

function recordsView(
  over: Partial<OwnerDnsRecordsView> = {},
): OwnerDnsRecordsView {
  return {
    domain: DOMAIN,
    canEdit: true,
    groups: [
      {
        key: "email",
        records: [
          {
            id: "r1",
            type: "MX",
            name: DOMAIN,
            value: "mx.zoho.com",
            priority: 10,
            label: "email",
            removable: false,
            pending: false,
          },
        ],
      },
      {
        key: "verification",
        records: [
          {
            id: "r2",
            type: "TXT",
            name: DOMAIN,
            value: "google-site-verification=abc",
            label: "yours",
            removable: true,
            pending: false,
          },
        ],
      },
      {
        key: "site",
        records: [
          {
            id: "r3",
            type: "A",
            name: DOMAIN,
            value: "192.0.2.10",
            label: "cds",
            removable: false,
            pending: false,
          },
        ],
      },
      { key: "sending", records: [] },
      {
        key: "other",
        records: [
          {
            id: "r4",
            type: "CNAME",
            name: `shop.${DOMAIN}`,
            value: "shops.example.net",
            label: "yours",
            removable: false,
            pending: false,
          },
        ],
      },
    ],
    ...over,
  };
}

function html(node: ReactNode): string {
  return renderToStaticMarkup(<ToastRegion>{node}</ToastRegion>);
}

function dom(markup: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = markup;
  return div;
}

beforeEach(() => {
  for (const f of Object.values(db)) {
    if (typeof f === "function" && "mockReset" in f) {
      (f as ReturnType<typeof vi.fn>).mockReset();
    }
  }
  sess.getHubSession.mockReset();
  sess.getHubSession.mockResolvedValue({ ctx: CTX });
  cache.revalidatePath.mockReset();
});

describe("records-view", () => {
  it("apex shows as @; Remove on removable Yours, Ask on other Yours, none on CDS/email", () => {
    expect(relativeName(DOMAIN, DOMAIN)).toBe("@");
    const groups = recordGroups(recordsView(), { canEdit: true });
    const rows = groups.flatMap((g) => g.records);
    const by = (k: string) => rows.find((r) => r.key === k);
    expect(by("r1")).toMatchObject({ name: "@", manager: "email" });
    expect(by("r1")?.action).toBeUndefined();
    expect(by("r2")?.action).toBe("remove");
    expect(by("r3")?.action).toBeUndefined();
    expect(by("r4")).toMatchObject({ action: "ask", name: `shop.${DOMAIN}` });
  });

  it("read-only builds no actions", () => {
    const rows = recordGroups(recordsView(), { canEdit: false }).flatMap(
      (g) => g.records,
    );
    expect(rows.every((r) => r.action === undefined)).toBe(true);
  });

  it("emailPreviewView: Replace for MX over another set, Update for a merged SPF, Add otherwise", () => {
    const preview: EmailSetupPreview = {
      preset: "google",
      provider: "Google Workspace",
      currentProvider: "Zoho Mail",
      add: [
        { type: "MX", name: DOMAIN, value: "smtp.google.com", priority: 1 },
        {
          type: "TXT",
          name: DOMAIN,
          value: "v=spf1 include:zoho.com include:_spf.google.com ~all",
        },
        { type: "TXT", name: DOMAIN, value: "google-site-verification=x" },
        {
          type: "TXT",
          name: `google._domainkey.${DOMAIN}`,
          value: "v=DKIM1; p=abc",
        },
      ],
      replace: [
        { type: "MX", name: DOMAIN, value: "mx.zoho.com", priority: 10 },
        { type: "TXT", name: DOMAIN, value: "v=spf1 include:zoho.com ~all" },
      ],
      remove: [],
      spf: {
        before: "v=spf1 include:zoho.com ~all",
        after: "v=spf1 include:zoho.com include:_spf.google.com ~all",
      },
      replacesProvider: "Zoho Mail",
    };
    const v = emailPreviewView(preview);
    expect(v.replacesProvider).toBe("Zoho Mail");
    expect(v.spfInclude).toBe("_spf.google.com");
    const email = v.groups.find((g) => g.key === "email")!.records;
    expect(email.map((r) => [r.type, r.change])).toEqual([
      ["MX", "replace"],
      ["TXT", "update"],
      ["TXT", "add"],
    ]);
    const ver = v.groups.find((g) => g.key === "verification")!.records;
    expect(ver).toHaveLength(1);
    expect(ver[0]!.change).toBe("add");
  });

  it("currentEmail detects the provider and its preset from the apex MX", () => {
    expect(currentEmail(recordsView())).toEqual({
      name: "Zoho Mail",
      preset: "zoho",
    });
    expect(
      currentEmail(recordsView({ groups: [{ key: "email", records: [] }] })),
    ).toEqual({ name: null, preset: null });
  });
});

describe("DnsRecordsView (server render)", () => {
  it("owner: intro, toolbar, groups in order with Who manages it, row actions", () => {
    const root = dom(
      html(<DnsRecordsView records={recordsView()} adminRead={false} />),
    );
    expect(root.textContent).toContain("DNS records");
    expect(root.textContent).toContain(P14_COPY.RECORDS_INTRO);
    expect(root.querySelector("[data-records-toolbar]")?.textContent).toContain(
      P14_COPY.BTN_ADD_A_RECORD,
    );
    expect(root.textContent).toContain(P14_COPY.BTN_SET_UP_EMAIL);
    const order = Array.from(root.querySelectorAll("[data-group]")).map((s) =>
      s.getAttribute("data-group"),
    );
    expect(order).toEqual([
      "email",
      "verification",
      "site",
      "sending",
      "other",
    ]);
    expect(root.textContent).toContain("Who manages it");
    expect(root.textContent).toContain(P14_COPY.BTN_CHANGE_EMAIL_SETUP);
    expect(
      root.querySelector(`[aria-label="Remove TXT record for ${DOMAIN}"]`),
    ).not.toBeNull();
    expect(
      root.querySelector(
        `[aria-label="Ask to change CNAME record for shop.${DOMAIN}"]`,
      ),
    ).not.toBeNull();
    expect(root.textContent).not.toContain(P14_COPY.DOM_ADMIN_READ);
  });

  it("Admin: same list, no toolbar, no row actions, DOMAIN-ADMIN-READ", () => {
    const root = dom(
      html(<DnsRecordsView records={recordsView()} adminRead />),
    );
    expect(
      root
        .querySelector("[data-dns-records]")
        ?.getAttribute("data-dns-records"),
    ).toBe("read");
    expect(root.querySelector("[data-records-toolbar]")).toBeNull();
    expect(root.textContent).toContain(P14_COPY.DOM_ADMIN_READ);
    expect(root.textContent).not.toContain(P14_COPY.BTN_REMOVE);
    expect(root.textContent).not.toContain(P14_COPY.BTN_ASK_TO_CHANGE);
    expect(root.textContent).not.toContain(P14_COPY.BTN_CHANGE_EMAIL_SETUP);
    expect(root.textContent).toContain("mx.zoho.com");
  });

  it("closed feature (canEdit false) renders read-only too", () => {
    const root = dom(
      html(
        <DnsRecordsView
          records={recordsView({ canEdit: false })}
          adminRead={false}
        />,
      ),
    );
    expect(root.querySelector("[data-records-toolbar]")).toBeNull();
  });
});

describe("EmailSetupView (server render)", () => {
  it("owner: the flow on step 1 with the current provider marked", () => {
    const root = dom(
      html(<EmailSetupView records={recordsView()} adminRead={false} />),
    );
    expect(root.textContent).toContain("Step 1 of 3");
    expect(root.textContent).toContain("Who provides your email?");
    const zoho = root.querySelector('input[value="zoho"]')?.closest("label");
    expect(zoho?.textContent).toContain("Your current email");
    expect(root.textContent).toContain(P14_COPY.BTN_DNS_RECORDS);
  });

  it("Admin: current provider read-only, no flow", () => {
    const root = dom(
      html(<EmailSetupView records={recordsView()} adminRead />),
    );
    expect(root.querySelector('input[type="radio"]')).toBeNull();
    expect(root.textContent).toContain("Zoho Mail");
    expect(root.textContent).toContain(P14_COPY.DOM_ADMIN_READ);
  });
});

describe("addRecordAction / removeRecordAction", () => {
  it("narrows type, name and value before any @cds/db call", async () => {
    expect((await A.addRecordAction(null)).ok).toBe(false);
    expect(
      (await A.addRecordAction({ type: "MX", name: "a", value: "b" })).ok,
    ).toBe(false);
    const noName = await A.addRecordAction({
      type: "TXT",
      name: " ",
      value: "x",
    });
    expect(noName).toMatchObject({ ok: false, field: "name" });
    const noValue = await A.addRecordAction({
      type: "TXT",
      name: "@",
      value: "",
    });
    expect(noValue).toMatchObject({
      ok: false,
      field: "value",
      message: P14_COPY.REC_VALUE_EMPTY,
    });
    const huge = await A.addRecordAction({
      type: "TXT",
      name: "@",
      value: "x".repeat(5000),
    });
    expect(huge.ok).toBe(false);
    expect(db.ownerAddRecord).not.toHaveBeenCalled();
  });

  it("calls ownerAddRecord with the session ctx and revalidates", async () => {
    db.ownerAddRecord.mockResolvedValue({});
    const res = await A.addRecordAction({
      type: "CNAME",
      name: " em123 ",
      value: "u1.wl.sendgrid.net",
      orgId: "evil",
    });
    expect(res).toEqual({ ok: true, data: { type: "CNAME" } });
    expect(db.ownerAddRecord).toHaveBeenCalledWith(CTX, {
      type: "CNAME",
      name: "em123",
      value: "u1.wl.sendgrid.net",
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/hub/settings");
  });

  it("maps OwnerRecordRefused to REC-* on its field (T-14-32-01)", async () => {
    db.ownerAddRecord.mockRejectedValue(
      new db.OwnerRecordRefused("protected", P14_COPY.REC_PROTECTED),
    );
    expect(
      await A.addRecordAction({ type: "TXT", name: "_dmarc", value: "v" }),
    ).toEqual({
      ok: false,
      code: "REC-PROTECTED",
      message: P14_COPY.REC_PROTECTED,
      field: "name",
    });
    db.ownerAddRecord.mockRejectedValue(
      new db.OwnerRecordRefused("spf", P14_COPY.REC_SPF),
    );
    expect(
      await A.addRecordAction({ type: "TXT", name: "@", value: "v=spf1 -all" }),
    ).toMatchObject({ code: "REC-SPF", field: "value" });
  });

  it("an Admin is refused with DOMAIN-ADMIN-READ", async () => {
    db.ownerAddRecord.mockRejectedValue(new Forbidden());
    expect(
      await A.addRecordAction({ type: "TXT", name: "@", value: "x" }),
    ).toMatchObject({ ok: false, message: P14_COPY.DOM_ADMIN_READ });
  });

  it("remove takes a bounded id string and calls ownerRemoveRecord", async () => {
    expect((await A.removeRecordAction(42)).ok).toBe(false);
    expect((await A.removeRecordAction("x".repeat(101))).ok).toBe(false);
    expect(db.ownerRemoveRecord).not.toHaveBeenCalled();
    db.ownerRemoveRecord.mockResolvedValue(undefined);
    expect(await A.removeRecordAction("fr_2")).toEqual({
      ok: true,
      data: null,
    });
    expect(db.ownerRemoveRecord).toHaveBeenCalledWith(CTX, "fr_2");
  });
});

describe("email setup actions", () => {
  const PREVIEW: EmailSetupPreview = {
    preset: "google",
    provider: "Google Workspace",
    currentProvider: null,
    add: [{ type: "MX", name: DOMAIN, value: "smtp.google.com", priority: 1 }],
    replace: [],
    remove: [],
    spf: { before: null, after: "v=spf1 include:_spf.google.com ~all" },
    replacesProvider: null,
  };

  it("preview narrows the preset and values, returns the step 3 view, no revalidate", async () => {
    expect((await A.emailSetupPreviewAction({ preset: "aol" })).ok).toBe(false);
    expect(
      (await A.emailSetupPreviewAction({ preset: "google", values: "x" })).ok,
    ).toBe(false);
    expect(db.ownerEmailSetupPreview).not.toHaveBeenCalled();
    db.ownerEmailSetupPreview.mockResolvedValue(PREVIEW);
    const res = await A.emailSetupPreviewAction({
      preset: "google",
      values: { verification: "google-site-verification=abc", extra: 1 },
    });
    expect(res.ok).toBe(true);
    expect(db.ownerEmailSetupPreview).toHaveBeenCalledWith(CTX, "google", {
      verification: "google-site-verification=abc",
    });
    if (res.ok) {
      expect(res.data.spfInclude).toBe("_spf.google.com");
      expect(res.data.groups[0]!.records[0]!.change).toBe("add");
    }
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("a bad pasted value comes back on its field as EMAIL-VALUE-FORMAT", async () => {
    db.ownerEmailSetupPreview.mockRejectedValue(
      new InvalidInput("Email preset value is not valid: verification"),
    );
    expect(
      await A.emailSetupPreviewAction({
        preset: "google",
        values: { verification: "nope" },
      }),
    ).toEqual({
      ok: false,
      code: "EMAIL-VALUE-FORMAT",
      field: "verification",
      message: P14_COPY.EMAIL_VALUE_FORMAT({
        service: "Google Workspace",
        prefix: "google-site-verification=",
      }),
    });
  });

  it("a refused SPF merge asks for CDS Support", async () => {
    db.ownerEmailSetupPreview.mockRejectedValue(
      new SpfMergeError("too_many_lookups"),
    );
    const res = await A.emailSetupPreviewAction({ preset: "zoho", values: {} });
    expect(res).toMatchObject({ ok: false, code: "EMAIL-SPF" });
    if (!res.ok) expect(res.message).toContain("Ask CDS to set it up");
  });

  it("apply passes replaceConfirmed only when exactly true", async () => {
    db.ownerApplyEmailSetup.mockResolvedValue(PREVIEW);
    await A.applyEmailSetupAction({
      preset: "google",
      values: {},
      replaceConfirmed: "yes",
    });
    expect(db.ownerApplyEmailSetup).toHaveBeenLastCalledWith(
      CTX,
      "google",
      {},
      { replaceConfirmed: false },
    );
    const ok = await A.applyEmailSetupAction({
      preset: "google",
      values: {},
      replaceConfirmed: true,
    });
    expect(ok).toEqual({ ok: true, data: { provider: "Google Workspace" } });
    expect(db.ownerApplyEmailSetup).toHaveBeenLastCalledWith(
      CTX,
      "google",
      {},
      { replaceConfirmed: true },
    );
  });

  it("missing confirmation keeps REPLACE-WARN; a write failure is EMAIL-WRITE-FAILED", async () => {
    const warn = P14_COPY.REPLACE_WARN({
      current: "Zoho Mail",
      next: "Google Workspace",
    });
    db.ownerApplyEmailSetup.mockRejectedValue(new InvalidInput(warn));
    expect(
      await A.applyEmailSetupAction({ preset: "google", values: {} }),
    ).toMatchObject({ ok: false, message: warn });
    db.ownerApplyEmailSetup.mockRejectedValue(new db.EmailSetupWriteFailed());
    expect(
      await A.applyEmailSetupAction({ preset: "google", values: {} }),
    ).toEqual({
      ok: false,
      code: "EMAIL-WRITE-FAILED",
      message: P14_COPY.EMAIL_WRITE_FAILED,
    });
  });
});

describe("Ask to change", () => {
  it("files a change ticket with the record as plain text (whole site)", async () => {
    db.fileTicket.mockResolvedValue({ number: 1042, id: "t1" });
    const res = await A.askToChangeAction({
      type: "CNAME",
      name: `shop.${DOMAIN}`,
      value: "<b>shops.example.net</b>",
    });
    expect(res).toEqual({ ok: true, data: { number: 1042 } });
    const [ctx, input] = db.fileTicket.mock.calls[0]!;
    expect(ctx).toBe(CTX);
    expect(input).toMatchObject({
      type: "change",
      subject: "Change a DNS record",
    });
    expect(input.target).toBeUndefined();
    expect(input.body).toContain("Type: CNAME");
    expect(input.body).toContain(`Name: shop.${DOMAIN}`);
    expect(input.body).toContain("Value: <b>shops.example.net</b>");
  });

  it("refuses an unknown type or missing name without filing", async () => {
    expect(
      (await A.askToChangeAction({ type: "BOGUS", name: "a", value: "b" })).ok,
    ).toBe(false);
    expect((await A.askToChangeAction({ type: "TXT", value: "b" })).ok).toBe(
      false,
    );
    expect(db.fileTicket).not.toHaveBeenCalled();
  });

  it("Ask CDS to set it up files the email setup change ticket", async () => {
    db.fileTicket.mockResolvedValue({ number: 7, id: "t7" });
    expect(await A.askEmailSetupAction()).toEqual({
      ok: true,
      data: { number: 7 },
    });
    expect(db.fileTicket.mock.calls[0]![1]).toMatchObject({
      type: "change",
      subject: "Set up email for my domain",
    });
  });
});

describe("Settings › Integrations (choice 4)", () => {
  const LIVE = {
    live: true,
    ga4MeasurementId: "G-ABC123",
    searchConsole: true,
    lastSubmitAt: "2026-10-09T10:00:00.000Z",
    lastSubmitResult: "logged" as const,
    lastPingAt: "2026-10-17T06:00:00.000Z",
    lastPingResult: "ok" as const,
  };
  const NOW = new Date("2026-10-17T08:00:00.000Z");

  it("sits after Billing; Owner and Admin see it, an Editor or Viewer does not", () => {
    const ids = SETTINGS_TABS.map((t) => t.id);
    expect(ids.indexOf("integrations")).toBe(ids.indexOf("billing") + 1);
    const registry = composeAddonRegistry([], { fileExists: () => true });
    const tabs = (role: string) =>
      HUB_SECTIONS.settings
        .tabs({ role, grants: [], registry, active: [] } as never)
        .map((t) => t.id);
    expect(tabs("owner")).toContain("integrations");
    expect(tabs("admin")).toContain("integrations");
    expect(tabs("editor")).not.toContain("integrations");
    expect(tabs("viewer")).not.toContain("integrations");
  });

  it("prelaunch: NotLiveYet with INTEG-PRELAUNCH naming the domain", () => {
    const view = buildIntegrationsView(
      { ...LIVE, live: false },
      { domain: DOMAIN, now: NOW },
    );
    expect(view).toEqual({
      live: false,
      prelaunch: P14_COPY.INTEG_PRELAUNCH({ domain: DOMAIN }),
    });
    const root = dom(html(<IntegrationsPanel view={view} />));
    expect(
      root
        .querySelector("[data-integrations]")
        ?.getAttribute("data-integrations"),
    ).toBe("prelaunch");
    expect(root.textContent).toContain(
      P14_COPY.INTEG_PRELAUNCH({ domain: DOMAIN }),
    );
    expect(root.querySelector("[data-integration]")).toBeNull();
  });

  it("live: four rows; stand-in results read like real ones (no stand-in marker)", () => {
    const view = buildIntegrationsView(LIVE, { domain: DOMAIN, now: NOW });
    const root = dom(html(<IntegrationsPanel view={view} />));
    const row = (k: string) =>
      root.querySelector(`[data-integration="${k}"] dd`)?.textContent;
    expect(root.textContent).toContain("Search engines and analytics");
    expect(row("ga")).toBe(
      "G-ABC123 · loads only after visitors accept cookies",
    );
    expect(row("gsc")).toBe("Connected · sitemap sent 9 Oct");
    expect(row("bing")).toBe("Sitemap sent 9 Oct");
    expect(row("indexnow")).toBe(
      "On · search engines told about your last change 2 hours ago",
    );
    expect(root.textContent?.toLowerCase()).not.toContain("stand-in");
    expect(root.textContent).not.toContain("logged");
  });

  it("live with nothing set: Not connected rows, muted, never an error", () => {
    const view = buildIntegrationsView(
      {
        live: true,
        ga4MeasurementId: null,
        searchConsole: false,
        lastSubmitAt: null,
        lastSubmitResult: null,
        lastPingAt: "2026-10-17T06:00:00.000Z",
        lastPingResult: "error",
      },
      { domain: DOMAIN, now: NOW },
    );
    if (!view.live) throw new Error("expected live");
    expect(view.rows.map((r) => [r.key, r.value, r.muted])).toEqual([
      ["ga", "Not connected", true],
      ["gsc", "Not connected", true],
      ["bing", "Not connected", true],
      ["indexnow", "On", false],
    ]);
    const root = dom(html(<IntegrationsPanel view={view} />));
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it("agoWords: minutes, hours, days", () => {
    expect(agoWords("2026-10-17T07:59:30.000Z", NOW)).toBe("just now");
    expect(agoWords("2026-10-17T07:55:00.000Z", NOW)).toBe("5 minutes ago");
    expect(agoWords("2026-10-17T07:00:00.000Z", NOW)).toBe("1 hour ago");
    expect(agoWords("2026-10-14T08:00:00.000Z", NOW)).toBe("3 days ago");
  });
});
