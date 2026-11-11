// @vitest-environment jsdom
// 06-19 Task 2: setup steps "Your business" and "Contact & hours" (06-UI-SPEC "1 · Your
// business", "Font pairing cards", "2 · Contact & hours", "Hours editor"; ONB-01, ONB-04,
// ONB-13, D257, D-UI-P6-26; T-06-93). The session, @cds/db and the actions are mocked; the
// real /hub/setup/[stage] page, StageFrame and loadStageData run.
import { BUSINESS_TYPES, businessTypesFor } from "@cds/core/onboarding";
import { FONT_PAIRINGS } from "@cds/core/theme";
import { ToastRegion } from "@cds/ui/hub";
import { act, type ReactElement, type ReactNode } from "react";
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
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/setup/business",
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
const media = vi.hoisted(() => ({
  setMediaAltAction: vi.fn(),
  removeMediaAction: vi.fn(),
  restoreMediaAction: vi.fn(),
  reorderMediaAction: vi.fn(),
}));
vi.mock("../app/actions/media", () => media);

const { default: StagePage } =
  await import("../app/(platform)/hub/setup/[stage]/page");
const { STAGE_FORMS } =
  await import("../app/(platform)/hub/setup/[stage]/stage-forms");
const { pairingTheme, SAMPLE_LINE } =
  await import("../app/(platform)/hub/_intake/FontPairingPicker");
const { CONTACT_MISSING_COPY, CONTACT_GROUP_HELPER } =
  await import("../app/(platform)/hub/_intake/ContactFields");

