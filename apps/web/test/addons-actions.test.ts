// 05-11 Task 2: Get add-ons server actions (ADDON-05, ADDON-07, ADDON-09; T-05-53..T-05-56).
// The real session module runs against mocked next/headers and @cds/db; the registry is the
// real add-ons plus the test-only fixtures (a private one, one with a requirement).
import {
  AddonMissingRequirement,
  AddonRequiredBy,
  composeAddonRegistry,
} from "@cds/core/addons";
import {
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  NotFound,
} from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_CONFLICTS,
  FIXTURE_NEEDS,
  FIXTURE_PRIVATE,
  FIXTURE_QUOTE,
  fixtureManifest,
} from "../../../packages/core/src/addons/__fixtures__/manifests";
import { MANIFESTS } from "../../../packages/addon-registry/src/generated/manifests";

const state = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  installAddon: vi.fn(),
  uninstallAddon: vi.fn(),
  activeAddons: vi.fn(),
  listPages: vi.fn(),
  registerAddonCollections: vi.fn(),
  registerSectionAddonOwners: vi.fn(),
  getBillingGate: vi.fn(() => ({ approve: vi.fn() })),
  getContentScanner: vi.fn(() => ({ scan: vi.fn() })),
  getSearchPinger: vi.fn(() => ({ ping: vi.fn() })),
  previewAddonCharge: vi.fn(),
  billingPortalLink: vi.fn(),
  // The listing read: every public manifest available. A failed read refuses adding
  // (WR-D09), so the add actions need a working one.
  publicCatalogView: vi.fn(
    async (ms: { slug: string; name: string; visibility: string }[]) =>
      ms
        .filter((m) => m.visibility === "public")
        .map((m) => ({
          slug: m.slug,
          name: m.name,
          sort: 1,
          pickable: true,
          screenshots: [],
        })),
  ),
  CARD_DECLINED_COPY:
    "Your card was declined. Update it in Settings › Billing.",
  CHARGE_PRICE_CHANGED_COPY:
    "The price changed since you opened this. Check the new figure, then confirm again.",
  PAUSED_NO_ADD_COPY:
    "Your add-ons are paused until your overdue bill is paid. Pay it first, then add new ones.",
  UNPRICED_ADDON_COPY:
    "We're finalising this price. You'll be able to add it soon.",
}));
vi.mock("@cds/db", () => db);

const registry = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@cds/addon-registry/server", () => ({
  get ADDON_REGISTRY() {
    return registry.value;
  },
  ADDON_SERVER: {},
}));
/** A needs B needs C: fixture-deep needs fixture-needs, which needs fixture-quote (C-WR-02). */
const FIXTURE_DEEP = fixtureManifest({
  slug: "fixture-deep",
  order: 925,
  requires: ["fixture-needs"],
});
registry.value = composeAddonRegistry(
  [
    ...MANIFESTS,
    FIXTURE_QUOTE,
    FIXTURE_PRIVATE,
    FIXTURE_NEEDS,
    FIXTURE_CONFLICTS,
    FIXTURE_DEEP,
  ],
  { fileExists: () => true },
);

const {
  addAddonAction,
  addAddonPreviewAction,
  addBothAction,
  removeAddonAction,
  updateCardAction,
} = await import("../app/actions/addons");
const {
  addMoneyBlock,
  addonPriceLabel,
  availability,
  missingRequirements,
  removeBillLine,
} = await import("../app/(platform)/hub/add-ons/catalog-logic");

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const ORG = { id: "org1", name: "Palm", primaryHost: "palm.example" };
const NOT_FOUND =
  "This was removed or moved. Reload the page to see the latest.";

beforeEach(() => {
  vi.clearAllMocks();
  state.jar.clear();
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "owner@palm.example",
    organizations: [ORG],
  });
  db.orgContextFromToken.mockResolvedValue(CTX);
  db.activeAddons.mockResolvedValue([]);
  db.listPages.mockResolvedValue([
    { id: "p9", slug: "testimonials", title: "Testimonials" },
  ]);
  db.installAddon.mockImplementation(async (_ctx, _deps, slug: string) => ({
    slug,
    outcome: "installed",
    page: slug === "testimonials" ? { id: "p9", slug: "testimonials" } : null,
  }));
  db.uninstallAddon.mockImplementation(async (_ctx, _deps, slug: string) => ({
    slug,
    outcome: "removed",
  }));
});

