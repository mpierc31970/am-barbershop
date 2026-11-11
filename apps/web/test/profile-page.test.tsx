// @vitest-environment jsdom
// Your profile and alerts (11-24; DASH-36, DASH-34, DASH-37; 11-UI-SPEC "Profile"; T-11-24-01,
// T-11-24-02). The real page over a mocked session and @cds/db; the real profile actions over
// the same mocks (runAction re-derives the session).
import { ToastRegion } from "@cds/ui/hub";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../../packages/ui/src/test-support/dom";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/profile",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ROLES = {
  owner: { orgId: "org1", actor: "u1", role: "owner", grants: [] },
  admin: { orgId: "org1", actor: "u2", role: "admin", grants: [] },
  editor: { orgId: "org1", actor: "u3", role: "editor", grants: [] },
  viewer: { orgId: "org1", actor: "u4", role: "viewer", grants: [] },
  impersonating: {
    orgId: "org1",
    actor: "u1",
    role: "owner",
    grants: [],
    impersonator: "s1",
  },
} as const;
type RoleKey = keyof typeof ROLES;

const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  activeAddons: vi.fn(),
  pausedAddons: vi.fn(),
  readMemberPrefs: vi.fn(),
  listMyDevices: vi.fn(),
  readAlertProfileFacts: vi.fn(),
  pushPublicKey: vi.fn(),
  setAlertChannel: vi.fn(),
  resetAlertChannels: vi.fn(),
  updateMemberPrefs: vi.fn(),
  resetTours: vi.fn(),
  removePushSubscription: vi.fn(),
  savePushSubscription: vi.fn(),
  validatePushSubscription: vi.fn(),
  markSeen: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const { default: ProfilePage } =
  await import("../app/(platform)/hub/profile/page");
const { default: ProfileLoading } =
  await import("../app/(platform)/hub/profile/loading");
const actions = await import("../app/actions/profile");

const IMPERSONATING =
  "You're viewing as support staff, so alert settings are turned off. Only the person can change their own alerts.";

function prefs() {
  return {
    todayLayout: { order: [], hidden: [] },
    toursSeen: ["today"],
    alertChannels: { "form.message": { email: false } },
    quietHours: { on: true, from: "21:00", until: "07:00" },
    dismissed: [],
    seenFlags: [],
  };
}

function useRole(key: RoleKey) {
  const session = {
    ctx: ROLES[key],
    email: "maria@riverabakery.com",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
    orgs: [],
    staleOrg: false,
  };
  sess.requireHubSession.mockResolvedValue(session);
  sess.getHubSession.mockResolvedValue(session);
}

let mounted: Mounted | null = null;
async function render(): Promise<HTMLElement> {
  const el = (await ProfilePage()) as ReactElement;
  mounted = mount(<ToastRegion>{el}</ToastRegion>);
  return mounted.container;
}

