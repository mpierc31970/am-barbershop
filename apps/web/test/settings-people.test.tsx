// @vitest-environment jsdom
// 11-39 Task 2: Settings › People & roles (/hub/settings?tab=people; DASH-22, DASH-25,
// DASH-27; D285; T-11-39-01, T-11-39-02). The real settings page and the real people actions
// run over a mocked session and @cds/db; client islands render in jsdom inside ToastRegion.
import { ToastRegion } from "@cds/ui/hub";
import type { ReactElement, ReactNode } from "react";
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
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/settings",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
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
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(async () => false),
}));
vi.mock("../lib/session", () => sess);

class InviteExists extends Error {
  readonly code = "invite_exists";
}

const db = vi.hoisted(() => ({
  getOrgStage: vi.fn(),
  getBusinessProfile: vi.fn(),
  listMedia: vi.fn(),
  listTeam: vi.fn(),
  listEmailRoutes: vi.fn(),
  mailDomain: vi.fn(() => "send.example.com"),
  activeAddons: vi.fn(async () => [] as string[]),
  listAgreementDocuments: vi.fn(),
  agreementStatus: vi.fn(),
  sitePolicyState: vi.fn(),
  billingTabCounts: vi.fn(),
  readConnectStatus: vi.fn(),
  paymentsMode: vi.fn(() => "fake"),
  readAlertProfileFacts: vi.fn(),
  // 11-39
  listPeople: vi.fn(),
  listInvites: vi.fn(),
  statsTimeZone: vi.fn(async () => "America/Chicago"),
  inviteMember: vi.fn(),
  resendInvite: vi.fn(),
  revokeInvite: vi.fn(),
  changeMemberRole: vi.fn(),
  setMemberGrants: vi.fn(),
  removePerson: vi.fn(),
}));
vi.mock("@cds/db", () => ({ ...db, InviteExists }));
vi.mock("@cds/addon-registry", () => ({
  ADDON_REGISTRY: {
    list: () => [
      { slug: "testimonials", name: "Testimonials" },
      { slug: "credentials", name: "Credentials" },
    ],
  },
}));
vi.mock("../app/actions/intake", () => ({
  saveProfileAction: vi.fn(),
}));
vi.mock("../app/actions/core-lists", () => ({}));
vi.mock("../app/actions/media", () => ({}));
vi.mock("../app/actions/email-routes", () => ({}));
vi.mock("../app/actions/site-settings", () => ({
  saveSiteSettingsAction: vi.fn(),
  setSensitivePracticeAction: vi.fn(),
}));
vi.mock("../app/actions/site-policies", () => ({
  publishSitePoliciesAction: vi.fn(),
  previewSitePolicyAction: vi.fn(),
}));
vi.mock("../app/actions/connect", () => ({
  startConnectAction: vi.fn(),
  checkConnectAction: vi.fn(),
}));
vi.mock("../app/actions/billing", () => ({}));
vi.mock("../app/actions/data-download", () => ({}));

const { SETTINGS_TABS, resolveSettingsTab } =
  await import("../app/(platform)/hub/settings/tabs");
const { default: SettingsPage } =
  await import("../app/(platform)/hub/settings/page");
const { HUB_SECTIONS } = await import("../app/(platform)/hub/sections");
const actions = await import("../app/actions/people");
const { dayMonth } = await import("../lib/people-view");

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
  document.body.innerHTML = "";
});

const PEOPLE = [
  {
    membershipId: "m00000000000001",
    userId: "u1",
    name: "Maria Lopez",
    email: "maria@example.com",
    role: "owner",
    addonGrants: [],
    isYou: true,
  },
  {
    membershipId: "m00000000000002",
    userId: "u2",
    name: "Sam Lee",
    email: "sam@example.com",
    role: "editor",
    addonGrants: ["testimonials"],
    isYou: false,
  },
];
const INVITES = [
  {
    id: "i00000000000001",
    email: "kim@example.com",
    role: "viewer",
    grants: [],
    expiresAt: "2026-10-16 15:00:00.000Z",
    expired: false,
    created: "2026-10-09 15:00:00.000Z",
  },
];

