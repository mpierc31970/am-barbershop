// @vitest-environment jsdom
// 06-21: the mood board and step 6 "Photos & look" (06-UI-SPEC "Mood board", "6 · Photos &
// look", "Upload field"; ONB-05, ONB-04, D47, D280, D-UI-P6-28, D-UI-P6-29). The media and
// intake actions are mocked; uploads go through a fake XMLHttpRequest; the browser palette
// runs the real extractPalette over a stubbed decoder + canvas.
import {
  extractPalette,
  proposeRoles,
  type MoodboardProposal,
} from "@cds/core/theme";
import { ToastRegion } from "@cds/ui/hub";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  click,
  flush,
  mount,
  button,
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
  usePathname: () => "/hub/setup/look",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const media = vi.hoisted(() => ({
  setMediaAltAction: vi.fn(),
  removeMediaAction: vi.fn(),
  restoreMediaAction: vi.fn(),
  reorderMediaAction: vi.fn(),
}));
vi.mock("../app/actions/media", () => media);

// Task 2: the real /hub/setup/[stage] page and loadStageData over a mocked session and @cds/db.
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
  listTeam: vi.fn(),
  listServices: vi.fn(),
}));
vi.mock("@cds/db", () => db);
const intake = vi.hoisted(() => ({
  saveProfileAction: vi.fn(),
  saveAnswersAction: vi.fn(),
  markStageSavedAction: vi.fn(),
  dismissFirstVisitAction: vi.fn(),
  sendToCdsAction: vi.fn(),
}));
vi.mock("../app/actions/intake", () => intake);
vi.mock("../app/actions/core-lists", () => ({}));
vi.mock("../app/actions/addon-intake", () => ({}));

const palette = vi.hoisted(() => ({ paletteFromFile: vi.fn() }));
vi.mock("../app/(platform)/hub/_intake/client-palette", async (orig) => {
  const real =
    await orig<typeof import("../app/(platform)/hub/_intake/client-palette")>();
  return { ...real, paletteFromFile: palette.paletteFromFile };
});

const { MoodBoard, MOODBOARD_EMPTY, MOODBOARD_WARNING, MOODBOARD_FIRST } =
  await import("../app/(platform)/hub/_intake/MoodBoard");
const { solverNotes, ROLE_NAMES, PREVIEW_CAPTION } =
  await import("../app/(platform)/hub/_intake/MoodboardPreviewCard");
const { nearestColourName, paletteLabel } =
  await import("../app/(platform)/hub/_intake/colour-names");

// ---- fixtures ----------------------------------------------------------------------------

/** 8x8 RGBA: 40 px deep green, 16 cream, 8 rust. */
function fixtureBuffer(): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const data = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < 64; i += 1) {
    const [r, g, b] =
      i < 40 ? [31, 77, 54] : i < 56 ? [243, 236, 216] : [183, 65, 14];
    data.set([r, g, b, 255], i * 4);
  }
  return { data, width: 8, height: 8 };
}

const CLIENT: MoodboardProposal = proposeRoles(extractPalette(fixtureBuffer()));
const SERVER: MoodboardProposal = proposeRoles([
  { hex: "#2f6fd0", weight: 500 },
  { hex: "#fafafa", weight: 300 },
]);

function asset(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    kind: "moodboard",
    width: 1200,
    height: 800,
    webWidth: 1200,
    bytes: 200_000,
    alt: "",
    thumbUrl: `/hub/media/${id}/thumb`,
    ...over,
  };
}

// ---- fake XHR for ImageUpload ------------------------------------------------------------

