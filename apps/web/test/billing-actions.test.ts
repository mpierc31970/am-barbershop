// 10-29 Task 1: Settings › Billing Server Actions (BILL-13, BILL-19; D285; T-10-29-01, -02, -04).
// The real session module runs against mocked next/headers and @cds/db.
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const cache = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => cache);

const ERR_CARD = "Your card was declined. Update it in Settings › Billing.";

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  billingPortalLink: vi.fn(),
  buyPack: vi.fn(),
  removePack: vi.fn(),
  previewPack: vi.fn(),
  previewCarePlan: vi.fn(),
  setCarePlan: vi.fn(),
  mediaAllowance: vi.fn(),
  pageAllowanceFor: vi.fn(),
  formatGb: (b: number) => `${Math.round((b / 1024 ** 3) * 10) / 10} GB`,
  CHARGE_PRICE_CHANGED_COPY:
    "The price changed since you opened this. Check the new figure, then confirm again.",
}));
vi.mock("@cds/db", () => db);
// 11-28: the pages pack passes the add-on registry; a stub stands in (no collection setup).
vi.mock("@cds/addon-registry/server", () => ({
  ADDON_REGISTRY: { get: () => undefined, list: () => [] },
}));

const {
  buyPackAction,
  carePlanPreviewAction,
  packPreviewAction,
  removePackAction,
  setCarePlanAction,
  updateCardAction,
} = await import("../app/actions/billing");
const {
  ALREADY_ADDED,
  IMPERSONATING_BILLING,
  NOT_OWNER_BILLING,
  BAD_PACK,
  ERR_PORTAL,
} = await import("../app/(platform)/hub/settings/billing-copy");

const GB = 1024 ** 3;
const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const ORG = { id: "org1", name: "Palm", primaryHost: "palm.example" };
const PREVIEW = {
  todayCents: 4150,
  setupCents: 0,
  prorationCents: 4150,
  thenCents: 9900,
  interval: "month",
  periodEndLabel: "1 Nov",
  cardLine: "Visa ending 4242",
  beforeCheckout: false,
  beforeLaunch: true,
  token: "tok-preview",
};

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
  db.mediaAllowance.mockResolvedValue(7 * GB);
  db.pageAllowanceFor.mockResolvedValue(15);
});

describe("owner-only refusals", () => {
  it("Admin is refused with the billing copy and no charge runs", async () => {
    db.orgContextFromToken.mockResolvedValue({ ...CTX, role: "admin" });
    expect(await buyPackAction("5gb", "tok-1")).toEqual({
      ok: false,
      reason: "error",
      message: NOT_OWNER_BILLING,
    });
    expect(await setCarePlanAction(true, "tok-1")).toMatchObject({
      ok: false,
      message: NOT_OWNER_BILLING,
    });
    expect(await updateCardAction()).toMatchObject({
      ok: false,
      message: NOT_OWNER_BILLING,
    });
    expect(db.buyPack).not.toHaveBeenCalled();
    expect(db.setCarePlan).not.toHaveBeenCalled();
    expect(db.billingPortalLink).not.toHaveBeenCalled();
  });

  it("an impersonating owner is refused with the impersonation copy", async () => {
    db.orgContextFromToken.mockResolvedValue({ ...CTX, impersonator: "s1" });
    expect(await removePackAction("5gb")).toEqual({
      ok: false,
      reason: "error",
      message: IMPERSONATING_BILLING,
    });
    expect(await packPreviewAction("5gb")).toEqual({
      ok: false,
      message: IMPERSONATING_BILLING,
    });
    expect(db.removePack).not.toHaveBeenCalled();
    expect(db.previewPack).not.toHaveBeenCalled();
  });
});