describe("slug allowlist (T-05-54, T-05-55)", () => {
  it("refuses an unknown and a private slug identically, without calling the chokepoint", async () => {
    const unknown = await addAddonAction("no-such-addon");
    const priv = await addAddonAction("fixture-private");
    expect(unknown).toEqual({
      ok: false,
      code: "not_found",
      message: NOT_FOUND,
    });
    expect(priv).toEqual(unknown);
    expect(await addBothAction("fixture-private")).toEqual(unknown);
    expect(await removeAddonAction("no-such-addon")).toEqual(unknown);
    expect(db.installAddon).not.toHaveBeenCalled();
    expect(db.uninstallAddon).not.toHaveBeenCalled();
  });

  it("remove forwards a private slug; the chokepoint's NotFound reads like an unknown one (A-WR-08)", async () => {
    const unknown = await removeAddonAction("no-such-addon");
    db.uninstallAddon.mockRejectedValueOnce(new NotFound());
    expect(await removeAddonAction("fixture-private")).toEqual(unknown);
    expect(db.uninstallAddon.mock.calls[0]![2]).toBe("fixture-private");
    // An installed private add-on is removable from its org's hub (CONTEXT A3-Q3).
    expect(await removeAddonAction("fixture-private")).toEqual({
      ok: true,
      data: { slug: "fixture-private" },
    });
  });

  it.each([["__proto__"], ["constructor"], ["toString"], [42], [null], [{}]])(
    "refuses %s",
    async (slug) => {
      const res = await addAddonAction(slug);
      expect(res).toMatchObject({ ok: false, code: "not_found" });
      expect(db.installAddon).not.toHaveBeenCalled();
    },
  );

  it("needs a session first", async () => {
    state.jar.clear();
    const res = await addAddonAction("testimonials");
    expect(res).toMatchObject({ ok: false, code: "signed_out" });
    expect(db.installAddon).not.toHaveBeenCalled();
  });
});

describe("addAddonAction", () => {
  it("adds with the session context and returns the tab and the seeded page URL", async () => {
    const res = await addAddonAction("testimonials");
    expect(res).toEqual({
      ok: true,
      data: {
        slug: "testimonials",
        outcome: "installed",
        tabHref: "/hub/website?tab=testimonials",
        pageUrl: "https://palm.example/testimonials",
      },
    });
    const [ctx, deps, slug] = db.installAddon.mock.calls[0]!;
    expect(ctx).toBe(CTX);
    expect(slug).toBe("testimonials");
    expect(deps).toMatchObject({ addons: registry.value });
    expect(deps.billing).toBeDefined();
  });

  it("points View on site at the home page when the seeded page was deleted", async () => {
    db.listPages.mockResolvedValue([]);
    const res = await addAddonAction("testimonials");
    expect(res.ok && res.data.pageUrl).toBe("https://palm.example/");
  });

  it("passes a missing requirement through with named add-ons", async () => {
    db.installAddon.mockRejectedValueOnce(
      new AddonMissingRequirement(
        "Fixture fixture-needs needs Fixture quote. Add Fixture quote first.",
        ["fixture-quote"],
      ),
    );
    const res = await addAddonAction("fixture-needs");
    expect(res).toEqual({
      ok: false,
      code: "addon_missing_requirement",
      message:
        "Fixture fixture-needs needs Fixture quote. Add Fixture quote first.",
      missing: [{ slug: "fixture-quote", name: "Fixture quote" }],
    });
  });

  it("maps Forbidden and impersonation to the add-on copy (T-05-53)", async () => {
    db.installAddon.mockRejectedValueOnce(new Forbidden("admin"));
    expect(await addAddonAction("testimonials")).toMatchObject({
      ok: false,
      code: "forbidden",
      message: "Only the site owner can add or remove add-ons.",
    });
    db.installAddon.mockRejectedValueOnce(new ImpersonationDenied("x"));
    expect(await addAddonAction("testimonials")).toMatchObject({
      ok: false,
      code: "impersonation_denied",
      message:
        "Add-ons can't be added while you're viewing as the owner. Use the staff console to add one.",
    });
  });
});