class FakeXHR {
  static last: FakeXHR | null = null;
  upload: { onprogress: unknown; onload: (() => void) | null } = {
    onprogress: null,
    onload: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = "";
  open() {}
  send() {
    FakeXHR.last = this;
  }
  abort() {
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    act(() => this.onload?.());
  }
}

function pickFile(c: ParentNode, inputId: string, name = "board.jpg") {
  const input = c.querySelector<HTMLInputElement>(`#${inputId}`);
  if (!input) throw new Error(`no input #${inputId}`);
  const file = new File([new Uint8Array(16)], name, { type: "image/jpeg" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return file;
}

let mounted: Mounted | null = null;
beforeEach(() => {
  for (const fn of [
    ...Object.values(media),
    ...Object.values(palette),
    ...Object.values(db),
    ...Object.values(intake),
  ]) {
    fn.mockReset();
  }
  for (const fn of [...Object.values(media), ...Object.values(intake)]) {
    fn.mockResolvedValue({ ok: true, data: null });
  }
  FakeXHR.last = null;
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

function show(ui: ReactNode): Mounted {
  mounted = mount(<ToastRegion>{ui}</ToastRegion>);
  return mounted;
}

function board(over: Partial<Parameters<typeof MoodBoard>[0]> = {}): ReactNode {
  return (
    <MoodBoard
      initial={[]}
      proposal={null}
      pairingId="cds-choose"
      businessName="Rivera Bakery"
      tagline=""
      readOnly={false}
      {...over}
    />
  );
}

// ---- Task 1 --------------------------------------------------------------------------------

describe("client palette", () => {
  it("paletteFromFile: decoded + drawn pixels give exactly extractPalette's swatches", async () => {
    const buf = fixtureBuffer();
    const bitmap = { width: 8, height: 8, close: vi.fn() };
    const createImageBitmap = vi.fn(async () => bitmap);
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({
      data: buf.data,
      width: 8,
      height: 8,
    }));
    class FakeOffscreen {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { drawImage, getImageData };
      }
    }
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("OffscreenCanvas", FakeOffscreen);
    const real = await vi.importActual<
      typeof import("../app/(platform)/hub/_intake/client-palette")
    >("../app/(platform)/hub/_intake/client-palette");
    const file = new File([new Uint8Array(4)], "a.png", { type: "image/png" });
    const p = await real.paletteFromFile(file);
    expect(p.swatches).toEqual(extractPalette(buf));
    expect(p).toEqual(CLIENT);
    expect(createImageBitmap).toHaveBeenCalledWith(file, {
      imageOrientation: "from-image",
    });
    expect(getImageData).toHaveBeenCalledWith(0, 0, 8, 8, {
      colorSpace: "srgb",
    });
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("refuses a file over 20 MB before decoding (T-06-101)", async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const real = await vi.importActual<
      typeof import("../app/(platform)/hub/_intake/client-palette")
    >("../app/(platform)/hub/_intake/client-palette");
    const big = { size: 21 * 1024 * 1024 } as File;
    await expect(real.paletteFromFile(big)).rejects.toThrow();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("isProposal only accepts eight #rrggbb roles", async () => {
    const real = await vi.importActual<
      typeof import("../app/(platform)/hub/_intake/client-palette")
    >("../app/(platform)/hub/_intake/client-palette");
    expect(real.isProposal(CLIENT)).toBe(true);
    expect(
      real.isProposal({
        ...CLIENT,
        roles: { ...CLIENT.roles, accent: "red;}" },
      }),
    ).toBe(false);
    expect(real.isProposal(null)).toBe(false);
  });
});

describe("colour names", () => {
  it("names by nearest plain colour and builds the strip's label", () => {
    expect(nearestColourName("#1f4a33")).toBe("deep green");
    expect(nearestColourName("#f4eddb")).toBe("cream");
    expect(nearestColourName("#b5420f")).toBe("rust");
    expect(nearestColourName("nope")).toBe("colour");
    expect(
      paletteLabel([
        { hex: "#1f4d36" },
        { hex: "#f3ecd8" },
        { hex: "#b7410e" },
      ]),
    ).toBe("Colours from your mood board: deep green, cream, rust");
  });
});

describe("MoodBoard", () => {
  it("no mood board: the first-look line, no strip or card", () => {
    const { container: c } = show(board());
    expect(c.textContent).toContain(MOODBOARD_EMPTY);
    expect(c.querySelector("[data-palette-strip]")).toBeNull();
    expect(c.querySelector("[data-site]")).toBeNull();
  });

  it("on pick: strip + card from the client palette before the upload answers; the server's replaces it", async () => {
    palette.paletteFromFile.mockResolvedValue(CLIENT);
    const { container: c } = show(board());
    pickFile(c, "field-moodboard-upload-input");
    await flush();
    expect(FakeXHR.last).not.toBeNull(); // upload still in flight
    const strip = c.querySelector("[data-palette-strip]");
    expect(strip?.getAttribute("aria-label")).toBe(
      "Colours from your mood board: deep green, cream, rust",
    );
    expect(c.querySelector('[data-theme="proposal"]')).not.toBeNull();
    const style = c.querySelector(
      '[data-theme="proposal"] style',
    )!.textContent!;
    expect(style).toContain(`--site-primary:${CLIENT.roles.primary};`);

    FakeXHR.last!.respond(200, { asset: asset("mb1"), proposal: SERVER });
    await flush();
    const after = c.querySelector(
      '[data-theme="proposal"] style',
    )!.textContent!;
    expect(after).toContain(`--site-primary:${SERVER.roles.primary};`);
    expect(c.textContent).toContain(MOODBOARD_FIRST);
  });

  it("a late client result never overwrites the server's", async () => {
    let resolve!: (p: MoodboardProposal) => void;
    palette.paletteFromFile.mockReturnValue(
      new Promise<MoodboardProposal>((r) => (resolve = r)),
    );
    const { container: c } = show(board());
    pickFile(c, "field-moodboard-upload-input");
    FakeXHR.last!.respond(200, { asset: asset("mb1"), proposal: SERVER });
    await flush();
    await act(async () => resolve(CLIENT));
    await flush();
    const css = c.querySelector('[data-theme="proposal"] style')!.textContent!;
    expect(css).toContain(`--site-primary:${SERVER.roles.primary};`);
  });

  it("extraction failure: the warning, and the upload still goes", async () => {
    palette.paletteFromFile.mockRejectedValue(new Error("decode"));
    const { container: c } = show(board());
    pickFile(c, "field-moodboard-upload-input");
    await flush();
    expect(c.textContent).toContain(MOODBOARD_WARNING);
    expect(c.textContent).toContain(
      "We couldn't read colours from this image. Try another one; CDS will still see it.",
    );
    expect(FakeXHR.last).not.toBeNull();
  });

  it("only the first mood board drives colours: a second pick doesn't recompute", async () => {
    const { container: c } = show(
      board({ initial: [asset("mb1")], proposal: SERVER }),
    );
    pickFile(c, "field-moodboard-upload-input");
    await flush();
    expect(palette.paletteFromFile).not.toHaveBeenCalled();
  });

  it("preview card: [data-site][data-theme=proposal], name, 'Welcome in', 'Book a visit', surface-raised strip, caption", () => {
    const { container: c } = show(
      board({ initial: [asset("mb1")], proposal: SERVER }),
    );
    const card = c.querySelector<HTMLElement>(
      '[data-site][data-theme="proposal"]',
    )!;
    expect(card).not.toBeNull();
    expect(card.className).toContain("outline-hub-border-strong");
    expect(card.querySelector("[data-preview-heading]")?.textContent).toBe(
      "Rivera Bakery",
    );
    expect(card.textContent).toContain("Welcome in");
    expect(card.querySelector("[data-preview-button]")?.textContent).toBe(
      "Book a visit",
    );
    expect(card.querySelector("[data-preview-strip]")?.className).toContain(
      "bg-site-surface-raised",
    );
    expect(c.textContent).toContain(PREVIEW_CAPTION);
  });

  it("the tagline replaces 'Welcome in'; the pairing's faces reach the scope", () => {
    const { container: c } = show(
      board({
        initial: [asset("mb1")],
        proposal: SERVER,
        tagline: "Sourdough baked daily in Austin.",
        pairingId: "warm-classic",
      }),
    );
    const card = c.querySelector('[data-theme="proposal"]')!;
    expect(card.textContent).toContain("Sourdough baked daily in Austin.");
    expect(card.textContent).not.toContain("Welcome in");
    expect(card.querySelector("style")!.textContent).toMatch(
      /--site-font-heading:[^;]+;/,
    );
  });

  it("roles: eight owner-named rows with hex", () => {
    const { container: c } = show(
      board({ initial: [asset("mb1")], proposal: SERVER }),
    );
    const dts = Array.from(c.querySelectorAll("dl dt")).map(
      (d) => d.textContent,
    );
    expect(dts).toEqual([
      "Page background",
      "Section background",
      "Text",
      "Soft text",
      "Buttons and links",
      "Button text",
      "Highlight",
      "Lines",
    ]);
    expect(Object.values(ROLE_NAMES)).toHaveLength(8);
    const dds = Array.from(c.querySelectorAll("dl dd")).map(
      (d) => d.textContent,
    );
    expect(dds).toEqual(Object.values(SERVER.roles));
  });

  it("solver notes read as sentences, never ratios; no 'Use these colours'", () => {
    const adjusted: MoodboardProposal = {
      ...SERVER,
      adjustments: [
        {
          role: "accent",
          from: "#f5d63d",
          to: "#a08000",
          fromL: 0.87,
          toL: 0.6,
          reason: "accent on surface 1.4:1 < 3:1",
          fallback: false,
        },
      ],
    };
    const { container: c } = show(
      board({ initial: [asset("mb1")], proposal: adjusted }),
    );
    expect(c.textContent).toContain(
      "We darkened your highlight colour a little so it's easy to read.",
    );
    expect(c.textContent).not.toMatch(/\d+(\.\d+)?:1/);
    expect(c.textContent).not.toContain("Use these colours");
    expect(button(c, /use these colours/i)).toBeNull();
    expect(
      solverNotes([
        { role: "text", fromL: 0.4, toL: 0.6 },
        { role: "mystery-role", fromL: 0.5, toL: 0.5 },
      ]),
    ).toEqual([
      "We lightened your text colour a little so it's easy to read.",
      "We adjusted your mystery role colour a little so it's easy to read.",
    ]);
  });

  it("C-WR-09: Undo puts a removed mood board back in its old place", async () => {
    media.removeMediaAction.mockResolvedValue({ ok: true, data: null });
    media.restoreMediaAction.mockResolvedValue({ ok: true, data: null });
    const { container: c } = show(
      board({
        initial: [asset("mb1"), asset("mb2"), asset("mb3")],
        proposal: SERVER,
      }),
    );
    const ids = () =>
      Array.from(c.querySelectorAll('[id^="alt-"]')).map((e) => e.id);
    expect(ids()).toEqual(["alt-mb1", "alt-mb2", "alt-mb3"]);
    click(
      Array.from(c.querySelectorAll("button")).find(
        (b) => b.textContent === "Remove",
      )!,
    );
    await flush();
    expect(ids()).toEqual(["alt-mb2", "alt-mb3"]);
    click(button(document.body, "Undo"));
    await flush();
    expect(media.restoreMediaAction).toHaveBeenCalledWith("mb1");
    expect(ids()).toEqual(["alt-mb1", "alt-mb2", "alt-mb3"]);
  });

  it("reorder: the server's recomputed proposal replaces the card; removing the last hides it", async () => {
    media.reorderMediaAction.mockResolvedValue({
      ok: true,
      data: { proposal: CLIENT },
    });
    const { container: c } = show(
      board({ initial: [asset("mb1"), asset("mb2")], proposal: SERVER }),
    );
    click(button(c, "Move photo 2 earlier"));
    await flush();
    expect(media.reorderMediaAction).toHaveBeenCalledWith("moodboard", [
      "mb2",
      "mb1",
    ]);
    expect(
      c.querySelector('[data-theme="proposal"] style')!.textContent,
    ).toContain(`--site-primary:${CLIENT.roles.primary};`);

    media.removeMediaAction.mockResolvedValue({
      ok: true,
      data: { proposal: null },
    });
    const removes = Array.from(c.querySelectorAll("button")).filter(
      (b) => b.textContent === "Remove",
    );
    click(removes[0]!);
    await flush();
    click(
      Array.from(c.querySelectorAll("button")).find(
        (b) => b.textContent === "Remove",
      )!,
    );
    await flush();
    expect(c.querySelector('[data-theme="proposal"]')).toBeNull();
    expect(c.textContent).toContain(MOODBOARD_EMPTY);
  });
});

// ---- Task 2 --------------------------------------------------------------------------------

const { default: StagePage } =
  await import("../app/(platform)/hub/setup/[stage]/page");
const { STAGE_FORMS } =
  await import("../app/(platform)/hub/setup/[stage]/stage-forms");
const { loadStageData } = await import("../lib/intake");
const { HERO_HELPER, GALLERY_HELPER } =
  await import("../app/(platform)/hub/_intake/PhotoFields");
const { ALT_MISSING_COPY } = await import("@cds/ui/hub");

function mediaRow(id: string, kind: string, alt = "") {
  return {
    id,
    kind,
    width: 2400,
    height: 1600,
    webWidth: 2400,
    bytes: 900_000,
    alt,
  };
}

function load(
  opts: {
    role?: string;
    media?: ReturnType<typeof mediaRow>[];
    proposal?: MoodboardProposal | null;
    missingAlt?: number;
  } = {},
) {
  const ctx = { ...CTX, role: opts.role ?? "owner" };
  sess.requireHubSession.mockResolvedValue({
    ctx,
    email: "a@b.c",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
  db.getOrgStage.mockResolvedValue({ stage: "intake", path: "standard" });
  const p = {
    id: "bp1",
    orgName: "Rivera Bakery",
    tagline: "Sourdough baked daily in Austin.",
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
  };
  const { id: _id, orgName, ...values } = p;
  void _id;
  const selections = {
    addons: [],
    extras: [],
    carePlan: false,
    cadence: "monthly",
  };
  const answers = {
    domain_choice: "later",
    domain: "",
    registrar: "",
    domain_ideas: "",
    gbp: "",
  };
  const rows = opts.media ?? [];
  const count = (k: string) => rows.filter((r) => r.kind === k).length;
  db.getIntakeSnapshot.mockResolvedValue({
    orgName,
    path: "standard",
    profile: values,
    answers,
    counts: {
      services: 0,
      team: 0,
      gallery: count("gallery"),
      moodboard: count("moodboard"),
    },
    media: {
      logo: false,
      hero: count("hero") > 0,
      photosMissingAlt: opts.missingAlt ?? 0,
    },
    email: { defaultConfirmed: true, bouncing: 0 },
    addonIntake: {},
    selections,
    stagesSaved: [],
  });
  db.getBusinessProfile.mockResolvedValue(p);
  db.getOrgIntake.mockResolvedValue({
    selections,
    answers,
    stagesSaved: [],
    firstVisitDismissed: true,
    submittedAt: null,
    addonConfig: {},
    moodboardProposal: opts.proposal ?? null,
  });
  db.listMedia.mockResolvedValue(rows);
  db.listTeam.mockResolvedValue([]);
  db.listServices.mockResolvedValue([]);
}

async function openLook(): Promise<Mounted> {
  const el = await StagePage({ params: Promise.resolve({ stage: "look" }) });
  return show(el);
}

function blur(el: Element | null) {
  if (!el) throw new Error("blur: not found");
  act(() => {
    (el as HTMLElement).focus();
    (el as HTMLElement).blur();
  });
}

describe("6 · Photos & look", () => {
  it("registers look in STAGE_FORMS", () => {
    expect(STAGE_FORMS.look).toBeTypeOf("function");
  });

  it("Main photo (Optional, fallback helper), More photos (up to 12), and the mood board", async () => {
    load();
    const { container: c } = await openLook();
    expect(c.querySelector("h1")?.textContent).toBe("Photos & look");
    expect(c.querySelector("#field-hero-label")?.textContent).toBe(
      "Main photo",
    );
    expect(c.textContent).toContain(HERO_HELPER);
    expect(c.querySelector("#field-gallery-label")?.textContent).toBe(
      "More photos",
    );
    expect(c.textContent).toContain(GALLERY_HELPER);
    expect(c.querySelector("#field-hero-input")).not.toBeNull();
    expect(c.querySelector("#field-gallery-input")).not.toBeNull();
    expect(c.querySelector("#field-moodboard")?.textContent).toBe(
      "Your mood board",
    );
    expect(c.textContent).toContain(
      "We pull colours from the first one so you can see a first look.",
    );
    expect(c.textContent).toContain(MOODBOARD_EMPTY);
    expect(c.querySelector("#field-moodboard-upload-input")).not.toBeNull();
  });

  it("a saved hero or gallery photo with no description shows the hint; the step counts it as needed", async () => {
    load({
      media: [mediaRow("h1", "hero"), mediaRow("g1", "gallery")],
      missingAlt: 2,
    });
    const { container: c } = await openLook();
    const hints = c.textContent!.split(ALT_MISSING_COPY).length - 1;
    expect(hints).toBe(2);
    const data = await loadStageData(CTX as never, "look");
    expect(data.needed.required.map((n) => n.fieldId)).toContain(
      "photo_descriptions",
    );
    expect(data.stages.find((s) => s.slug === "look")?.status).not.toBe("done");
  });

  it("the first upload marks the step saved, once", async () => {
    load();
    const { container: c } = await openLook();
    pickFile(c, "field-hero-input", "hero.jpg");
    FakeXHR.last!.respond(200, { asset: { ...asset("h1"), kind: "hero" } });
    await flush();
    pickFile(c, "field-gallery-input", "g.jpg");
    FakeXHR.last!.respond(200, { asset: { ...asset("g1"), kind: "gallery" } });
    await flush();
    expect(intake.markStageSavedAction).toHaveBeenCalledTimes(1);
    expect(intake.markStageSavedAction).toHaveBeenCalledWith("look");
    expect(c.querySelector("#alt-h1")).not.toBeNull();
    expect(c.querySelector("#alt-g1")).not.toBeNull();
  });

  it("a description saves through setMediaAltAction and marks the step saved", async () => {
    load({ media: [mediaRow("g1", "gallery")], missingAlt: 1 });
    const { container: c } = await openLook();
    const field = c.querySelector("#alt-g1");
    typeInto(field, "Loaves cooling on a rack");
    blur(field);
    await flush(10);
    expect(media.setMediaAltAction).toHaveBeenCalledWith(
      "g1",
      "Loaves cooling on a rack",
    );
    expect(intake.markStageSavedAction).toHaveBeenCalledWith("look");
  });

  it("C-CR-02: descriptions typed on several photos while one saves are all saved", async () => {
    load({
      media: [
        mediaRow("g1", "gallery"),
        mediaRow("g2", "gallery"),
        mediaRow("g3", "gallery"),
      ],
      missingAlt: 3,
    });
    let release!: (v: { ok: true; data: null }) => void;
    media.setMediaAltAction
      .mockReturnValueOnce(new Promise((r) => (release = r)))
      .mockResolvedValue({ ok: true, data: null });
    const { container: c } = await openLook();
    for (const [id, text] of [
      ["g1", "Loaves"],
      ["g2", "Counter"],
      ["g3", "Oven"],
    ] as const) {
      const field = c.querySelector(`#alt-${id}`);
      typeInto(field, text);
      blur(field);
    }
    expect(media.setMediaAltAction).toHaveBeenCalledTimes(1);
    release({ ok: true, data: null });
    await flush(10);
    expect(media.setMediaAltAction.mock.calls).toEqual([
      ["g1", "Loaves"],
      ["g2", "Counter"],
      ["g3", "Oven"],
    ]);
    expect(c.querySelector('[role="status"]')?.textContent).toBe("Saved");
  });

  it("C-WR-09: Undo puts a removed gallery photo back in its old place", async () => {
    load({
      media: [
        mediaRow("g1", "gallery", "One"),
        mediaRow("g2", "gallery", "Two"),
        mediaRow("g3", "gallery", "Three"),
      ],
    });
    const { container: c } = await openLook();
    const gallery = c.querySelector("#field-gallery")!;
    const ids = () =>
      Array.from(gallery.querySelectorAll('[id^="alt-"]')).map((e) => e.id);
    const removes = Array.from(gallery.querySelectorAll("button")).filter(
      (b) => b.textContent === "Remove",
    );
    click(removes[1]!);
    await flush();
    expect(ids()).toEqual(["alt-g1", "alt-g3"]);
    click(button(document.body, "Undo"));
    await flush();
    expect(ids()).toEqual(["alt-g1", "alt-g2", "alt-g3"]);
  });

  it("gallery reorder goes through reorderMediaAction('gallery', …)", async () => {
    load({
      media: [
        mediaRow("g1", "gallery", "One"),
        mediaRow("g2", "gallery", "Two"),
      ],
    });
    const { container: c } = await openLook();
    const gallery = c.querySelector("#field-gallery")!;
    click(button(gallery, "Move photo 2 earlier"));
    await flush();
    expect(media.reorderMediaAction).toHaveBeenCalledWith("gallery", [
      "g2",
      "g1",
    ]);
  });

  it("stored mood boards: the first is labelled, the stored proposal previews with the tagline", async () => {
    load({
      media: [mediaRow("mb1", "moodboard"), mediaRow("mb2", "moodboard")],
      proposal: SERVER,
    });
    const { container: c } = await openLook();
    expect(c.textContent!.split(MOODBOARD_FIRST).length - 1).toBe(1);
    const card = c.querySelector('[data-site][data-theme="proposal"]')!;
    expect(card.textContent).toContain("Rivera Bakery");
    expect(card.textContent).toContain("Sourdough baked daily in Austin.");
    expect(c.textContent).not.toContain("Use these colours");
  });

  it("an Editor sees the step read-only: no pickers", async () => {
    load({ role: "editor", media: [mediaRow("h1", "hero", "Shop front")] });
    const { container: c } = await openLook();
    expect(c.querySelector("#field-hero-input")).toBeNull();
    expect(c.querySelector("#field-gallery-input")).toBeNull();
    expect(c.querySelector("#field-moodboard-upload-input")).toBeNull();
    expect(c.querySelector<HTMLInputElement>("#alt-h1")?.disabled).toBe(true);
  });
});