function session(role: string, impersonator?: string) {
  const s = {
    ctx: { ...CTX, role, ...(impersonator ? { impersonator } : {}) },
    email: "a@b.c",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  };
  sess.requireHubSession.mockResolvedValue(s);
  sess.getHubSession.mockResolvedValue(s);
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  cache.revalidatePath.mockReset();
  sess.agreementBlocks.mockResolvedValue(false);
  db.mailDomain.mockImplementation(() => "send.example.com");
  db.paymentsMode.mockImplementation(() => "fake");
  db.activeAddons.mockResolvedValue(["testimonials"]);
  db.statsTimeZone.mockResolvedValue("America/Chicago");
  db.listEmailRoutes.mockResolvedValue([]);
  db.billingTabCounts.mockResolvedValue({ payments: 0, billing: 0 });
  db.agreementStatus.mockResolvedValue({
    state: "signed",
    missing: [],
    consentCurrent: true,
    lastSignedAt: null,
    lastSignerName: null,
  });
  db.sitePolicyState.mockResolvedValue({
    templateUpdateWaiting: false,
    addedSinceReview: [],
  });
  db.getBusinessProfile.mockResolvedValue({ orgName: "Rivera Bakery" });
  db.listPeople.mockResolvedValue(PEOPLE);
  db.listInvites.mockResolvedValue(INVITES);
});

async function openPeople(): Promise<HTMLElement> {
  const el = (await SettingsPage({
    searchParams: Promise.resolve({ tab: "people" }),
  })) as ReactElement;
  mounted = mount(<ToastRegion>{el}</ToastRegion>);
  return mounted.container;
}

function tabTexts(c: ParentNode): string[] {
  const nav = c.querySelector('nav[aria-label="Settings sections"]')!;
  return Array.from(nav.querySelectorAll("a")).map((a) => a.textContent ?? "");
}

describe("People & roles tab (one source, DASH-25)", () => {
  it("sits between Email (then Domain, 14-31) and Payments in SETTINGS_TABS", () => {
    const ids = SETTINGS_TABS.map((t) => t.id);
    expect(ids.indexOf("domain")).toBe(ids.indexOf("email") + 1);
    expect(ids.indexOf("people")).toBe(ids.indexOf("domain") + 1);
    expect(ids.indexOf("payments")).toBe(ids.indexOf("people") + 1);
    expect(resolveSettingsTab("people")).toBe("people");
  });

  it("HUB_SECTIONS: Owner and Admin get the tab, an Editor does not", () => {
    const reg = { list: () => [] } as never;
    const tabs = (role: string) =>
      HUB_SECTIONS.settings
        .tabs({ role, grants: [], registry: reg, active: [] } as never)
        .map((t) => t.id);
    expect(tabs("owner")).toEqual(
      SETTINGS_TABS.map((t) => t.id).filter(
        (id) => id !== "payments" && id !== "billing",
      ),
    );
    expect(tabs("admin")).toContain("people");
    expect(tabs("editor")).not.toContain("people");
  });
});

describe("/hub/settings?tab=people", () => {
  it("Owner: people, invite row, Invite someone and row menus", async () => {
    session("owner");
    const c = await openPeople();
    expect(tabTexts(c)).toContain("People & roles");
    const panel = c.querySelector("[data-people-panel]")!;
    expect(panel.textContent).toContain("People who can use this hub");
    expect(panel.textContent).toContain("Maria Lopez");
    expect(panel.textContent).toContain("Testimonials");
    expect(panel.textContent).toContain("Invited · sent 9 Oct");
    expect(button(panel, "Invite someone")).not.toBeNull();
    expect(button(panel, "More actions for Sam Lee")).not.toBeNull();
    expect(button(panel, "More actions for Maria Lopez")).toBeNull();
  });

  it("Admin: read only with the owner-only note", async () => {
    session("admin");
    const c = await openPeople();
    const panel = c.querySelector("[data-people-panel]")!;
    expect(panel.textContent).toContain(
      "Only the site owner can invite people or change roles.",
    );
    expect(panel.querySelectorAll("button")).toHaveLength(0);
  });

  it("impersonating staff: read only with IMPERSONATING-PEOPLE", async () => {
    session("owner", "staff1");
    const c = await openPeople();
    const panel = c.querySelector("[data-people-panel]")!;
    expect(panel.textContent).toContain(
      "You're viewing as support staff, so changes to people are turned off.",
    );
    expect(button(panel, "Invite someone")).toBeNull();
  });

  it("Editor: no tab, ?tab=people falls back to Business info", async () => {
    session("editor");
    db.getOrgStage.mockResolvedValue({ stage: "", path: "standard" });
    db.listMedia.mockResolvedValue([]);
    db.readAlertProfileFacts.mockResolvedValue(null);
    db.getBusinessProfile.mockResolvedValue({
      orgName: "Rivera Bakery",
      tagline: "",
      business_type: "bakery",
      business_type_other: "",
      description: "",
      phone: "",
      public_email: "",
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
    });
    const el = (await SettingsPage({
      searchParams: Promise.resolve({ tab: "people" }),
    })) as ReactElement;
    mounted = mount(<ToastRegion>{el}</ToastRegion>);
    expect(tabTexts(mounted.container)).not.toContain("People & roles");
    expect(db.listPeople).not.toHaveBeenCalled();
  });
});

