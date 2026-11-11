// @vitest-environment jsdom
// 06-18 Task 3: /hub/setup overview, the step frame and step 7 "Domain & the rest"
// (06-UI-SPEC "Setup overview", "Stages", "7 · Domain & the rest"; ONB-01, ONB-02, ONB-03;
// D312, CONTEXT A1-Q5, A3-Q4; T-06-87, T-06-89). The session, @cds/db and the intake actions
// are mocked; lib/intake's loadStageData runs for real over the mocked chokepoint.
import type { IntakeSnapshot } from "@cds/core/intake";
import { ToastRegion } from "@cds/ui/hub";
import { act, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT:${to}`), {
      digest: `NEXT_REDIRECT;replace;${to};307;`,
    });
  },
  notFound: () => {
    throw Object.assign(new Error("NOT_FOUND"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  },
  usePathname: () => "/hub/setup",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  getOrgStage: vi.fn(),
  getBusinessProfile: vi.fn(),
  getOrgIntake: vi.fn(),
  getIntakeSnapshot: vi.fn(),
  listMedia: vi.fn(),
  getSitePreviewUrl: vi.fn(),
  agreementStatus: vi.fn(),
  readCheckoutState: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const actions = vi.hoisted(() => ({
  saveProfileAction: vi.fn(),
  saveAnswersAction: vi.fn(),
  markStageSavedAction: vi.fn(),
  dismissFirstVisitAction: vi.fn(),
  sendToCdsAction: vi.fn(),
}));
vi.mock("../app/actions/intake", () => actions);
// 06-20: the words and people steps' list and add-on proof actions (never called here).
vi.mock("../app/actions/core-lists", () => ({}));
vi.mock("../app/actions/addon-intake", () => ({}));

const { loadStageData, stageSummary } = await import("../lib/intake");
const { default: SetupPage } = await import("../app/(platform)/hub/setup/page");
const { default: StagePage } =
  await import("../app/(platform)/hub/setup/[stage]/page");
const { STAGE_FORMS } =
  await import("../app/(platform)/hub/setup/[stage]/stage-forms");
const { liveDomain, ga4Error, GA4_ERROR } =
  await import("../app/(platform)/hub/setup/stages/TheRestStage");
const {
  sentCopy,
  optionalGapCopy,
  HELD_COPY,
  SENT_TOAST,
  SEND_FAILED,
  BUILT_COPY,
  STATUS_HELPER,
} = await import("../app/(platform)/hub/setup/SetupOverview");

function profile(over: Record<string, unknown> = {}) {
  return {
    id: "bp1",
    orgName: "Rivera Bakery",
    tagline: "",
    business_type: "bakery",
    business_type_other: "",
    description: "",
    phone: "",
    public_email: "",
    address: { street: "", city: "", state: "", zip: "" },
    service_area: "",
    time_zone: "",
    hours: null,
    socials: [],
    about: "",
    mission: "",
    headline: "",
    font_pairing: "cds-choose",
    ga4_id: "",
    legal_name: "",
    privacy_contact: "",
    legal_region: "",
    ...over,
  };
}

function snapshot(over: Partial<IntakeSnapshot> = {}): IntakeSnapshot {
  const { id: _id, orgName, ...values } = profile();
  void _id;
  return {
    orgName,
    path: "standard",
    profile: values as IntakeSnapshot["profile"],
    answers: {
      domain_choice: "later",
      domain: "",
      registrar: "",
      domain_ideas: "",
      gbp: "",
    },
    counts: { services: 0, team: 0, gallery: 0, moodboard: 0 },
    media: { logo: false, hero: false, photosMissingAlt: 0 },
    email: { defaultConfirmed: true, bouncing: 0 },
    addonIntake: {},
    selections: { addons: [], extras: [], carePlan: false, cadence: "monthly" },
    stagesSaved: [],
    ...over,
  };
}

/** Everything required is in: a phone and a time zone. */
function complete(over: Partial<IntakeSnapshot> = {}): IntakeSnapshot {
  const base = snapshot();
  return {
    ...base,
    profile: {
      ...base.profile,
      phone: "512 555 0100",
      time_zone: "America/Chicago",
    },
    stagesSaved: ["business", "contact"],
    ...over,
  };
}

function load(opts: {
  snap?: IntakeSnapshot;
  stage?: string;
  role?: string;
  impersonator?: string;
  dismissed?: boolean;
  submittedAt?: Date | null;
  prof?: Record<string, unknown>;
}) {
  const ctx = {
    ...CTX,
    role: opts.role ?? "owner",
    ...(opts.impersonator ? { impersonator: opts.impersonator } : {}),
  };
  sess.requireHubSession.mockResolvedValue({
    ctx,
    email: "a@b.c",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
  db.getOrgStage.mockResolvedValue({
    stage: opts.stage ?? "intake",
    path: "standard",
  });
  const snap = opts.snap ?? snapshot();
  db.getIntakeSnapshot.mockResolvedValue(snap);
  db.getBusinessProfile.mockResolvedValue(profile(opts.prof));
  db.listMedia.mockResolvedValue([]);
  db.getOrgIntake.mockResolvedValue({
    selections: snap.selections,
    answers: snap.answers,
    stagesSaved: snap.stagesSaved,
    firstVisitDismissed: opts.dismissed ?? true,
    submittedAt: opts.submittedAt ?? null,
    addonConfig: {},
    moodboardProposal: null,
  });
  return ctx;
}

async function overview(): Promise<string> {
  const el = (await SetupPage()) as ReactElement;
  return renderToStaticMarkup(<ToastRegion>{el}</ToastRegion>);
}

async function stagePage(stage: string): Promise<ReactElement> {
  return (await StagePage({
    params: Promise.resolve({ stage }),
  })) as ReactElement;
}

let mounted: Mounted | null = null;
beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(actions)]) {
    fn.mockReset();
  }
  for (const fn of Object.values(actions)) {
    fn.mockResolvedValue({ ok: true, data: null });
  }
  window.location.hash = "";
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("loadStageData", () => {
  it("composes stage rows, progress, what's needed and the viewer's rights", async () => {
    const ctx = load({ snap: complete() });
    const data = await loadStageData(ctx as never);
    expect(data.stages.map((s) => s.slug)).toEqual([
      "business",
      "contact",
      "email",
      "words",
      "people",
      "look",
      "the-rest",
    ]);
    expect(data.stages[0]).toMatchObject({
      name: "Your business",
      href: "/hub/setup/business",
      status: "done",
    });
    expect(data.progress).toEqual({ done: 2, total: 7 });
    expect(data.needed.required).toEqual([]);
    expect(data.needed.optional.length).toBeGreaterThan(0);
    expect(data).toMatchObject({
      canEdit: true,
      isOwner: true,
      impersonating: false,
      submittedAt: null,
    });
  });

  it("an editor cannot edit; an impersonated owner is flagged", async () => {
    const editor = await loadStageData(load({ role: "editor" }) as never);
    expect(editor).toMatchObject({ canEdit: false, isOwner: false });
    const imp = await loadStageData(load({ impersonator: "staff1" }) as never);
    expect(imp.impersonating).toBe(true);
  });

  it("08-09: being_built loads the preview URL; other stages don't ask for it", async () => {
    const ctx = load({ snap: complete(), stage: "being_built" });
    db.getSitePreviewUrl.mockResolvedValue("https://rivera.sites.localhost/");
    const built = await loadStageData(ctx as never);
    expect(built.stage).toBe("being_built");
    expect(built.previewUrl).toBe("https://rivera.sites.localhost/");
    expect(db.getSitePreviewUrl).toHaveBeenCalledTimes(1);

    db.getSitePreviewUrl.mockClear();
    const sent = await loadStageData(
      load({ snap: complete(), stage: "ready_for_build" }) as never,
    );
    expect(sent.previewUrl).toBeNull();
    expect(db.getSitePreviewUrl).not.toHaveBeenCalled();
  });

  it("summarises a step, or says Not started", () => {
    const s = complete({
      media: { logo: true, hero: false, photosMissingAlt: 0 },
    });
    expect(stageSummary("business", s)).toBe("Rivera Bakery · logo added");
    expect(stageSummary("look", s)).toBe("Not started");
    expect(stageSummary("contact", s)).toBe("512 555 0100");
  });
});

describe("/hub/setup overview", () => {
  it("renders the header, intro, progress bar and seven step rows", async () => {
    load({ snap: complete() });
    const html = await overview();
    expect(html).toMatch(/<h1[^>]*>Set up your site<\/h1>/);
    expect(html).toContain("Tell us about your business, in as many sittings");
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="2"/);
    expect(html).toContain("2 of 7</strong> steps done");
    for (const slug of ["business", "contact", "email", "the-rest"]) {
      expect(html).toContain(`href="/hub/setup/${slug}"`);
    }
    expect(html).toContain("Done");
    expect(html).toContain("What&#x27;s still needed");
  });

  it("fit_review: HELD alert at the top and the In review badge; editing stays open", async () => {
    load({ snap: complete(), stage: "fit_review" });
    const html = await overview();
    expect(html).toContain(HELD_COPY.replace(/'/g, "&#x27;"));
    expect(html.indexOf("checking a couple of details")).toBeLessThan(
      html.indexOf("<h1"),
    );
    expect(html).toContain("In review");
    expect(html).toContain('href="/hub/setup/the-rest"');
  });

  it("shows the first-visit welcome until it is dismissed", async () => {
    load({ dismissed: false });
    expect(await overview()).toContain("Your account is ready.");
    load({ dismissed: true });
    expect(await overview()).not.toContain("Your account is ready.");
  });

  it("must-haves missing: Continue setup to the first gap, with the unlock hint", async () => {
    load({ snap: snapshot() });
    const html = await overview();
    expect(html).toMatch(
      /<a[^>]*href="\/hub\/setup\/contact"[^>]*>Continue setup<\/a>/,
    );
    expect(html).toContain(
      "Send to Support unlocks when the must-haves are in.",
    );
    expect(html).toContain("Business phone or email · Contact &amp; hours");
    expect(html).toContain("2 needed");
    expect(html).not.toContain(">Send to Support<");
  });

  it("all must-haves in: Send to Support for the owner, with the optional-gap note", async () => {
    load({ snap: complete() });
    const html = await overview();
    expect(html).toMatch(/<button[^>]*>.*Send to Support/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>.*Send to Support/);
    expect(html).toMatch(/\d+ optional items are empty\./);
  });

  it("an admin or editor sees Send disabled with the owner-only reason", async () => {
    load({ snap: complete(), role: "admin" });
    const html = await overview();
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Send to Support/);
    expect(html).toContain("Only the site owner can send this to Support.");
  });

  it("staff impersonating see the owner's-step reason", async () => {
    load({ snap: complete(), impersonator: "staff1" });
    const html = await overview();
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Send to Support/);
    expect(html).toContain("Sending to Support is the owner&#x27;s step.");
  });

  it("sent: SENT copy with the date and the keep-editing line", async () => {
    load({
      snap: complete(),
      submittedAt: new Date("2026-09-28T15:00:00Z"),
      prof: { time_zone: "America/Chicago" },
    });
    const html = await overview();
    expect(html).toContain("Sent to Support on 28 Sep.");
    expect(html).toContain("You can keep editing.");
    expect(sentCopy("2026-09-28T15:00:00Z", "")).toBe(
      "Sent to Support on 28 Sep. We'll email you when your site is ready to review.",
    );
    expect(optionalGapCopy(1)).toMatch(/^1 optional item is empty\./);
  });

  it("Send to Support flips the panel to Sent and toasts", async () => {
    load({ snap: complete() });
    actions.sendToCdsAction.mockResolvedValue({
      ok: true,
      data: { submittedAt: "2026-09-28T15:00:00Z", stage: "ready_for_build" },
    });
    const el = (await SetupPage()) as ReactElement;
    mounted = mount(<ToastRegion>{el}</ToastRegion>);
    click(button(mounted.container, /Send to Support/));
    await flush();
    expect(actions.sendToCdsAction).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(SENT_TOAST);
    expect(mounted.container.textContent).toContain(
      "Sent to Support on 28 Sep.",
    );
  });

  it("a failed send shows the action's copy in the panel", async () => {
    load({ snap: complete() });
    actions.sendToCdsAction.mockResolvedValue({
      ok: false,
      code: "save_failed",
      message:
        "Sending didn't finish. Your answers are saved. Try again in a minute.",
    });
    const el = (await SetupPage()) as ReactElement;
    mounted = mount(<ToastRegion>{el}</ToastRegion>);
    click(button(mounted.container, /Send to Support/));
    await flush();
    expect(
      mounted.container.querySelector('[role="alert"]')?.textContent,
    ).toContain("Sending didn't finish.");
  });

  it("C-WR-07: a thrown send shows the failure copy and the button stops loading", async () => {
    load({ snap: complete() });
    actions.sendToCdsAction.mockRejectedValue(new Error("network"));
    const el = (await SetupPage()) as ReactElement;
    mounted = mount(<ToastRegion>{el}</ToastRegion>);
    click(button(mounted.container, /Send to Support/));
    await flush();
    expect(
      mounted.container.querySelector('[role="alert"]')?.textContent,
    ).toContain(SEND_FAILED);
    const btn = button(mounted.container, /Send to Support/);
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("aria-busy")).not.toBe("true");
    expect(btn!.disabled).toBe(false);
  });

  it("08-09 being_built: Being built badge, status line, preview link in a new tab, helper, no primary button", async () => {
    load({
      snap: complete(),
      stage: "being_built",
      submittedAt: new Date("2026-09-28T15:00:00Z"),
    });
    db.getSitePreviewUrl.mockResolvedValue("https://rivera.sites.localhost/");
    const el = (await SetupPage()) as ReactElement;
    mounted = mount(<ToastRegion>{el}</ToastRegion>);
    const root = mounted.container;
    const text = root.textContent ?? "";
    expect(text).toContain("Being built");
    expect(text).not.toContain("Sent to Support");
    expect(text).toContain(BUILT_COPY);
    expect(text).toContain(STATUS_HELPER);
    const link = [...root.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("See your site's preview"),
    );
    expect(link).toBeDefined();
    expect(link!.getAttribute("href")).toBe("https://rivera.sites.localhost/");
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")).toContain("noopener");
    expect(link!.getAttribute("rel")).toContain("noreferrer");
    expect(link!.getAttribute("aria-label")).toBe(
      "See your site's preview (opens in a new tab)",
    );
    // UI-SPEC: 44px touch targets on coarse pointers for P8 links (WR-C04).
    const pages = [...root.querySelectorAll("a")].find(
      (a) => a.getAttribute("href") === "/hub/website?tab=pages",
    );
    expect(pages).toBeDefined();
    for (const a of [link!, pages!]) {
      const cls = a.className.split(/\s+/);
      expect(cls).toContain("pointer-coarse:min-h-11");
      expect(cls).toContain("inline-flex");
    }
    expect(button(root, /Send to Support/)).toBeNull();
    expect(text).not.toContain("Continue setup");
    // UI-SPEC Voice: owner UI never names the machinery.
    for (const word of [
      "slot",
      "template",
      "assembly",
      "fallback",
      "intake",
      "ledger",
    ]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it("08-09 being_built without a preview URL: the line shows, never a dead link", async () => {
    load({ snap: complete(), stage: "being_built" });
    db.getSitePreviewUrl.mockResolvedValue(null);
    const html = await overview();
    expect(html).toContain(
      "Your site is assembled. Support is polishing it now.",
    );
    expect(html).not.toContain("See your site");
    expect(html).not.toContain('target="_blank"');
  });

  it("08-09 ready_for_build (assembly queued, running or failed) keeps the P6 Sent state", async () => {
    load({
      snap: complete(),
      stage: "ready_for_build",
      submittedAt: new Date("2026-09-28T15:00:00Z"),
    });
    const html = await overview();
    expect(html).toContain("Sent to Support on 28 Sep.");
    expect(html).not.toContain("Being built");
    expect(html).not.toContain("Your site is assembled.");
    expect(db.getSitePreviewUrl).not.toHaveBeenCalled();
  });

  describe("09-19 agreement item (CONTEXT A2-Q5, D-UI-P9-4)", () => {
    const SENT = new Date("2026-09-28T15:00:00Z");
    const UNSIGNED = {
      state: "unsigned",
      missing: [],
      consentCurrent: false,
      lastSignedAt: null,
      lastSignerName: null,
    };
    const CURRENT = {
      ...UNSIGNED,
      state: "current",
      consentCurrent: true,
      lastSignedAt: "2026-10-08T15:00:00.000Z",
      lastSignerName: "Ana Rivera",
    };

    function signLinks(root: HTMLElement) {
      return [...root.querySelectorAll("a")].filter(
        (a) => a.getAttribute("href") === "/hub/agreement",
      );
    }

    it("owner, sent, unsigned: required row, one primary Review and sign, Sent line under it", async () => {
      load({ snap: complete(), stage: "ready_for_build", submittedAt: SENT });
      db.agreementStatus.mockResolvedValue(UNSIGNED);
      const el = (await SetupPage()) as ReactElement;
      mounted = mount(<ToastRegion>{el}</ToastRegion>);
      const root = mounted.container;
      const text = root.textContent ?? "";
      expect(text).toContain("Review and sign your agreement");
      expect(text).toContain(
        "Five short policies and one signature. About 3 minutes.",
      );
      expect(text).toContain("Needed");
      const links = signLinks(root);
      expect(links).toHaveLength(1);
      expect(links[0]!.getAttribute("aria-label")).toBe(
        "Review and sign your agreement",
      );
      expect(links[0]!.textContent).toBe("Review and sign");
      // The Sent line moves under the button as muted text (no success alert).
      expect(text).toContain("Sent to Support on 28 Sep.");
      const sent = [...root.querySelectorAll("p")].find((p) =>
        p.textContent?.startsWith("Sent to Support on"),
      );
      expect(sent?.className).toContain("text-hub-ink-muted");
      expect(text).not.toContain("Everything's in.");
    });

    it("being built, unsigned: the row and button sit above the built status", async () => {
      load({ snap: complete(), stage: "being_built", submittedAt: SENT });
      db.agreementStatus.mockResolvedValue(UNSIGNED);
      db.getSitePreviewUrl.mockResolvedValue(null);
      const html = await overview();
      expect(html).toContain('href="/hub/agreement"');
      expect(html).toContain(BUILT_COPY);
    });

    it("Admin and staff impersonating: the row, no button, the owner-only line", async () => {
      for (const opts of [{ role: "admin" }, { impersonator: "staff1" }]) {
        load({
          snap: complete(),
          stage: "ready_for_build",
          submittedAt: SENT,
          ...opts,
        });
        db.agreementStatus.mockResolvedValue(UNSIGNED);
        const html = await overview();
        expect(html).toContain("Review and sign your agreement");
        expect(html).toContain("Only the site owner can sign the agreement.");
        expect(html).not.toContain('href="/hub/agreement"');
      }
    });

    it("signed: done row with the date and Settings › Legal; no sign button", async () => {
      load({ snap: complete(), stage: "being_built", submittedAt: SENT });
      db.agreementStatus.mockResolvedValue(CURRENT);
      db.getSitePreviewUrl.mockResolvedValue(null);
      const html = await overview();
      expect(html).toContain("Agreement signed on 8 Oct 2026");
      expect(html).toContain('href="/hub/settings?tab=legal"');
      expect(html).toContain("Settings › Legal");
      expect(html).not.toContain('href="/hub/agreement"');
      expect(html).not.toContain("Review and sign");
    });

    it("outdated (non-owner): Updated terms waiting and the next-sign-in line", async () => {
      load({
        snap: complete(),
        stage: "ready_for_build",
        submittedAt: SENT,
        role: "admin",
      });
      db.agreementStatus.mockResolvedValue({ ...CURRENT, state: "outdated" });
      const html = await overview();
      expect(html).toContain("Updated terms waiting");
      expect(html).toContain("The owner signs these at their next sign-in.");
      expect(html).not.toContain('href="/hub/agreement"');
    });

    it("before Send to Support (and while held) nothing about the agreement shows", async () => {
      for (const stage of ["intake", "fit_review"]) {
        load({ snap: complete(), stage });
        db.agreementStatus.mockResolvedValue(UNSIGNED);
        const html = await overview();
        expect(html.toLowerCase()).not.toContain("agreement");
      }
      expect(db.agreementStatus).not.toHaveBeenCalled();
    });

    it("a failed status read shows nothing and the screen still opens", async () => {
      load({ snap: complete(), stage: "ready_for_build", submittedAt: SENT });
      db.agreementStatus.mockRejectedValue(new Error("down"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const html = await overview();
      err.mockRestore();
      expect(html).toContain("Sent to Support on 28 Sep.");
      expect(html.toLowerCase()).not.toContain("agreement");
    });
  });

  describe("10-22 checkout item (UI-SPEC Setup item)", () => {
    const SENT = new Date("2026-09-28T15:00:00Z");
    const CURRENT = {
      state: "current",
      missing: [],
      consentCurrent: true,
      lastSignedAt: "2026-10-08T15:00:00.000Z",
      lastSignerName: "Ana Rivera",
    };
    const OPEN = {
      stage: "ready_for_build",
      path: "standard",
      closed: false,
      paidAt: null,
      paymentsOpen: true,
      testMode: true,
    };

    it("signed owner: the row after the agreement and one primary Go to checkout", async () => {
      load({ snap: complete(), stage: "ready_for_build", submittedAt: SENT });
      db.agreementStatus.mockResolvedValue(CURRENT);
      db.readCheckoutState.mockResolvedValue(OPEN);
      const el = (await SetupPage()) as ReactElement;
      mounted = mount(<ToastRegion>{el}</ToastRegion>);
      const root = mounted.container;
      const text = root.textContent ?? "";
      expect(text).toContain("Pay and start your build");
      expect(text).toContain(
        "Your build fee and first month. About 2 minutes.",
      );
      expect(text.indexOf("Agreement signed")).toBeLessThan(
        text.indexOf("Pay and start your build"),
      );
      const pay = [...root.querySelectorAll("a")].filter(
        (a) => a.getAttribute("href") === "/hub/checkout",
      );
      expect(pay).toHaveLength(1);
      expect(pay[0]!.textContent).toBe("Go to checkout");
      expect(text).toContain("Sent to Support on 28 Sep.");
    });

    it("Admin: the row with the owner-only line, no button", async () => {
      load({
        snap: complete(),
        stage: "ready_for_build",
        submittedAt: SENT,
        role: "admin",
      });
      db.agreementStatus.mockResolvedValue(CURRENT);
      db.readCheckoutState.mockResolvedValue(OPEN);
      const html = await overview();
      expect(html).toContain("Only the site owner can pay.");
      expect(html).not.toContain('href="/hub/checkout"');
    });

    it("unsigned: After you sign your agreement, and Review and sign stays the primary", async () => {
      load({ snap: complete(), stage: "ready_for_build", submittedAt: SENT });
      db.agreementStatus.mockResolvedValue({
        ...CURRENT,
        state: "unsigned",
        lastSignedAt: null,
      });
      db.readCheckoutState.mockResolvedValue(OPEN);
      const html = await overview();
      expect(html).toContain("After you sign your agreement.");
      expect(html).toContain('href="/hub/agreement"');
      expect(html).not.toContain('href="/hub/checkout"');
    });

    it("paid: a done row with the date and Settings › Billing", async () => {
      load({ snap: complete(), stage: "being_built", submittedAt: SENT });
      db.agreementStatus.mockResolvedValue(CURRENT);
      db.getSitePreviewUrl.mockResolvedValue(null);
      db.readCheckoutState.mockResolvedValue({
        ...OPEN,
        stage: "being_built",
        paidAt: "2026-10-08T15:00:00.000Z",
      });
      const html = await overview();
      expect(html).toContain("Paid on 8 Oct");
      expect(html).toContain('href="/hub/settings?tab=billing"');
      expect(html).not.toContain('href="/hub/checkout"');
    });

    it("before Send to Support nothing shows and nothing is read", async () => {
      load({ snap: complete(), stage: "intake" });
      db.readCheckoutState.mockResolvedValue(OPEN);
      const html = await overview();
      expect(html).not.toContain("Pay and start your build");
      expect(db.readCheckoutState).not.toHaveBeenCalled();
    });
  });

  it("a load failure shows ERR-LOAD with Try again", async () => {
    load({});
    db.getIntakeSnapshot.mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await overview();
    err.mockRestore();
    expect(html).toContain("We couldn&#x27;t load this.");
    expect(html).toContain("Try again");
  });
});

describe("/hub/setup/[stage]", () => {
  it("an unknown step is a 404", async () => {
    await expect(stagePage("nope")).rejects.toThrow("NOT_FOUND");
  });

  it("the-rest renders the frame: rail, H1, autosave status, last-step footer", async () => {
    load({ snap: complete() });
    const html = renderToStaticMarkup(await stagePage("the-rest"));
    expect(html).toContain('aria-label="Setup steps"');
    expect(html).toMatch(
      /<a[^>]*aria-current="step"[^>]*>.*Domain &amp; the rest/,
    );
    expect(html).toMatch(/<h1[^>]*>Domain &amp; the rest<\/h1>/);
    expect(html).toContain('role="status"');
    expect(html).toContain("Back to all steps");
    expect(html).toContain("Review what&#x27;s still needed");
    const later = /<input[^>]*value="later"[^>]*>/.exec(html)?.[0] ?? "";
    expect(later).toContain('checked=""');
    expect(html).toContain("Google Analytics ID");
    expect(html).toContain("Legal business name");
    expect(STAGE_FORMS["the-rest"]).toBeTypeOf("function");
  });

  it("the email step (06-22) loads its routes; a failed load shows the error inside the frame", async () => {
    load({ snap: complete() });
    const html = renderToStaticMarkup(await stagePage("email"));
    // The email step reads the routes too; this suite's @cds/db mock has none, so the step
    // shows the load error (the frame itself is covered by the-rest above).
    expect(html).toContain("We couldn&#x27;t load this.");
    expect(html).toContain('href="/hub/setup/email"');
    expect(STAGE_FORMS.email).toBeTypeOf("function");
  });

  it("an editor sees the read-only line and disabled fields", async () => {
    load({ snap: complete(), role: "editor" });
    const html = renderToStaticMarkup(await stagePage("the-rest"));
    expect(html).toContain("Only the owner or an admin can change settings.");
    expect(html).toMatch(
      /id="field-ga4_id"[^>]*disabled=""|disabled=""[^>]*id="field-ga4_id"/,
    );
  });

  it("opening a step dismisses the first-visit welcome once", async () => {
    load({ snap: complete(), dismissed: false });
    mounted = mount(await stagePage("the-rest"));
    await flush();
    expect(actions.dismissFirstVisitAction).toHaveBeenCalledTimes(1);
  });
});

describe("Domain & the rest form (autosave)", () => {
  async function mountRest() {
    load({ snap: complete() });
    mounted = mount(await stagePage("the-rest"));
    return mounted.container;
  }

  function blur(el: Element | null) {
    act(() => {
      el!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  }

  it("choosing I have a domain saves the choice and reveals the domain fields", async () => {
    const root = await mountRest();
    expect(root.querySelector("#field-domain")).toBeNull();
    click(root.querySelector('input[name="domain_choice"][value="have"]'));
    await flush();
    expect(actions.saveAnswersAction).toHaveBeenCalledWith("the-rest", {
      domain_choice: "have",
    });
    const domain = root.querySelector("#field-domain");
    typeInto(domain, "https://www.RiveraBakery.com");
    expect((domain as HTMLInputElement).value).toBe("riverabakery.com");
    blur(domain);
    await flush();
    expect(actions.saveAnswersAction).toHaveBeenLastCalledWith("the-rest", {
      domain: "riverabakery.com",
    });
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Saved");
  });

  it("a bad Google Analytics ID shows the error and is not saved", async () => {
    const root = await mountRest();
    const ga = root.querySelector("#field-ga4_id");
    typeInto(ga, "UA-123");
    blur(ga);
    await flush();
    expect(root.textContent).toContain(GA4_ERROR);
    expect(actions.saveProfileAction).not.toHaveBeenCalled();
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      "1 field needs attention",
    );
    typeInto(ga, "g-abc1234");
    blur(ga);
    await flush();
    expect(actions.saveProfileAction).toHaveBeenCalledWith("the-rest", {
      ga4_id: "G-ABC1234",
    });
  });

  it("a server refusal shows under its field; other failures offer Try again", async () => {
    const root = await mountRest();
    actions.saveProfileAction.mockResolvedValueOnce({
      ok: false,
      code: "invalid_input",
      message:
        "That doesn't look like an email address. Check it and try again.",
    });
    const privacy = root.querySelector("#field-privacy_contact");
    typeInto(privacy, "nope");
    blur(privacy);
    await flush();
    expect(root.textContent).toContain(
      "That doesn't look like an email address.",
    );
    actions.saveProfileAction.mockResolvedValueOnce({
      ok: false,
      code: "save_failed",
      message: "x",
    });
    const legal = root.querySelector("#field-legal_name");
    typeInto(legal, "Rivera Bakery LLC");
    blur(legal);
    await flush();
    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      "Not saved.",
    );
    click(button(root, "Try again"));
    await flush();
    expect(actions.saveProfileAction).toHaveBeenLastCalledWith("the-rest", {
      legal_name: "Rivera Bakery LLC",
    });
  });

  it("pure helpers: live domain clean-up and the GA4 pattern", () => {
    expect(liveDomain("HTTPS://www.Example.com")).toBe("example.com");
    expect(ga4Error("")).toBeNull();
    expect(ga4Error("g-ABCD1234")).toBeNull();
    expect(ga4Error("UA-1")).toBe(GA4_ERROR);
  });
});