function profile(over: Record<string, unknown> = {}) {
  return {
    id: "bp1",
    orgName: "Rivera Bakery",
    tagline: "",
    business_type: "bakery",
    business_type_other: "",
    description: "",
    phone: "",
    public_email: "maria@riverabakery.com",
    address: { street: "", city: "", state: "", zip: "" },
    service_area: "",
    time_zone: "America/Chicago",
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

function load(opts: {
  role?: string;
  prof?: Record<string, unknown>;
  media?: unknown[];
}) {
  const ctx = { ...CTX, role: opts.role ?? "owner" };
  sess.requireHubSession.mockResolvedValue({
    ctx,
    email: "a@b.c",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
  db.getOrgStage.mockResolvedValue({ stage: "intake", path: "standard" });
  const p = profile(opts.prof);
  const { id: _id, orgName, ...values } = p;
  void _id;
  const snap = {
    orgName,
    path: "standard",
    profile: values,
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
  };
  db.getIntakeSnapshot.mockResolvedValue(snap);
  db.getBusinessProfile.mockResolvedValue(p);
  db.getOrgIntake.mockResolvedValue({
    selections: snap.selections,
    answers: snap.answers,
    stagesSaved: [],
    firstVisitDismissed: true,
    submittedAt: null,
    addonConfig: {},
    moodboardProposal: null,
  });
  db.listMedia.mockResolvedValue(opts.media ?? []);
}

async function open(stage: string): Promise<Mounted> {
  const el = (await StagePage({
    params: Promise.resolve({ stage }),
  })) as ReactElement;
  return mount(<ToastRegion>{el}</ToastRegion>);
}

function blur(el: Element | null) {
  if (!el) throw new Error("blur: not found");
  act(() => {
    (el as HTMLElement).focus();
    (el as HTMLElement).blur();
  });
}

function q<T extends Element = HTMLInputElement>(
  root: ParentNode,
  sel: string,
) {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`not found: ${sel}`);
  return el;
}

function choose(el: HTMLSelectElement, value: string) {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function profileCalls(stage: string) {
  return actions.saveProfileAction.mock.calls
    .filter((c) => c[0] === stage)
    .map((c) => c[1] as Record<string, unknown>);
}

let mounted: Mounted | null = null;
beforeEach(() => {
  for (const fn of [
    ...Object.values(db),
    ...Object.values(actions),
    ...Object.values(media),
  ]) {
    fn.mockReset();
  }
  for (const fn of [...Object.values(actions), ...Object.values(media)]) {
    fn.mockResolvedValue({ ok: true, data: null });
  }
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("STAGE_FORMS", () => {
  it("registers business, contact and the-rest", () => {
    expect(STAGE_FORMS.business).toBeTypeOf("function");
    expect(STAGE_FORMS.contact).toBeTypeOf("function");
    expect(STAGE_FORMS["the-rest"]).toBeTypeOf("function");
  });
});

describe("1 · Your business", () => {
  it("shows name, tagline counter with Optional, the path's business types and the logo field", async () => {
    load({});
    mounted = await open("business");
    const c = mounted.container;
    expect(q(c, "#field-org_name").value).toBe("Rivera Bakery");
    expect(c.textContent).toContain("0 / 80");
    expect(c.textContent).toContain("Optional");
    const types = Array.from(
      q<HTMLSelectElement>(c, "#field-business_type").options,
    ).map((o) => o.value);
    const standard = businessTypesFor("standard").map((t) => t.id);
    expect(types.slice(1)).toEqual(standard);
    const studioOnly = BUSINESS_TYPES.filter(
      (t) => !t.paths.includes("standard"),
    );
    for (const t of studioOnly) expect(types).not.toContain(t.id);
    expect(q<HTMLSelectElement>(c, "#field-business_type").value).toBe(
      "bakery",
    );
    expect(
      q(c, '#field-logo input[type="file"]').getAttribute("aria-label"),
    ).toBe("Choose a logo");
  });

  it("the business name saves on blur as org_name; an empty name is refused and not sent", async () => {
    load({});
    mounted = await open("business");
    const name = q(mounted.container, "#field-org_name");
    typeInto(name, "Rivera Bakery & Cafe");
    blur(name);
    await flush();
    expect(profileCalls("business")).toContainEqual({
      org_name: "Rivera Bakery & Cafe",
    });
    actions.saveProfileAction.mockClear();
    typeInto(name, "  ");
    blur(name);
    await flush();
    expect(mounted.container.textContent).toContain("Add your business name.");
    expect(mounted.container.textContent).toContain("1 field needs attention");
    expect(actions.saveProfileAction).not.toHaveBeenCalled();
  });

  it("the tagline counts and saves on blur", async () => {
    load({});
    mounted = await open("business");
    const t = q(mounted.container, "#field-tagline");
    typeInto(t, "Sourdough baked daily in Austin.");
    expect(mounted.container.textContent).toContain("32 / 80");
    blur(t);
    await flush();
    expect(profileCalls("business")).toContainEqual({
      tagline: "Sourdough baked daily in Austin.",
    });
  });

  it("seven style cards, Let CDS choose checked, each with a [data-site] sample", async () => {
    load({});
    mounted = await open("business");
    const c = mounted.container;
    const radios = c.querySelectorAll<HTMLInputElement>(
      'input[name="font_pairing"]',
    );
    expect(radios).toHaveLength(7);
    expect(q(c, 'input[value="cds-choose"]').checked).toBe(true);
    const samples = c.querySelectorAll("#field-font_pairing [data-site]");
    expect(samples).toHaveLength(7);
    for (const s of samples) {
      expect(s.textContent).toContain("Rivera Bakery");
      expect(s.textContent).toContain(SAMPLE_LINE);
    }
    const labels = Array.from(
      c.querySelectorAll("#field-font_pairing label"),
    ).map((l) => l.textContent ?? "");
    expect(labels[0]).toContain("Let CDS choose");
    expect(labels[0]).toContain("We'll pick fonts that fit your mood board.");
    expect(labels[1]).toContain("Warm and classic");
  });

  it("each sample scope carries its pairing's faces under its own hash", () => {
    const themes = FONT_PAIRINGS.map((p, i) => pairingTheme(p, i));
    expect(new Set(themes.map((t) => t.hash)).size).toBe(7);
    expect(themes[1]!.css).toContain("Fraunces Variable");
    expect(themes[1]!.css).toContain("Source Serif 4 Variable");
    expect(themes[0]!.css).not.toContain("Variable");
  });

  it("choosing a style saves font_pairing on change: Saving… then Saved", async () => {
    load({});
    let resolve: (v: unknown) => void = () => {};
    actions.saveProfileAction.mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    mounted = await open("business");
    click(q(mounted.container, 'input[value="bold-clear"]'));
    await flush(1);
    expect(profileCalls("business")).toContainEqual({
      font_pairing: "bold-clear",
    });
    expect(q(mounted.container, '[role="status"]').textContent).toContain(
      "Saving…",
    );
    await act(async () => resolve({ ok: true, data: null }));
    await flush();
    expect(mounted.container.textContent).toContain("Saved");
  });

  it("an existing logo shows on light and on dark; Remove calls the action with Undo", async () => {
    load({
      media: [
        {
          id: "logo1",
          kind: "logo",
          width: 1200,
          height: 600,
          webWidth: 1200,
          webHeight: 600,
          bytes: 90_000,
          mime: "image/png",
          alt: "Rivera Bakery",
          sortOrder: 0,
          url: "/hub/media/logo1/thumb",
        },
      ],
    });
    mounted = await open("business");
    const c = mounted.container;
    expect(c.textContent).toContain("On light");
    expect(c.textContent).toContain("On dark");
    click(button(c, "Remove"));
    await flush();
    expect(media.removeMediaAction).toHaveBeenCalledWith("logo1");
    expect(c.textContent).toContain("Photo removed.");
    click(button(c, "Undo"));
    await flush();
    expect(media.restoreMediaAction).toHaveBeenCalledWith("logo1");
    expect(c.textContent).toContain("On dark");
  });

  it("an editor sees every field disabled and no upload", async () => {
    load({ role: "editor" });
    mounted = await open("business");
    const c = mounted.container;
    expect(c.textContent).toContain(
      "Only the owner or an admin can change settings.",
    );
    expect(q(c, "#field-org_name").disabled).toBe(true);
    expect(q(c, 'input[value="bold-clear"]').disabled).toBe(true);
    expect(c.querySelector('#field-logo input[type="file"]')).toBeNull();
  });
});

describe("2 · Contact & hours", () => {
  it("phone and public email with the group helper; email prefilled", async () => {
    load({});
    mounted = await open("contact");
    const c = mounted.container;
    expect(q(c, "#field-phone").getAttribute("type")).toBe("tel");
    expect(q(c, "#field-phone").getAttribute("autocomplete")).toBe("tel");
    expect(q(c, "#field-public_email").value).toBe("maria@riverabakery.com");
    expect(c.textContent).toContain(CONTACT_GROUP_HELPER);
    expect(c.textContent).toContain(
      "Shown on your site. It can differ from your sign-in email.",
    );
  });

  it("clearing both phone and email shows the copy and does not save", async () => {
    load({});
    mounted = await open("contact");
    const email = q(mounted.container, "#field-public_email");
    typeInto(email, "");
    blur(email);
    await flush();
    expect(mounted.container.textContent).toContain(CONTACT_MISSING_COPY);
    expect(actions.saveProfileAction).not.toHaveBeenCalled();
    const phone = q(mounted.container, "#field-phone");
    typeInto(phone, "512 555 0100");
    blur(phone);
    await flush();
    expect(profileCalls("contact")).toContainEqual({ phone: "512 555 0100" });
    // C-WR-02: the refused clear goes out once the pair is valid again.
    expect(profileCalls("contact")).toContainEqual({ public_email: "" });
    expect(mounted.container.textContent).not.toContain(CONTACT_MISSING_COPY);
  });

  it("an empty time zone is prefilled from the browser and saved", async () => {
    load({ prof: { time_zone: "" } });
    mounted = await open("contact");
    await flush();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    expect(
      q<HTMLSelectElement>(mounted.container, "#field-time_zone").value,
    ).toBe(tz);
    expect(profileCalls("contact")).toContainEqual({ time_zone: tz });
    expect(mounted.container.textContent).toContain(`Times are in ${tz}.`);
  });

  it("address parts save together on blur with autocomplete parts", async () => {
    load({});
    mounted = await open("contact");
    const c = mounted.container;
    expect(q(c, "#field-address-street").getAttribute("autocomplete")).toBe(
      "street-address",
    );
    expect(q(c, "#field-address-zip").getAttribute("autocomplete")).toBe(
      "postal-code",
    );
    typeInto(q(c, "#field-address-city"), "Austin");
    blur(q(c, "#field-address-city"));
    await flush();
    expect(profileCalls("contact")).toContainEqual({
      address: { street: "", city: "Austin", state: "", zip: "" },
    });
  });

  it("hours: opening Monday saves the week after the 800 ms debounce", async () => {
    load({});
    mounted = await open("contact");
    const c = mounted.container;
    expect(c.textContent).toContain("Times are in America/Chicago.");
    click(q(c, 'input[aria-label="Open on Monday"]'));
    await flush(1);
    expect(profileCalls("contact")).toEqual([]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
    await flush();
    const saved = profileCalls("contact").find((p) => "hours" in p);
    expect((saved?.hours as Record<string, unknown> | undefined)?.mon).toEqual({
      open: true,
      ranges: [{ start: "09:00", end: "17:00" }],
    });
  });

  it("hours: a closing time before the opening time shows the row error and is not sent", async () => {
    load({});
    mounted = await open("contact");
    const c = mounted.container;
    click(q(c, 'input[aria-label="Open on Monday"]'));
    choose(
      q<HTMLSelectElement>(c, 'select[aria-label="Monday closes at"]'),
      "08:00",
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
    await flush();
    expect(c.textContent).toContain(
      "Monday's closing time is before its opening time. Pick a later closing time.",
    );
    const sent = profileCalls("contact").filter((p) => "hours" in p);
    for (const s of sent) {
      const mon = (
        s.hours as Record<string, { ranges: { end: string }[] }> | null
      )?.mon;
      expect(mon?.ranges[0]?.end).not.toBe("08:00");
    }
  });

  it("social links: add a row, save its URL on blur, remove it by name", async () => {
    load({});
    mounted = await open("contact");
    const c = mounted.container;
    click(button(c, "Add a social link"));
    const url = q(c, 'input[type="url"]');
    typeInto(url, "https://instagram.com/riverabakery");
    blur(url);
    await flush();
    expect(profileCalls("contact")).toContainEqual({
      socials: [
        { platform: "instagram", url: "https://instagram.com/riverabakery" },
      ],
    });
    click(button(c, "Remove Instagram link"));
    await flush();
    expect(profileCalls("contact").at(-1)).toEqual({ socials: [] });
  });

  it("an editor sees every contact field disabled", async () => {
    load({ role: "editor" });
    mounted = await open("contact");
    const c = mounted.container;
    expect(q(c, "#field-phone").disabled).toBe(true);
    expect(q<HTMLSelectElement>(c, "#field-time_zone").disabled).toBe(true);
    expect(button(c, "Add a social link")).toBeNull();
    expect(button(c, "Copy Monday to weekdays")).toBeNull();
    expect(actions.saveProfileAction).not.toHaveBeenCalled();
  });
});