describe("people actions", () => {
  it("inviteMemberAction as Admin returns the forbidden result, no write", async () => {
    session("admin");
    const res = await actions.inviteMemberAction({
      email: "new@example.com",
      role: "editor",
      grants: [],
    });
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
    expect(db.inviteMember).not.toHaveBeenCalled();
  });

  it("impersonating staff are refused with IMPERSONATING-PEOPLE", async () => {
    session("owner", "staff1");
    const res = await actions.removePersonAction("m00000000000002");
    expect(res).toMatchObject({
      ok: false,
      message:
        "You're viewing as support staff, so changes to people are turned off.",
    });
    expect(db.removePerson).not.toHaveBeenCalled();
  });

  it("Owner invite: narrowed input, fresh lists, hub layout revalidated", async () => {
    session("owner");
    db.inviteMember.mockResolvedValue({ inviteId: "i2" });
    const res = await actions.inviteMemberAction({
      email: " new@example.com ",
      role: "viewer",
      grants: ["testimonials"],
      extra: "ignored",
    });
    expect(res.ok).toBe(true);
    expect(db.inviteMember).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org1" }),
      { email: "new@example.com", role: "viewer", grants: ["testimonials"] },
    );
    expect(cache.revalidatePath).toHaveBeenCalledWith("/hub", "layout");
    if (res.ok) expect(res.data.people).toHaveLength(2);
  });

  it("Admin role invites drop grants", async () => {
    session("owner");
    db.inviteMember.mockResolvedValue({ inviteId: "i2" });
    await actions.inviteMemberAction({
      email: "new@example.com",
      role: "admin",
      grants: ["testimonials"],
    });
    expect(db.inviteMember).toHaveBeenCalledWith(expect.anything(), {
      email: "new@example.com",
      role: "admin",
      grants: [],
    });
  });

  it("refuses bad email, owner role and inactive add-on grants before any write", async () => {
    session("owner");
    expect(
      await actions.inviteMemberAction({ email: "nope", role: "viewer" }),
    ).toMatchObject({
      ok: false,
      field: "email",
      message: "Enter an email address like name@example.com.",
    });
    expect(
      await actions.inviteMemberAction({
        email: "a@example.com",
        role: "owner",
      }),
    ).toMatchObject({ ok: false, field: "role" });
    expect(
      await actions.inviteMemberAction({
        email: "a@example.com",
        role: "viewer",
        grants: ["store"],
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(
      await actions.setGrantsAction("m00000000000002", ["store"]),
    ).toMatchObject({ ok: false });
    expect(await actions.changeRoleAction("bad id", "viewer")).toMatchObject({
      ok: false,
    });
    expect(db.inviteMember).not.toHaveBeenCalled();
    expect(db.setMemberGrants).not.toHaveBeenCalled();
    expect(db.changeMemberRole).not.toHaveBeenCalled();
  });

  it("InviteExists maps to INVITE-EXISTS on the email field", async () => {
    session("owner");
    db.inviteMember.mockRejectedValue(new InviteExists("x"));
    expect(
      await actions.inviteMemberAction({
        email: "sam@example.com",
        role: "viewer",
      }),
    ).toEqual({
      ok: false,
      code: "invite_exists",
      message: "sam@example.com already has access to this site.",
      field: "email",
    });
  });

  it("change role, grants, resend, revoke, remove call the owner-checked db functions", async () => {
    session("owner");
    const id = "m00000000000002";
    expect((await actions.changeRoleAction(id, "viewer")).ok).toBe(true);
    expect(db.changeMemberRole).toHaveBeenCalledWith(
      expect.anything(),
      id,
      "viewer",
    );
    expect((await actions.setGrantsAction(id, ["testimonials"])).ok).toBe(true);
    expect(db.setMemberGrants).toHaveBeenCalledWith(expect.anything(), id, [
      "testimonials",
    ]);
    expect((await actions.resendInviteAction("i00000000000001")).ok).toBe(true);
    expect((await actions.revokeInviteAction("i00000000000001")).ok).toBe(true);
    expect((await actions.removePersonAction(id)).ok).toBe(true);
    expect(db.removePerson).toHaveBeenCalledWith(expect.anything(), id);
  });
});

describe("dayMonth", () => {
  it("formats in the business zone with short month names", () => {
    expect(dayMonth("2026-09-09 15:00:00.000Z", "America/Chicago")).toBe(
      "9 Sep",
    );
    expect(dayMonth("2026-10-01 02:00:00.000Z", "America/Chicago")).toBe(
      "30 Sep",
    );
    expect(dayMonth("bad", "UTC")).toBe("");
  });
});
