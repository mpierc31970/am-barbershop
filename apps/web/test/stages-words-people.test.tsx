// @vitest-environment jsdom
// 06-20: Team and Services lists (06-UI-SPEC "Team, Services", "Destructive actions"; ONB-13,
// D37, D120, D257). The actions are mocked; the real sections, drawers, dialogs and the P5
// CsvImportDialog run in jsdom inside the hub ToastRegion.
import { ToastRegion } from "@cds/ui/hub";
import { act, type ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/setup/people",
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const lists = vi.hoisted(() => ({
  saveTeamMemberAction: vi.fn(),
  removeTeamMemberAction: vi.fn(),
  reorderTeamAction: vi.fn(),
  setTeamPublishedAction: vi.fn(),
  saveServiceAction: vi.fn(),
  deleteServiceAction: vi.fn(),
  reorderServicesAction: vi.fn(),
  setServicePublishedAction: vi.fn(),
  previewCoreImportAction: vi.fn(),
  commitCoreImportAction: vi.fn(),
  exportCoreCsvAction: vi.fn(),
  templateCoreCsvAction: vi.fn(),
}));
vi.mock("../app/actions/core-lists", () => lists);
const media = vi.hoisted(() => ({
  setMediaAltAction: vi.fn(),
  removeMediaAction: vi.fn(),
  restoreMediaAction: vi.fn(),
  reorderMediaAction: vi.fn(),
}));
vi.mock("../app/actions/media", () => media);

// Task 2: the real /hub/setup/[stage] page and loadStageData, over a mocked session and
// @cds/db; the setup and add-on intake actions are mocked.
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
const proof = vi.hoisted(() => ({
  saveAddonIntakeFieldsAction: vi.fn(),
  previewAddonIntakeImportAction: vi.fn(),
  commitAddonIntakeImportAction: vi.fn(),
  saveAddonIntakeRecordAction: vi.fn(),
  removeAddonIntakeRecordAction: vi.fn(),
  templateAddonIntakeCsvAction: vi.fn(),
}));
vi.mock("../app/actions/addon-intake", () => proof);

const { TeamSection } =
  await import("../app/(platform)/hub/_intake/TeamSection");
const { ServicesSection } =
  await import("../app/(platform)/hub/_intake/ServicesSection");
const { ServiceDrawer, durationOptions, DURATION_OPTIONS } =
  await import("../app/(platform)/hub/_intake/ServiceDrawer");
const { priceLine, initials, parseMoney } =
  await import("../app/(platform)/hub/_intake/list-helpers");

type Team = import("../lib/intake").TeamMemberView;
type Svc = import("../lib/intake").ServiceView;

const MARIA: Team = {
  id: "m1",
  name: "Maria Lopez",
  role: "Owner",
  bio: "",
  is_published: true,
  photo: null,
};
const ANA: Team = {
  id: "m2",
  name: "Ana Diaz",
  role: "Senior stylist",
  bio: "",
  is_published: false,
  photo: null,
};
const HAIRCUT: Svc = {
  id: "s1",
  name: "Haircut",
  description: "",
  price_display: "from",
  price_cents: 4500,
  duration_minutes: 60,
  is_published: true,
};
const CONSULT: Svc = {
  id: "s2",
  name: "Consult",
  description: "",
  price_display: "free",
  price_cents: null,
  duration_minutes: null,
  is_published: true,
};
const QUOTE: Svc = {
  id: "s3",
  name: "Wedding cake",
  description: "",
  price_display: "ask",
  price_cents: null,
  duration_minutes: null,
  is_published: false,
};

beforeAll(() => {
  // jsdom has <dialog> but not the modal API; open/close by attribute is enough here.
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
beforeEach(() => {
  for (const fn of [
    ...Object.values(lists),
    ...Object.values(media),
    ...Object.values(nav),
    ...Object.values(db),
    ...Object.values(intake),
    ...Object.values(proof),
  ]) {
    fn.mockReset();
  }
  for (const fn of [
    ...Object.values(lists),
    ...Object.values(media),
    ...Object.values(intake),
    ...Object.values(proof),
  ]) {
    fn.mockResolvedValue({ ok: true, data: null });
  }
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function show(ui: ReactNode): Mounted {
  mounted = mount(<ToastRegion>{ui}</ToastRegion>);
  return mounted;
}

function openDialog(c: ParentNode): HTMLDialogElement | null {
  return c.querySelector<HTMLDialogElement>("dialog[open]");
}

describe("list helpers", () => {
  it("price lines, initials and money parsing", () => {
    expect(priceLine(HAIRCUT)).toBe("From $45 · 60 min");
    expect(priceLine(CONSULT)).toBe("Free");
    expect(priceLine(QUOTE)).toBe("Ask for a price");
    expect(
      priceLine({
        price_display: "fixed",
        price_cents: 4550,
        duration_minutes: 30,
      }),
    ).toBe("$45.50 · 30 min");
    expect(initials("Maria Lopez")).toBe("ML");
    expect(initials("Cher")).toBe("C");
    expect(parseMoney("$45")).toBe(4500);
    expect(parseMoney("45.5")).toBe(4550);
    expect(parseMoney("1,200")).toBe(120000);
    expect(parseMoney("forty")).toBeNull();
    expect(parseMoney("0")).toBeNull();
  });
});

describe("TeamSection", () => {
  it("empty: EMPTY-TEAM copy, its primary is the one accent, no header primary", () => {
    const { container: c } = show(
      <TeamSection data={[]} readOnly={false} context="setup" />,
    );
    expect(c.querySelector("h2")?.textContent).toBe("Your team");
    expect(c.textContent).toContain("No team members yet");
    expect(c.textContent).toContain(
      "Add the people customers will meet. They can show on an Our Team section of your site.",
    );
    expect(c.textContent).toContain(
      "Just you? Add yourself, or leave this empty and your site won't show a team section.",
    );
    const adds = Array.from(c.querySelectorAll("button")).filter(
      (b) => b.textContent?.trim() === "Add a team member",
    );
    expect(adds).toHaveLength(1);
    expect(button(c, "Import from a spreadsheet")).not.toBeNull();
  });

  it("rows: initials, name over role, Hidden badge, header primary once not empty", () => {
    const { container: c } = show(
      <TeamSection data={[MARIA, ANA]} readOnly={false} context="settings" />,
    );
    expect(c.querySelector("h2")?.textContent).toBe("Team");
    expect(c.textContent).toContain("2 team members · 1 shown on your site");
    expect(c.textContent).toContain("ML");
    expect(c.textContent).toContain("Senior stylist");
    expect(c.textContent).toContain("Hidden");
    expect(button(c, "Add a team member")).not.toBeNull();
  });

  it("Show on site calls setTeamPublishedAction and snaps back on failure", async () => {
    lists.setTeamPublishedAction.mockResolvedValue({
      ok: false,
      code: "save_failed",
      message: "x",
    });
    const { container: c } = show(
      <TeamSection data={[MARIA]} readOnly={false} context="setup" />,
    );
    const sw = c.querySelector<HTMLInputElement>(
      'input[aria-label="Show Maria Lopez on site"]',
    )!;
    expect(sw.checked).toBe(true);
    click(sw);
    await flush();
    expect(lists.setTeamPublishedAction).toHaveBeenCalledWith("m1", false);
    expect(sw.checked).toBe(true);
    expect(document.body.textContent).toContain(
      "That change didn't save. Try again.",
    );
  });

  it("13-52 (D270): a held Show on site toasts the records held copy and stays off", async () => {
    lists.setTeamPublishedAction.mockResolvedValue({
      ok: true,
      data: { ...MARIA, is_published: false, held: true },
    });
    const { container: c } = show(
      <TeamSection
        data={[{ ...MARIA, is_published: false }]}
        readOnly={false}
        context="setup"
      />,
    );
    const sw = c.querySelector<HTMLInputElement>(
      'input[aria-label="Show Maria Lopez on site"]',
    )!;
    click(sw);
    await flush();
    expect(lists.setTeamPublishedAction).toHaveBeenCalledWith("m1", true);
    expect(sw.checked).toBe(false);
    expect(document.body.textContent).toContain(
      "Saved. It shows on your site once it's reviewed, usually within 2 business days.",
    );
  });

  it("13-52 (D270): a held drawer save toasts the held copy, not Team member saved", async () => {
    lists.saveTeamMemberAction.mockResolvedValue({
      ok: true,
      data: {
        id: "m9",
        name: "Luis Ortega",
        role: "",
        bio: "",
        is_published: false,
        sortOrder: 1,
        photoId: null,
        held: true,
      },
    });
    const { container: c } = show(
      <TeamSection data={[]} readOnly={false} context="setup" />,
    );
    click(button(c, "Add a team member"));
    const drawer = document.body.querySelector("dialog[open]")!;
    const inputs = drawer.querySelectorAll<HTMLInputElement>(
      "input[type=text], input:not([type])",
    );
    typeInto(inputs[0]!, "Luis Ortega");
    click(button(drawer, "Save team member"));
    await flush();
    expect(document.body.textContent).toContain(
      "Saved. It shows on your site once it's reviewed, usually within 2 business days.",
    );
    expect(document.body.textContent).not.toContain("Team member saved.");
    expect(c.textContent).toContain("Hidden");
  });

  it("Remove from team asks first, Keep team member is focused, confirm removes and toasts", async () => {
    const onChanged = vi.fn();
    const { container: c } = show(
      <TeamSection
        data={[MARIA]}
        readOnly={false}
        context="setup"
        onChanged={onChanged}
      />,
    );
    click(button(c, "More actions for Maria Lopez"));
    click(button(c, "Remove from team"));
    const dlg = openDialog(c)!;
    expect(dlg.textContent).toContain("Remove Maria Lopez from your team?");
    expect(dlg.textContent).toContain(
      "They won't show on your site. This doesn't affect anyone's sign-in.",
    );
    const keep = button(dlg, "Keep team member")!;
    expect(keep.autofocus || document.activeElement === keep).toBe(true);
    click(button(dlg, "Remove from team"));
    await flush();
    expect(lists.removeTeamMemberAction).toHaveBeenCalledWith("m1");
    expect(document.body.textContent).toContain(
      "Maria Lopez removed from your team.",
    );
    expect(c.textContent).toContain("No team members yet");
    expect(onChanged).toHaveBeenCalled();
  });

  it("drawer: Name is required; Save team member sends the member and toasts", async () => {
    lists.saveTeamMemberAction.mockResolvedValue({
      ok: true,
      data: {
        id: "m9",
        name: "Luis Ortega",
        role: "Baker",
        bio: "",
        is_published: true,
        sortOrder: 1,
        photoId: null,
      },
    });
    const { container: c } = show(
      <TeamSection data={[]} readOnly={false} context="setup" />,
    );
    click(button(c, "Add a team member"));
    expect(nav.replace).toHaveBeenCalledWith(
      "/hub/setup/people?record=team-new",
      { scroll: false },
    );
    const drawer = document.body.querySelector("dialog[open]")!;
    expect(drawer.textContent).toContain("Add a team member");
    expect(drawer.textContent).toContain(
      "Leave empty and we'll show their initials.",
    );
    expect(drawer.textContent).toContain("0 / 600");
    const inputs = drawer.querySelectorAll<HTMLInputElement>(
      "input[type=text], input:not([type])",
    );
    const role = inputs[1]!;
    typeInto(role, "Baker");
    click(button(drawer, "Save team member"));
    await flush();
    expect(drawer.textContent).toContain("Add a name.");
    expect(lists.saveTeamMemberAction).not.toHaveBeenCalled();
    typeInto(inputs[0]!, "Luis Ortega");
    click(button(drawer, "Save team member"));
    await flush();
    expect(lists.saveTeamMemberAction).toHaveBeenCalledWith(
      {
        name: "Luis Ortega",
        role: "Baker",
        bio: "",
        is_published: true,
        photoId: null,
      },
      undefined,
    );
    expect(document.body.textContent).toContain("Team member saved.");
    expect(c.textContent).toContain("Luis Ortega");
  });

  it("Edit opens the drawer with the member and the team photo field", () => {
    const { container: c } = show(
      <TeamSection data={[MARIA]} readOnly={false} context="setup" />,
    );
    click(button(c, "More actions for Maria Lopez"));
    click(button(c, "Edit"));
    const drawer = document.body.querySelector("dialog[open]")!;
    expect(drawer.textContent).toContain("Edit Maria Lopez");
    expect(
      drawer.querySelector('input[type="file"]')?.getAttribute("aria-label"),
    ).toBe("Choose a photo");
    expect(
      drawer.querySelector<HTMLInputElement>("input[required]")?.value,
    ).toBe("Maria Lopez");
    // Nothing changed yet, so Save team member waits.
    expect(button(drawer, "Save team member")?.disabled).toBe(true);
  });

  it("read-only (Editor): no add, import, menus or live switches", () => {
    const { container: c } = show(
      <TeamSection data={[MARIA]} readOnly context="settings" />,
    );
    expect(button(c, "Add a team member")).toBeNull();
    expect(button(c, "Import team members")).toBeNull();
    expect(button(c, "More actions for Maria Lopez")).toBeNull();
    expect(button(c, /^Reorder /)).toBeNull(); // C-WR-05
    expect(
      c.querySelector<HTMLInputElement>('input[role="switch"]')?.disabled,
    ).toBe(true);
  });
});

describe("ServicesSection", () => {
  it("C-WR-08: a stored duration off the preset list shows as itself, in order", () => {
    expect(durationOptions("60")).toBe(DURATION_OPTIONS);
    expect(durationOptions("")).toBe(DURATION_OPTIONS);
    expect(durationOptions("50").map((o) => o.value)).toEqual([
      "",
      "15",
      "30",
      "45",
      "50",
      "60",
      "75",
      "90",
      "120",
      "varies",
    ]);
    expect(durationOptions("180").at(-2)).toEqual({
      value: "180",
      label: "180 minutes",
    });
    show(
      <ServiceDrawer
        service={{ ...HAIRCUT, duration_minutes: 50 }}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    const select = Array.from(
      document.body.querySelectorAll<HTMLSelectElement>("select"),
    ).find((el) => Array.from(el.options).some((o) => o.value === "varies"))!;
    expect(select.value).toBe("50");
    expect(select.selectedOptions[0]?.textContent).toBe("50 minutes");
  });

  it("C-WR-05: read-only (Editor) shows no drag handles or row menus", () => {
    const { container: c } = show(
      <ServicesSection data={[HAIRCUT]} readOnly context="settings" />,
    );
    expect(c.textContent).toContain(HAIRCUT.name);
    expect(button(c, /^Reorder /)).toBeNull();
    expect(button(c, `More actions for ${HAIRCUT.name}`)).toBeNull();
  });

  it("empty: EMPTY-SERVICES copy with Add your first service", () => {
    const { container: c } = show(
      <ServicesSection data={[]} readOnly={false} context="setup" />,
    );
    expect(c.textContent).toContain("No services yet");
    expect(c.textContent).toContain(
      "List what you offer and what it costs. Visitors see them on your site, and you choose which to show.",
    );
    expect(c.textContent).toContain(
      "Have a price list in Excel or on paper? Type it into our template and import it all at once.",
    );
    expect(button(c, "Add your first service")).not.toBeNull();
    expect(button(c, "Add a service")).toBeNull();
  });

  it("rows show the price lines", () => {
    const { container: c } = show(
      <ServicesSection
        data={[HAIRCUT, CONSULT, QUOTE]}
        readOnly={false}
        context="website"
      />,
    );
    expect(c.textContent).toContain("From $45 · 60 min");
    expect(c.textContent).toContain("Free");
    expect(c.textContent).toContain("Ask for a price");
    expect(c.textContent).toContain("3 services · 2 shown on your site");
  });

  it("drawer: Amount only for Fixed price and Starting at; required then", async () => {
    lists.saveServiceAction.mockResolvedValue({
      ok: true,
      data: { ...HAIRCUT, id: "s9", name: "Trim", sortOrder: 2 },
    });
    const { container: c } = show(
      <ServicesSection data={[HAIRCUT]} readOnly={false} context="setup" />,
    );
    click(button(c, "Add a service"));
    const drawer = document.body.querySelector("dialog[open]")!;
    const amount = () =>
      Array.from(drawer.querySelectorAll("label")).find(
        (l) => l.textContent === "Amount",
      );
    expect(amount()).toBeDefined();
    const radio = (v: string) =>
      drawer.querySelector<HTMLInputElement>(
        `input[type=radio][value="${v}"]`,
      )!;
    click(radio("free"));
    expect(amount()).toBeUndefined();
    click(radio("ask"));
    expect(amount()).toBeUndefined();
    click(radio("from"));
    expect(amount()).toBeDefined();
    const name = drawer.querySelector<HTMLInputElement>("input[required]")!;
    typeInto(name, "Trim");
    click(button(drawer, "Save service"));
    await flush();
    expect(drawer.textContent).toContain("Add a price, like 45 or 45.00.");
    expect(lists.saveServiceAction).not.toHaveBeenCalled();
    const amountInput = drawer.querySelector<HTMLInputElement>(
      'input[inputmode="decimal"]',
    )!;
    typeInto(amountInput, "$30");
    click(button(drawer, "Save service"));
    await flush();
    expect(lists.saveServiceAction).toHaveBeenCalledWith(
      {
        name: "Trim",
        description: "",
        price_display: "from",
        price: "$30",
        duration_minutes: null,
        is_published: true,
      },
      undefined,
    );
    expect(document.body.textContent).toContain("Service saved.");
  });

  it("13-52 (D270): a held Show on site toasts the records held copy and stays off", async () => {
    lists.setServicePublishedAction.mockResolvedValue({
      ok: true,
      data: { ...HAIRCUT, is_published: false, held: true },
    });
    const { container: c } = show(
      <ServicesSection
        data={[{ ...HAIRCUT, is_published: false }]}
        readOnly={false}
        context="setup"
      />,
    );
    const sw = c.querySelector<HTMLInputElement>(
      'input[aria-label="Show Haircut on site"]',
    )!;
    click(sw);
    await flush();
    expect(lists.setServicePublishedAction).toHaveBeenCalledWith("s1", true);
    expect(sw.checked).toBe(false);
    expect(document.body.textContent).toContain(
      "Saved. It shows on your site once it's reviewed, usually within 2 business days.",
    );
  });

  it("Delete asks 'Delete Haircut?' with Keep service focused", async () => {
    const { container: c } = show(
      <ServicesSection data={[HAIRCUT]} readOnly={false} context="setup" />,
    );
    click(button(c, "More actions for Haircut"));
    click(button(c, "Delete service"));
    const dlg = openDialog(c)!;
    expect(dlg.textContent).toContain("Delete Haircut?");
    expect(dlg.textContent).toContain(
      "It disappears from your site right away. To keep it but stop showing it, turn off Show on site instead.",
    );
    expect(button(dlg, "Keep service")).not.toBeNull();
    click(button(dlg, "Delete service"));
    await flush();
    expect(lists.deleteServiceAction).toHaveBeenCalledWith("s1");
    expect(document.body.textContent).toContain("Service deleted.");
  });

  it("Import opens the P5 dialog wired to the core import actions", async () => {
    lists.previewCoreImportAction.mockResolvedValue({
      ok: false,
      code: "invalid_input",
      message: "That file has no rows.",
    });
    const { container: c } = show(
      <ServicesSection data={[]} readOnly={false} context="setup" />,
    );
    click(button(c, "Import from a spreadsheet"));
    const dlg = openDialog(c)!;
    expect(dlg.textContent).toContain("Import services");
    const input = dlg.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["Name\nTrim\n"], "services.csv", {
      type: "text/csv",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve("Name\nTrim\n"),
    });
    await act(async () => {
      Object.defineProperty(input, "files", { value: [file] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(lists.previewCoreImportAction).toHaveBeenCalledWith(
      "services",
      "Name\nTrim\n",
      "update",
    );
  });

  it("Export CSV downloads the chokepoint's file", async () => {
    lists.exportCoreCsvAction.mockResolvedValue({
      ok: true,
      data: { filename: "services.csv", csv: "id,Name\n" },
    });
    const urls = {
      create: vi.fn(() => "blob:x"),
      revoke: vi.fn(),
    };
    const orig = { c: URL.createObjectURL, r: URL.revokeObjectURL };
    URL.createObjectURL = urls.create;
    URL.revokeObjectURL = urls.revoke;
    try {
      const { container: c } = show(
        <ServicesSection data={[HAIRCUT]} readOnly={false} context="website" />,
      );
      click(button(c, "More actions for Services"));
      click(button(c, "Export CSV"));
      await flush();
      expect(lists.exportCoreCsvAction).toHaveBeenCalledWith("services");
      expect(urls.create).toHaveBeenCalled();
      expect(document.body.textContent).toContain("Exported 1 service.");
    } finally {
      URL.createObjectURL = orig.c;
      URL.revokeObjectURL = orig.r;
    }
  });
});

// ---------------------------------------------------------------------------------------
// Task 2: steps "Your words & services" and "People & proof"

const { default: StagePage } =
  await import("../app/(platform)/hub/setup/[stage]/page");
const { STAGE_FORMS } =
  await import("../app/(platform)/hub/setup/[stage]/stage-forms");

const TESTIMONIAL = {
  quote: "Best bread in town.",
  author_name: "Maria L.",
  author_detail: "",
  rating: 5,
  photo_url: "",
  photo_alt: "",
  featured: false,
  is_published: true,
  source: "import",
};

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

function load(
  opts: {
    role?: string;
    addons?: string[];
    held?: Record<string, unknown>[];
    team?: unknown[];
    services?: unknown[];
    prof?: Record<string, unknown>;
  } = {},
) {
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
  const selections = {
    addons: opts.addons ?? [],
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
  db.getIntakeSnapshot.mockResolvedValue({
    orgName,
    path: "standard",
    profile: values,
    answers,
    counts: { services: 0, team: 0, gallery: 0, moodboard: 0 },
    media: { logo: false, hero: false, photosMissingAlt: 0 },
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
    addonConfig: opts.held
      ? {
          testimonials: {
            fields: {},
            records: opts.held,
            keys: opts.held.map((_, i) => `key${i}`),
          },
        }
      : {},
    moodboardProposal: null,
  });
  db.listMedia.mockResolvedValue([]);
  db.listTeam.mockResolvedValue(opts.team ?? []);
  db.listServices.mockResolvedValue(opts.services ?? []);
}

async function openStage(stage: string): Promise<Mounted> {
  const el = await StagePage({ params: Promise.resolve({ stage }) });
  return show(el);
}

function blur(el: Element | null) {
  if (!el) throw new Error("blur: not found");
  act(() => {
    (el as HTMLElement).focus();
    (el as HTMLElement).blur();
  });
}

describe("STAGE_FORMS", () => {
  it("registers words and people", () => {
    expect(STAGE_FORMS.words).toBeTypeOf("function");
    expect(STAGE_FORMS.people).toBeTypeOf("function");
  });
});

describe("4 · Your words & services", () => {
  it("About (8 rows, 0 / 2,000, Optional, fallback), Mission, Headline and the Services list", async () => {
    load();
    const { container: c } = await openStage("words");
    const about = c.querySelector<HTMLTextAreaElement>("#field-about")!;
    expect(about.rows).toBe(8);
    expect(c.textContent).toContain("0 / 2,000");
    expect(c.textContent).toContain("Optional");
    expect(c.textContent).toContain(
      "Leave empty and we'll start from your business type and town.",
    );
    expect(c.querySelector("#field-mission")).not.toBeNull();
    expect(c.querySelector('label[for="field-headline"]')?.textContent).toBe(
      "The first line visitors should read",
    );
    expect(c.textContent).toContain(
      "Like 'Real bread, baked before sunrise.' Leave empty and Support writes one for you.",
    );
    expect(c.textContent).toContain("No services yet");
    expect(db.listServices).toHaveBeenCalled();
    expect(db.listTeam).not.toHaveBeenCalled();
  });

  it("each text saves on blur through saveProfileAction('words', …)", async () => {
    load();
    const { container: c } = await openStage("words");
    const about = c.querySelector("#field-about");
    typeInto(about, "We bake before sunrise.");
    blur(about);
    const headline = c.querySelector("#field-headline");
    typeInto(headline, "Real bread.");
    blur(headline);
    await flush();
    const calls = intake.saveProfileAction.mock.calls
      .filter((x) => x[0] === "words")
      .map((x) => x[1]);
    expect(calls).toContainEqual({ about: "We bake before sunrise." });
    expect(calls).toContainEqual({ headline: "Real bread." });
  });

  it("the loaded services render with their price lines", async () => {
    load({
      services: [
        {
          id: "s1",
          name: "Haircut",
          description: "",
          price_display: "fixed",
          price_cents: 4500,
          duration_minutes: 60,
          is_published: true,
          sortOrder: 0,
        },
      ],
    });
    const { container: c } = await openStage("words");
    expect(c.textContent).toContain("Haircut");
    expect(c.textContent).toContain("$45 · 60 min");
  });
});

describe("5 · People & proof", () => {
  it("shows the team (loaded for this step) with its setup heading", async () => {
    load({
      team: [
        {
          id: "m1",
          name: "Maria Lopez",
          role: "Owner",
          bio: "",
          is_published: true,
          sortOrder: 0,
          photoId: null,
        },
      ],
    });
    const { container: c } = await openStage("people");
    expect(db.listTeam).toHaveBeenCalled();
    expect(c.textContent).toContain("Your team");
    expect(c.textContent).toContain("Maria Lopez");
    expect(c.textContent).toContain("ML");
  });

  it("a picked proof add-on gets its section: import, add one by one, and the count line", async () => {
    load({
      addons: ["testimonials"],
      held: Array.from({ length: 12 }, (_, i) => ({
        ...TESTIMONIAL,
        author_name: `Customer ${i + 1}`,
      })),
    });
    const { container: c } = await openStage("people");
    expect(c.textContent).toContain("Your add-ons");
    expect(
      Array.from(c.querySelectorAll("h3")).map((h) => h.textContent),
    ).toContain("Testimonials");
    expect(button(c, "Paste or import your testimonials")).not.toBeNull();
    expect(button(c, "Add one by one")).not.toBeNull();
    expect(c.textContent).toContain("12 testimonials ready for your site");
    expect(c.textContent).toContain("Customer 12");
    // Not picked: Credentials is offered as a link, Testimonials is not.
    expect(c.textContent).not.toContain("Add Testimonials");
  });

  it("an unpicked proof add-on shows one line linking to its add-on page", async () => {
    load();
    const { container: c } = await openStage("people");
    expect(c.textContent).toContain(
      "Have reviews from customers? Add Testimonials to show them.",
    );
    const link = Array.from(c.querySelectorAll("a")).find(
      (a) => a.textContent === "Add Testimonials",
    );
    expect(link?.getAttribute("href")).toBe("/hub/add-ons/testimonials");
    expect(button(c, "Paste or import your testimonials")).toBeNull();
  });

  it("Add one by one: the add-on's columns as fields; save goes to intake and counts", async () => {
    proof.saveAddonIntakeRecordAction.mockResolvedValue({
      ok: true,
      data: { count: 1, key: "new1" },
    });
    load({ addons: ["testimonials"] });
    const { container: c } = await openStage("people");
    expect(c.textContent).not.toContain("ready for your site");
    click(button(c, "Add one by one"));
    const drawer = document.body.querySelector("dialog[open]")!;
    expect(drawer.textContent).toContain("New testimonial");
    const labels = Array.from(drawer.querySelectorAll("label")).map(
      (l) => l.textContent,
    );
    expect(labels).toEqual(expect.arrayContaining(["Quote", "Name", "Rating"]));
    click(button(drawer, "Save testimonial"));
    await flush();
    expect(drawer.textContent).toContain("Add the quote.");
    expect(proof.saveAddonIntakeRecordAction).not.toHaveBeenCalled();
    const byLabel = (text: string) => {
      const l = Array.from(drawer.querySelectorAll("label")).find(
        (x) => x.textContent === text,
      )!;
      return drawer.ownerDocument.getElementById(l.htmlFor);
    };
    typeInto(byLabel("Quote"), "Best bread in town.");
    typeInto(byLabel("Name"), "Maria L.");
    typeInto(byLabel("Rating"), "5");
    click(button(drawer, "Save testimonial"));
    await flush();
    const [slug, values, key] =
      proof.saveAddonIntakeRecordAction.mock.calls[0]!;
    expect(slug).toBe("testimonials");
    expect(values).toMatchObject({
      quote: "Best bread in town.",
      author_name: "Maria L.",
      rating: "5",
    });
    expect(key).toBeUndefined();
    expect(document.body.textContent).toContain("Testimonial saved.");
    expect(c.textContent).toContain("1 testimonial ready for your site");
    expect(intake.markStageSavedAction).toHaveBeenCalledWith("people");
  });

  it("Paste or import opens the P5 dialog in intake mode", async () => {
    proof.previewAddonIntakeImportAction.mockResolvedValue({
      ok: false,
      code: "invalid_input",
      message: "That file has no rows.",
    });
    load({ addons: ["testimonials"] });
    const { container: c } = await openStage("people");
    click(button(c, "Paste or import your testimonials"));
    const dlg = openDialog(c)!;
    expect(dlg.textContent).toContain("Import testimonials");
    const input = dlg.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["Quote,Name\nHi,Ana\n"], "t.csv", {
      type: "text/csv",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve("Quote,Name\nHi,Ana\n"),
    });
    await act(async () => {
      Object.defineProperty(input, "files", { value: [file] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(proof.previewAddonIntakeImportAction).toHaveBeenCalledWith(
      "testimonials",
      "Quote,Name\nHi,Ana\n",
      "update",
    );
  });

  it("Remove takes a held row off at once by its key; Undo puts it back in place", async () => {
    proof.removeAddonIntakeRecordAction.mockResolvedValue({
      ok: true,
      data: { count: 1, index: 0 },
    });
    proof.saveAddonIntakeRecordAction.mockResolvedValue({
      ok: true,
      data: { count: 2, key: "back1" },
    });
    load({
      addons: ["testimonials"],
      held: [TESTIMONIAL, { ...TESTIMONIAL, author_name: "Ana D." }],
    });
    const { container: c } = await openStage("people");
    click(button(c, "Remove Maria L."));
    await flush();
    expect(proof.removeAddonIntakeRecordAction).toHaveBeenCalledWith(
      "testimonials",
      "key0",
    );
    expect(c.textContent).toContain("1 testimonial ready for your site");
    expect(document.body.textContent).toContain("Testimonial removed.");
    click(button(document.body, "Undo"));
    await flush();
    const call = proof.saveAddonIntakeRecordAction.mock.calls[0]!;
    expect(call[0]).toBe("testimonials");
    expect(call.slice(2)).toEqual([undefined, 0]);
    const names = Array.from(
      c.querySelectorAll('ul[aria-label="Your testimonials"] li span.truncate'),
    ).map((s) => s.textContent);
    expect(names[0]).toContain("Maria L.");
    expect(names[1]).toContain("Ana D.");
  });

  it("B-WR-08: Edit saves the row by its key, not its position", async () => {
    proof.saveAddonIntakeRecordAction.mockResolvedValue({
      ok: true,
      data: { count: 2, key: "key1" },
    });
    load({
      addons: ["testimonials"],
      held: [TESTIMONIAL, { ...TESTIMONIAL, author_name: "Ana D." }],
    });
    const { container: c } = await openStage("people");
    click(button(c, "Edit Ana D."));
    const drawer = document.body.querySelector("dialog[open]")!;
    click(button(drawer, "Save testimonial"));
    await flush();
    expect(proof.saveAddonIntakeRecordAction.mock.calls[0]![2]).toBe("key1");
  });

  it("an Editor sees the step read-only: no add, import or remove", async () => {
    load({ role: "editor", addons: ["testimonials"], held: [TESTIMONIAL] });
    const { container: c } = await openStage("people");
    expect(button(c, "Add a team member")).toBeNull();
    expect(button(c, "Paste or import your testimonials")).toBeNull();
    expect(button(c, "Add one by one")).toBeNull();
    expect(button(c, "Remove Maria L.")).toBeNull();
    expect(c.textContent).toContain("1 testimonial ready for your site");
  });
});

describe("invariant 3", () => {
  it("the add-on intake actions never reach the add-on repository", async () => {
    const { readFileSync } = await import("node:fs");
    // jsdom's import.meta.url isn't a file URL; vitest runs from the repo root.
    const src = readFileSync(
      `${process.cwd()}/apps/web/app/actions/addon-intake.ts`,
      "utf8",
    );
    expect(src).not.toMatch(/addonRepo|addons\/addon-repo/);
    expect(src).toMatch(/AddonIntake/);
  });
});