describe("addBothAction", () => {
  it("adds the missing requirement first, then the add-on, each its own call", async () => {
    const res = await addBothAction("fixture-needs");
    expect(db.installAddon.mock.calls.map((c) => c[2])).toEqual([
      "fixture-quote",
      "fixture-needs",
    ]);
    expect(res).toMatchObject({
      ok: true,
      data: {
        added: ["fixture-quote", "fixture-needs"],
        tabHref: "/hub/website?tab=fixture-needs",
      },
    });
  });

  it("skips a requirement that is already on", async () => {
    db.activeAddons.mockResolvedValue(["fixture-quote"]);
    const res = await addBothAction("fixture-needs");
    expect(db.installAddon.mock.calls.map((c) => c[2])).toEqual([
      "fixture-needs",
    ]);
    expect(res.ok && res.data.added).toEqual(["fixture-needs"]);
  });

  it("stops at the first refusal and adds nothing after it", async () => {
    db.installAddon.mockRejectedValueOnce(new Forbidden("x"));
    const res = await addBothAction("fixture-needs");
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
    expect(db.installAddon).toHaveBeenCalledTimes(1);
  });

  it("walks requirements transitively, deepest first (C-WR-02)", async () => {
    const res = await addBothAction("fixture-deep");
    expect(db.installAddon.mock.calls.map((c) => c[2])).toEqual([
      "fixture-quote",
      "fixture-needs",
      "fixture-deep",
    ]);
    expect(res.ok && res.data.added).toEqual([
      "fixture-quote",
      "fixture-needs",
      "fixture-deep",
    ]);
  });

  it("a later step failing reports the requirements that did go on (C-WR-02)", async () => {
    db.installAddon.mockImplementation(async (_c, _d, slug: string) => {
      if (slug === "fixture-deep") throw new Error("db down");
      return { slug, outcome: "installed", page: null };
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await addBothAction("fixture-deep");
    err.mockRestore();
    expect(res).toMatchObject({
      ok: false,
      code: "save_failed",
      added: [
        { slug: "fixture-quote", name: "Fixture quote" },
        { slug: "fixture-needs", name: "Fixture fixture-needs" },
      ],
    });
  });

  it("a first-step failure carries no added list", async () => {
    db.installAddon.mockRejectedValueOnce(new Forbidden("x"));
    const res = await addBothAction("fixture-needs");
    expect(res).not.toHaveProperty("added");
  });
});

describe("missingRequirements / availability (C-WR-02)", () => {
  const reg = registry.value as Parameters<typeof missingRequirements>[2];
  it("lists every missing requirement in install order, skipping active ones", () => {
    expect(missingRequirements(FIXTURE_DEEP, [], reg)).toEqual([
      "fixture-quote",
      "fixture-needs",
    ]);
    expect(missingRequirements(FIXTURE_DEEP, ["fixture-quote"], reg)).toEqual([
      "fixture-needs",
    ]);
    expect(missingRequirements(FIXTURE_DEEP, ["fixture-needs"], reg)).toEqual(
      [],
    );
  });

  it("availability's needs state uses the transitive list", () => {
    const a = availability({
      manifest: FIXTURE_DEEP,
      active: [],
      role: "owner",
      impersonating: false,
      registry: registry.value as Parameters<
        typeof availability
      >[0]["registry"],
    });
    expect(a).toMatchObject({
      state: "needs",
      missing: ["fixture-quote", "fixture-needs"],
    });
  });
});

describe("removeAddonAction", () => {
  it("removes with the session context", async () => {
    const res = await removeAddonAction("testimonials");
    expect(res).toEqual({ ok: true, data: { slug: "testimonials" } });
    expect(db.uninstallAddon.mock.calls[0]![0]).toBe(CTX);
    expect(db.uninstallAddon.mock.calls[0]![2]).toBe("testimonials");
  });

  it("passes a refusal through with its dependents named", async () => {
    db.uninstallAddon.mockRejectedValueOnce(
      new AddonRequiredBy(
        "Fixture fixture-needs needs Fixture quote. Remove Fixture fixture-needs first.",
        ["fixture-needs"],
      ),
    );
    const res = await removeAddonAction("fixture-quote");
    expect(res).toEqual({
      ok: false,
      code: "addon_required_by",
      message:
        "Fixture fixture-needs needs Fixture quote. Remove Fixture fixture-needs first.",
      dependents: [{ slug: "fixture-needs", name: "Fixture fixture-needs" }],
    });
  });

  it("a database outage is the generic failure, never raw error text", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.uninstallAddon.mockRejectedValueOnce(new Error("pb: socket hang up"));
    const res = await removeAddonAction("testimonials");
    err.mockRestore();
    expect(res).toMatchObject({ ok: false, code: "save_failed" });
    expect(JSON.stringify(res)).not.toContain("socket");
  });
});

describe("money on add (10-31; BILL-12, D186, D-UI-P10-14)", () => {
  const FIGURES = {
    todayCents: 348,
    setupCents: 0,
    prorationCents: 348,
    thenCents: 900,
    interval: "month" as const,
    periodEndLabel: "1 Nov",
    cardLine: "Visa ending 4242",
    beforeCheckout: false,
    beforeLaunch: true,
  };

  it("addAddonPreviewAction formats the server preview for the dialog", async () => {
    db.previewAddonCharge.mockResolvedValue({ ...FIGURES, token: "tok-a" });
    const res = await addAddonPreviewAction("testimonials");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.token).toBe("tok-a");
    expect(res.preview).toMatchObject({
      kind: "charge",
      confirmLabel: "Add and pay $3.48",
      note: "No setup fee before your site launches.",
      cardLine: "Plus sales tax. Charged to Visa ending 4242.",
    });
    const [ctx, slug, deps] = db.previewAddonCharge.mock.calls[0]!;
    expect(ctx).toBe(CTX);
    expect(slug).toBe("testimonials");
    expect(deps).toMatchObject({ registry: registry.value });
  });

  it("refuses a malformed, unknown or private slug without any db call", async () => {
    for (const slug of [
      42,
      null,
      "__proto__",
      "Bad Slug",
      "no-such-addon",
      "fixture-private",
    ]) {
      expect(await addAddonPreviewAction(slug)).toMatchObject({
        ok: false,
        reason: "not_found",
      });
    }
    expect(db.orgContextFromToken).not.toHaveBeenCalled();
    expect(db.previewAddonCharge).not.toHaveBeenCalled();
  });

  it("refuses an Admin and staff viewing as the owner (T-10-31-02)", async () => {
    db.orgContextFromToken.mockResolvedValue({ ...CTX, role: "admin" });
    expect(await addAddonPreviewAction("testimonials")).toEqual({
      ok: false,
      reason: "forbidden",
      message: "Only the site owner can add or remove add-ons.",
    });
    db.orgContextFromToken.mockResolvedValue({ ...CTX, impersonator: "s1" });
    expect(await addAddonPreviewAction("testimonials")).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    expect(db.previewAddonCharge).not.toHaveBeenCalled();
  });

  it("maps the gate's paused and unpriced refusals", async () => {
    db.previewAddonCharge.mockRejectedValueOnce(
      new InvalidInput(db.PAUSED_NO_ADD_COPY),
    );
    expect(await addAddonPreviewAction("testimonials")).toMatchObject({
      ok: false,
      reason: "paused",
    });
    db.previewAddonCharge.mockRejectedValueOnce(
      new InvalidInput(db.UNPRICED_ADDON_COPY),
    );
    expect(await addAddonPreviewAction("testimonials")).toMatchObject({
      ok: false,
      reason: "unpriced",
    });
  });

  it("addAddonAction gives the gate's refusals their own codes", async () => {
    db.installAddon.mockRejectedValueOnce(
      new InvalidInput(db.CARD_DECLINED_COPY),
    );
    expect(await addAddonAction("testimonials")).toMatchObject({
      ok: false,
      code: "card_declined",
    });
    db.installAddon.mockRejectedValueOnce(
      new InvalidInput(db.PAUSED_NO_ADD_COPY),
    );
    expect(await addAddonAction("testimonials")).toMatchObject({
      ok: false,
      code: "paused",
    });
    db.installAddon.mockRejectedValueOnce(
      new InvalidInput(db.CHARGE_PRICE_CHANGED_COPY),
    );
    expect(await addAddonAction("testimonials")).toMatchObject({
      ok: false,
      code: "price_changed",
    });
    db.installAddon.mockRejectedValueOnce(new InvalidInput("Other refusal."));
    expect(await addAddonAction("testimonials")).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "Other refusal.",
    });
  });

  it("CR-C01: the confirm token reaches the install, one per slug for Add both", async () => {
    await addAddonAction("testimonials", "tok-a");
    expect(db.installAddon.mock.calls[0]![3]).toEqual({ chargeToken: "tok-a" });
    db.installAddon.mockClear();
    await addAddonAction("testimonials", 42);
    expect(db.installAddon.mock.calls[0]![3]).toEqual({});
    db.installAddon.mockClear();
    await addBothAction("fixture-needs", {
      "fixture-quote": "tok-q",
      "fixture-needs": "tok-n",
    });
    expect(db.installAddon.mock.calls.map((c) => c[3])).toEqual([
      { chargeToken: "tok-q" },
      { chargeToken: "tok-n" },
    ]);
  });

  it("updateCardAction returns the org's own card page link", async () => {
    db.billingPortalLink.mockResolvedValue({ url: "https://pay.example/p" });
    expect(await updateCardAction()).toEqual({
      ok: true,
      data: { url: "https://pay.example/p" },
    });
    expect(db.billingPortalLink.mock.calls[0]![0]).toBe(CTX);
  });

  it("addMoneyBlock picks the row set by state (UI-SPEC table)", () => {
    expect(
      addMoneyBlock(
        { ...FIGURES, beforeCheckout: true, todayCents: 0 },
        "October",
      ),
    ).toEqual({
      kind: "joins",
      note: "It joins your order: $9/mo from checkout, no setup fee.",
    });
    const before = addMoneyBlock(FIGURES, "October");
    expect(before.kind === "charge" && before.rows).toEqual([
      {
        label: "Today",
        amount: "$3.48",
        detail: "for the rest of October",
        strong: true,
      },
      { label: "Then", amount: "$9/mo", detail: null, strong: false },
    ]);
    const after = addMoneyBlock(
      {
        ...FIGURES,
        beforeLaunch: false,
        setupCents: 2500,
        todayCents: 2848,
        prorationCents: 348,
      },
      "October",
    );
    expect(after).toMatchObject({
      kind: "charge",
      confirmLabel: "Add and pay $28.48",
      note: null,
    });
    expect(
      after.kind === "charge" &&
        after.rows.map((r) => [r.label, r.amount, r.detail]),
    ).toEqual([
      ["Setup", "$25.00", null],
      ["Rest of October", "$3.48", null],
      ["Today", "$28.48", null],
      ["Then", "$9/mo", "on your monthly bill"],
    ]);
    expect(
      addMoneyBlock({ ...FIGURES, todayCents: 0, thenCents: 0 }, "October"),
    ).toMatchObject({ kind: "included" });
  });

  it("prices and the remove line come from the catalog row for the path", () => {
    const row = (path: string, monthlyCents: number | null) => ({
      itemKind: "addon" as const,
      itemKey: "testimonials",
      path: path as "standard" | "studio",
      monthlyCents,
      oneTimeCents: null,
      installments: null,
    });
    expect(
      addonPriceLabel([row("standard", 900)], "testimonials", "standard"),
    ).toBe("$9/mo");
    expect(addonPriceLabel([row("studio", 0)], "testimonials", "studio")).toBe(
      "Included",
    );
    expect(
      addonPriceLabel([row("standard", null)], "testimonials", "standard"),
    ).toBeNull();
    expect(
      addonPriceLabel([row("studio", 900)], "testimonials", "standard"),
    ).toBeNull();
    expect(removeBillLine(900, true)).toBe(
      "Your monthly bill drops by $9. You get credit for the rest of the month.",
    );
    expect(removeBillLine(900, false)).toBeNull();
    expect(removeBillLine(0, true)).toBeNull();
    // WR-D04: a yearly item's line names the yearly bill.
    expect(removeBillLine(9000, true, "year")).toBe(
      "Your yearly bill drops by $90. You get credit for the rest of your year.",
    );
  });
});