function rowTypes(c: HTMLElement): string[] {
  return Array.from(c.querySelectorAll("table tr[data-alert-type]")).map(
    (r) => r.getAttribute("data-alert-type") ?? "",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useRole("owner");
  sess.agreementBlocks.mockResolvedValue(false);
  db.activeAddons.mockResolvedValue([]);
  db.pausedAddons.mockResolvedValue([]);
  db.readMemberPrefs.mockResolvedValue(prefs());
  db.listMyDevices.mockResolvedValue([
    {
      id: "aaaaaaaaaaaaaa1",
      uaFamily: "iphone",
      createdAt: "2026-10-09 15:00:00.000Z",
      lastOkAt: "",
      failCount: 0,
    },
  ]);
  db.readAlertProfileFacts.mockResolvedValue({
    sensitiveSetting: "",
    sensitiveOn: false,
    timeZone: "America/Chicago",
  });
  db.pushPublicKey.mockReturnValue(null);
  db.setAlertChannel.mockResolvedValue(prefs());
  db.resetAlertChannels.mockResolvedValue(prefs());
  db.updateMemberPrefs.mockResolvedValue(prefs());
  db.resetTours.mockResolvedValue(prefs());
  db.removePushSubscription.mockResolvedValue(undefined);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("/hub/profile", () => {
  it("Owner: H1, sections in UI-SPEC order, every core type, saved choices", async () => {
    const c = await render();
    expect(c.querySelector("h1")?.textContent).toBe("Your profile and alerts");
    expect(
      Array.from(c.querySelectorAll("h2")).map((h) => h.textContent),
    ).toEqual([
      "You",
      "Alerts",
      "Quiet hours",
      "Phones and computers",
      "Tours",
    ]);
    expect(c.textContent).toContain("maria@riverabakery.com");
    expect(c.textContent).toContain("Your role at Rivera Bakery · Owner");
    expect(c.textContent).toContain(
      "To change your sign-in email, ask the shop owner.",
    );
    expect(rowTypes(c)).toEqual(
      expect.arrayContaining([
        "billing.card_failed",
        "payments.payouts_paused",
        "form.message",
        "reports.monthly",
      ]),
    );
    const email = c.querySelector<HTMLInputElement>(
      'tr[data-alert-type="form.message"] input[id$="-email"]',
    )!;
    expect(email.checked).toBe(false);
    expect(c.querySelector("#alerts")).not.toBeNull();
    expect(c.textContent).toContain(
      "Times are in Central Time, your business's time zone.",
    );
    expect(c.textContent).toContain("iPhone · turned on 9 Oct");
    expect(c.textContent).not.toContain("Sensitive-practice mode");
  });

  it("Editor: no billing or payouts rows, no form messages (D285)", async () => {
    useRole("editor");
    const c = await render();
    const types = rowTypes(c);
    expect(types).not.toContain("billing.card_failed");
    expect(types).not.toContain("payments.payouts_paused");
    expect(types).not.toContain("data_export.ready");
    expect(types).not.toContain("form.message");
    expect(types).toContain("site.stage");
  });

  it("Admin: payouts paused is the Owner's (11-24)", async () => {
    useRole("admin");
    const c = await render();
    expect(rowTypes(c)).not.toContain("payments.payouts_paused");
    expect(rowTypes(c)).toContain("form.message");
  });

  it("Viewer: only Summary rows", async () => {
    useRole("viewer");
    const c = await render();
    expect(rowTypes(c)).toEqual(["reports.monthly"]);
    expect(
      Array.from(c.querySelectorAll("table tbody")).map((b) =>
        b.getAttribute("data-level"),
      ),
    ).toEqual(["summary"]);
  });

  it("SENSITIVE-ON when the site's sensitive-practice mode is on", async () => {
    db.readAlertProfileFacts.mockResolvedValue({
      sensitiveSetting: "",
      sensitiveOn: true,
      timeZone: "America/New_York",
    });
    const c = await render();
    expect(c.textContent).toContain(
      "Sensitive-practice mode is on for Rivera Bakery, so phone and email alerts never show a client's name or service.",
    );
    expect(c.textContent).toContain("Times are in Eastern Time");
  });

  it("impersonating staff: the IMPERSONATING line and every control off", async () => {
    useRole("impersonating");
    const c = await render();
    expect(c.textContent).toContain(IMPERSONATING);
    const switches = Array.from(
      c.querySelectorAll<HTMLInputElement>('input[role="switch"]'),
    );
    expect(switches.length).toBeGreaterThan(0);
    expect(switches.every((s) => s.disabled)).toBe(true);
    expect(db.pushPublicKey).not.toHaveBeenCalled();
  });

  it("a failed facts or devices read still renders the page", async () => {
    db.readAlertProfileFacts.mockRejectedValue(new Error("down"));
    db.listMyDevices.mockRejectedValue(new Error("down"));
    const c = await render();
    expect(c.textContent).toContain("No phones or computers get alerts yet.");
    expect(c.textContent).toContain("Central Time");
  });

  it("loading: the H1 and skeletons", () => {
    mounted = mount(<ProfileLoading />);
    expect(mounted.container.querySelector("h1")?.textContent).toBe(
      "Your profile and alerts",
    );
    expect(
      mounted.container.querySelector('[aria-busy="true"]'),
    ).not.toBeNull();
  });
});

describe("profile actions", () => {
  it("setAlertChannelAction saves an eligible type for the session's person", async () => {
    const res = await actions.setAlertChannelAction(
      "form.message",
      "email",
      false,
    );
    expect(res.ok).toBe(true);
    expect(db.setAlertChannel).toHaveBeenCalledWith(
      ROLES.owner,
      "form.message",
      "email",
      false,
    );
  });

  it("refuses types the person's access does not cover, and phone for Summary types", async () => {
    useRole("editor");
    const billing = await actions.setAlertChannelAction(
      "billing.card_failed",
      "email",
      false,
    );
    expect(billing.ok).toBe(false);
    expect(!billing.ok && billing.code).toBe("invalid_input");
    useRole("owner");
    const push = await actions.setAlertChannelAction(
      "contact.new",
      "push",
      true,
    );
    expect(push.ok).toBe(false);
    const bell = await actions.setAlertChannelAction(
      "form.message",
      "bell",
      false,
    );
    expect(bell.ok).toBe(false);
    expect(db.setAlertChannel).not.toHaveBeenCalled();
  });

  it("every action refuses impersonation with the IMPERSONATING copy", async () => {
    useRole("impersonating");
    const results = await Promise.all([
      actions.setAlertChannelAction("form.message", "email", false),
      actions.resetAlertChannelsAction(),
      actions.restoreAlertChannelsAction({}),
      actions.setQuietHoursAction({ on: false, from: "21:00", until: "07:00" }),
      actions.removeDeviceAction("aaaaaaaaaaaaaa1"),
      actions.resetToursAction(),
    ]);
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(!r.ok && r.message).toBe(IMPERSONATING);
    }
    expect(db.setAlertChannel).not.toHaveBeenCalled();
    expect(db.updateMemberPrefs).not.toHaveBeenCalled();
    expect(db.resetTours).not.toHaveBeenCalled();
    expect(db.removePushSubscription).not.toHaveBeenCalled();
  });

  it("reset returns the previous map; restore keeps eligible types only", async () => {
    const reset = await actions.resetAlertChannelsAction();
    expect(reset.ok && reset.data.previous).toEqual({
      "form.message": { email: false },
    });
    useRole("editor");
    await actions.restoreAlertChannelsAction({
      "form.message": { email: false },
      "site.stage": { push: false, email: "no" },
      "billing.card_failed": { email: false },
    });
    expect(db.updateMemberPrefs).toHaveBeenCalledWith(ROLES.editor, {
      alertChannels: { "site.stage": { push: false } },
    });
  });

  it("quiet hours: 30-minute steps only", async () => {
    const badStep = await actions.setQuietHoursAction({
      on: true,
      from: "21:15",
      until: "07:00",
    });
    expect(badStep.ok).toBe(false);
    const good = await actions.setQuietHoursAction({
      on: true,
      from: "22:30",
      until: "06:00",
    });
    expect(good.ok).toBe(true);
    expect(db.updateMemberPrefs).toHaveBeenCalledWith(ROLES.owner, {
      quietHours: { on: true, from: "22:30", until: "06:00" },
    });
  });

  it("Show the tours again resets tours_seen; Turn off removes one device", async () => {
    expect((await actions.resetToursAction()).ok).toBe(true);
    expect(db.resetTours).toHaveBeenCalledWith(ROLES.owner);
    expect((await actions.removeDeviceAction("aaaaaaaaaaaaaa1")).ok).toBe(true);
    expect(db.removePushSubscription).toHaveBeenCalledWith(
      ROLES.owner,
      "aaaaaaaaaaaaaa1",
    );
    expect((await actions.removeDeviceAction("../x")).ok).toBe(false);
  });
});