describe("packs", () => {
  it("buyPackAction('5gb') buys and toasts the new allowance; revalidates", async () => {
    db.buyPack.mockResolvedValue({ ok: true, invoiceTotalCents: 242 });
    expect(await buyPackAction("5gb", "tok-1")).toEqual({
      ok: true,
      toast: "5 GB added. You now have 7 GB.",
    });
    expect(db.buyPack.mock.calls[0]![0]).toBe(CTX);
    expect(db.buyPack.mock.calls[0]![1]).toBe("5gb");
    expect(db.buyPack.mock.calls[0]![2].invalidator).toBeDefined();
    expect(db.buyPack.mock.calls[0]![3]).toBe("tok-1");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/hub", "layout");
  });

  it("a declined card returns ERR-CARD with a fresh preview (a new attempt)", async () => {
    db.buyPack.mockResolvedValue({
      ok: false,
      reason: "card_declined",
      message: ERR_CARD,
    });
    db.previewPack.mockResolvedValue({ ...PREVIEW, token: "tok-2" });
    expect(await buyPackAction("25gb", "tok-1")).toEqual({
      ok: false,
      reason: "card_declined",
      message: ERR_CARD,
      preview: expect.objectContaining({ token: "tok-2" }),
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("CR-C01: no token charges nothing; a moved price returns the new figures", async () => {
    for (const bad of [undefined, "", 7, "x".repeat(2000)]) {
      expect(await buyPackAction("5gb", bad)).toMatchObject({
        ok: false,
        reason: "price_changed",
      });
      expect(await setCarePlanAction(true, bad)).toMatchObject({
        ok: false,
        reason: "price_changed",
      });
    }
    expect(db.buyPack).not.toHaveBeenCalled();
    expect(db.setCarePlan).not.toHaveBeenCalled();

    db.buyPack.mockResolvedValue({
      ok: false,
      reason: "price_changed",
      message: "moved",
    });
    db.previewPack.mockResolvedValue({
      ...PREVIEW,
      todayCents: 300,
      thenCents: 700,
      token: "tok-3",
    });
    expect(await buyPackAction("5gb", "tok-1")).toEqual({
      ok: false,
      reason: "price_changed",
      message: "moved",
      preview: expect.objectContaining({
        token: "tok-3",
        todayCents: 300,
        thenText: "$7/mo on your monthly bill from 1 Nov",
      }),
    });
  });

  it("CR-C01: a retried confirm that already applied says so, nothing more charged", async () => {
    db.buyPack.mockResolvedValue({
      ok: true,
      invoiceTotalCents: 0,
      alreadyApplied: true,
    });
    expect(await buyPackAction("5gb", "tok-1")).toEqual({
      ok: true,
      toast: ALREADY_ADDED,
    });
  });

  it("malformed size is refused without a db call", async () => {
    for (const bad of ["10gb", 5, null, undefined, { size: "5gb" }]) {
      expect(await buyPackAction(bad)).toEqual({
        ok: false,
        reason: "error",
        message: BAD_PACK,
      });
      expect(await removePackAction(bad)).toMatchObject({
        ok: false,
        message: BAD_PACK,
      });
      expect(await packPreviewAction(bad)).toEqual({
        ok: false,
        message: BAD_PACK,
      });
    }
    expect(db.buyPack).not.toHaveBeenCalled();
    expect(db.removePack).not.toHaveBeenCalled();
    expect(db.previewPack).not.toHaveBeenCalled();
    expect(db.orgContextFromToken).not.toHaveBeenCalled();
  });

  it("removePackAction keeps the refusal copy", async () => {
    db.removePack.mockResolvedValue({
      ok: false,
      reason: "refused",
      message: "You're using 6.2 GB…",
    });
    expect(await removePackAction("5gb")).toEqual({
      ok: false,
      reason: "error",
      message: "You're using 6.2 GB…",
    });
  });

  it("packPreviewAction maps the server figures", async () => {
    db.previewPack.mockResolvedValue({
      ...PREVIEW,
      todayCents: 242,
      thenCents: 500,
    });
    const res = await packPreviewAction("5gb");
    expect(res).toEqual({
      ok: true,
      preview: expect.objectContaining({
        title: "Add 5 GB of media storage?",
        todayCents: 242,
        thenText: "$5/mo on your monthly bill from 1 Nov",
        cardLine: "Plus sales tax. Charged to Visa ending 4242.",
        confirmLabel: "Add 5 GB",
      }),
    });
  });
});

describe("Care Plan", () => {
  it("preview and add", async () => {
    db.previewCarePlan.mockResolvedValue(PREVIEW);
    const p = await carePlanPreviewAction();
    expect(p.ok && p.preview).toMatchObject({
      title: "Add the Care Plan?",
      todayCents: 4150,
      thenText: "$99/mo on your monthly bill from 1 Nov",
      confirmLabel: "Add and pay $41.50",
    });
    expect(p.ok && p.preview.token).toBe("tok-preview");
    db.setCarePlan.mockResolvedValue({ ok: true, invoiceTotalCents: 4150 });
    expect(await setCarePlanAction(true, "tok-preview")).toEqual({
      ok: true,
      toast: "Care Plan added. Receipt emailed.",
    });
    expect(db.setCarePlan.mock.calls[0]![3]).toBe("tok-preview");
    db.setCarePlan.mockResolvedValue({ ok: true, invoiceTotalCents: 0 });
    expect(await setCarePlanAction(false)).toEqual({
      ok: true,
      toast: "Care Plan removed.",
    });
  });

  it("non-boolean is refused before any db call", async () => {
    expect(await setCarePlanAction("yes")).toMatchObject({ ok: false });
    expect(db.setCarePlan).not.toHaveBeenCalled();
  });
});

describe("updateCardAction", () => {
  it("returns the portal URL", async () => {
    db.billingPortalLink.mockResolvedValue({ url: "https://pay.example/p" });
    expect(await updateCardAction()).toEqual({
      ok: true,
      data: { url: "https://pay.example/p" },
    });
    expect(db.billingPortalLink.mock.calls[0]![0]).toBe(CTX);
  });

  it("a non-http URL or a failure is ERR-PORTAL", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.billingPortalLink.mockResolvedValue({ url: "javascript:alert(1)" });
    expect(await updateCardAction()).toMatchObject({
      ok: false,
      message: ERR_PORTAL,
    });
    db.billingPortalLink.mockRejectedValue(new Error("down"));
    expect(await updateCardAction()).toMatchObject({
      ok: false,
      message: ERR_PORTAL,
    });
    err.mockRestore();
  });
});

describe("pages pack (11-28, DASH-08)", () => {
  it("rejects any other kind as invalid input, before any db call", async () => {
    for (const bad of ["pages-99", "pages-10", "media-5gb "]) {
      expect(await buyPackAction(bad, "tok-1")).toEqual({
        ok: false,
        reason: "error",
        message: BAD_PACK,
      });
      expect(await packPreviewAction(bad)).toEqual({
        ok: false,
        message: BAD_PACK,
      });
      expect(await removePackAction(bad)).toMatchObject({ ok: false });
    }
    expect(db.buyPack).not.toHaveBeenCalled();
    expect(db.previewPack).not.toHaveBeenCalled();
    expect(db.removePack).not.toHaveBeenCalled();
  });

  it("an editor is refused before any charge (T-11-28-01)", async () => {
    db.orgContextFromToken.mockResolvedValue({ ...CTX, role: "editor" });
    expect(await buyPackAction("pages-5", "tok-1")).toMatchObject({
      ok: false,
      message: NOT_OWNER_BILLING,
    });
    expect(db.buyPack).not.toHaveBeenCalled();
  });

  it("after checkout: the preview is the prorated receipt for 5 more pages", async () => {
    db.previewPack.mockResolvedValue({
      ...PREVIEW,
      todayCents: 323,
      thenCents: 1000,
    });
    db.pageAllowanceFor.mockResolvedValue(10);
    const res = await packPreviewAction("pages-5");
    expect(res).toMatchObject({
      ok: true,
      preview: {
        title: "Add 5 more pages?",
        what: "Your site can have 15 pages.",
        todayCents: 323,
        confirmLabel: "Add and pay $3.23",
        token: "tok-preview",
      },
    });
    expect(res.ok && res.preview.orderNote).toBeUndefined();
    expect(db.previewPack.mock.calls[0]![1]).toBe("pages-5");
    expect(db.previewPack.mock.calls[0]![2].registry).toBeDefined();
  });

  it("before checkout: It joins your order: $10/mo from checkout.", async () => {
    db.previewPack.mockResolvedValue({
      ...PREVIEW,
      todayCents: 0,
      thenCents: 1000,
      cardLine: null,
      beforeCheckout: true,
    });
    db.pageAllowanceFor.mockResolvedValue(10);
    const res = await packPreviewAction("pages-5");
    expect(res).toMatchObject({
      ok: true,
      preview: {
        title: "Add 5 more pages?",
        confirmLabel: "Add 5 pages",
        orderNote: "It joins your order: $10/mo from checkout.",
      },
    });
  });

  it("buy passes invalidator and registry, toasts the new allowance and revalidates", async () => {
    db.buyPack.mockResolvedValue({ ok: true, invoiceTotalCents: 323 });
    expect(await buyPackAction("pages-5", "tok-1")).toEqual({
      ok: true,
      toast: "5 pages added. You can now have 15.",
    });
    const deps = db.buyPack.mock.calls[0]![2];
    expect(db.buyPack.mock.calls[0]![1]).toBe("pages-5");
    expect(deps.invalidator).toBeDefined();
    expect(deps.registry).toBeDefined();
    expect(db.buyPack.mock.calls[0]![3]).toBe("tok-1");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/hub", "layout");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/hub/website");
  });

  it("remove: a refusal keeps PAGES-PACK-REFUSED; success toasts the new allowance", async () => {
    const refused =
      "You have 13 pages, more than the 10 you'd have left. Delete 3 pages first, then remove the pack.";
    db.removePack.mockResolvedValue({
      ok: false,
      reason: "refused",
      message: refused,
    });
    expect(await removePackAction("pages-5")).toEqual({
      ok: false,
      reason: "error",
      message: refused,
    });
    expect(db.removePack.mock.calls[0]![2].registry).toBeDefined();
    expect(db.removePack.mock.calls[0]![2].invalidator).toBeDefined();
    db.removePack.mockResolvedValue({ ok: true, invoiceTotalCents: 0 });
    db.pageAllowanceFor.mockResolvedValue(10);
    expect(await removePackAction("pages-5")).toEqual({
      ok: true,
      toast: "5-page pack removed. You can now have 10.",
    });
  });
});
