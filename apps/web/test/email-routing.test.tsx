// @vitest-environment jsdom
// 06-22 Task 1: "Where should your email go?" (06-UI-SPEC "Email routing" items 1-6,
// validation copy, Destructive actions; ONB-09, ONB-10, D112, D173, D-UI-P6-24; T-06-102,
// T-06-103). The real routing component and step 3 run in jsdom inside the hub ToastRegion
// with the email-route actions mocked; the real actions run against a mocked session and
// @cds/db.
import { ToastRegion } from "@cds/ui/hub";
import { readFileSync } from "node:fs";
import path from "node:path";
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

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/setup/email",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const routeActions = vi.hoisted(() => ({
  addEmailRouteAction: vi.fn(),
  changeDefaultRouteAction: vi.fn(),
  resendRouteConfirmationAction: vi.fn(),
  removeEmailRouteAction: vi.fn(),
  restoreEmailRouteAction: vi.fn(),
  setNewsletterSenderAction: vi.fn(),
}));
vi.mock("../app/actions/email-routes", () => routeActions);

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
  enforceAgreementGate: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  getOrgStage: vi.fn(),
  getBusinessProfile: vi.fn(),
  getOrgIntake: vi.fn(),
  getIntakeSnapshot: vi.fn(),
  listMedia: vi.fn(),
  listEmailRoutes: vi.fn(),
  mailDomain: vi.fn(() => "send.example.com"),
  addEmailRoute: vi.fn(),
  changeDefaultRoute: vi.fn(),
  resendRouteConfirmation: vi.fn(),
  removeEmailRoute: vi.fn(),
  setNewsletterSender: vi.fn(),
}));
vi.mock("@cds/db", async () => {
  const { CdsError } = await import("@cds/core");
  class RateLimited extends CdsError {
    override readonly code = "rate_limited";
  }
  class InvalidInput extends CdsError {
    override readonly code = "invalid_input";
  }
  return {
    ...db,
    RateLimited,
    InvalidInput,
    CONFIRM_RATE_COPY:
      "We've sent several confirmation emails already. Try again later, or check that inbox.",
    ROUTE_COPY: {
      purpose: "Choose where this address should get email.",
      cooldown: "Sent. Check that inbox. You can send another in a minute.",
      senderLong: "The sender name is longer than 120 characters.",
    },
  };
});
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
vi.mock("../app/actions/media", () => ({}));

const { EmailRouting, previewSender, providerName, ROUTING_COPY } =
  await import("../app/(platform)/hub/_intake/EmailRouting");
const { PRO_EMAIL_STEPS, PRO_EMAIL_HOWTO } =
  await import("../app/(platform)/hub/_intake/professional-email-steps");
const { default: StagePage } =
  await import("../app/(platform)/hub/setup/[stage]/page");
const { STAGE_FORMS } =
  await import("../app/(platform)/hub/setup/[stage]/stage-forms");
const real = await vi.importActual<
  typeof import("../app/actions/email-routes")
>("../app/actions/email-routes");

type Route = import("../lib/intake").EmailRouteView;

let mounted: Mounted | null = null;
function show(ui: ReactNode): Mounted {
  mounted = mount(<ToastRegion>{ui}</ToastRegion>);
  return mounted;
}
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
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});
beforeEach(() => {
  for (const fn of Object.values(routeActions)) fn.mockReset();
  for (const fn of Object.values(intake)) fn.mockReset();
  for (const fn of Object.values(db)) fn.mockReset();
  db.mailDomain.mockImplementation(() => "send.example.com");
  intake.markStageSavedAction.mockResolvedValue({ ok: true, data: null });
});

const DEFAULT: Route = {
  id: "r0000000000def1",
  purpose: "default",
  address: "maria@riverabakery.com",
  senderName: "",
  status: "confirmed",
  pendingDefault: false,
};

function route(over: Partial<Route>): Route {
  return {
    id: `r${Math.random().toString(36).slice(2, 16).padEnd(14, "0")}`,
    purpose: "inquiries",
    address: "orders@riverabakery.com",
    senderName: "",
    status: "waiting",
    pendingDefault: false,
    ...over,
  };
}

function routing(
  routes: Route[] = [DEFAULT],
  opts: { readOnly?: boolean; onChanged?: () => void } = {},
) {
  return show(
    <EmailRouting
      data={{ routes, mailDomain: "send.example.com", slug: "rivera-bakery" }}
      businessName="Rivera Bakery"
      readOnly={opts.readOnly ?? false}
      onChanged={opts.onChanged}
    />,
  );
}

function submitForm(c: ParentNode, address: string, field?: string) {
  const input = field
    ? c.querySelector<HTMLInputElement>(`#${CSS.escape(field)}`)
    : c.querySelector<HTMLInputElement>('form input[type="email"]');
  typeInto(input, address);
  click(button(input!.closest("form")!, ROUTING_COPY.save));
}

function box(c: ParentNode, group: string): HTMLInputElement {
  return c.querySelector<HTMLInputElement>(
    `[data-group="${group}"] input[type="checkbox"]`,
  )!;
}

// ---------------------------------------------------------------------------------------

describe("EmailRouting: the default address", () => {
  it("heading, intro, Everything goes to with the Confirmed default and Change address; no remove", () => {
    const { container: c } = routing();
    expect(c.querySelector("h2")?.textContent).toBe(
      "Where should your email go?",
    );
    expect(c.textContent).toContain(
      "One address for everything is the simplest. You can send some messages elsewhere.",
    );
    expect(c.textContent).toContain("Everything goes to");
    const def = c.querySelector('[data-group="default"]')!;
    expect(def.textContent).toContain("maria@riverabakery.com");
    expect(def.textContent).toContain("Confirmed");
    expect(button(def, "Change address")).not.toBeNull();
    expect(button(def, /^Remove /)).toBeNull();
  });

  it("Change address opens the inline edit; a bad address shows the format copy and saves nothing", async () => {
    const { container: c } = routing();
    click(button(c, "Change address"));
    expect(c.textContent).toContain(
      "Your current address keeps getting email until you confirm the new one.",
    );
    expect(button(c, "Keep current")).not.toBeNull();
    submitForm(c, "maria@");
    await flush();
    expect(c.textContent).toContain(
      "That doesn't look like an email address. Check it and try again.",
    );
    expect(routeActions.changeDefaultRouteAction).not.toHaveBeenCalled();
    click(button(c, "Keep current"));
    expect(button(c, ROUTING_COPY.save)).toBeNull();
  });

  it("never saves on blur: only Save and send confirmation sends", async () => {
    const { container: c } = routing();
    click(button(c, "Change address"));
    const input = c.querySelector<HTMLInputElement>('form input[type="email"]');
    typeInto(input, "orders@riverabakery.com");
    act(() => {
      input!.focus();
      input!.blur();
    });
    await flush();
    expect(routeActions.changeDefaultRouteAction).not.toHaveBeenCalled();
  });

  it("Save and send confirmation: pending row Waiting for confirmation + toast; the old one still shows", async () => {
    const onChanged = vi.fn();
    routeActions.changeDefaultRouteAction.mockResolvedValue({
      ok: true,
      data: route({
        id: "r0000000000new1",
        purpose: "default",
        address: "orders@riverabakery.com",
        pendingDefault: true,
      }),
    });
    const { container: c } = routing([DEFAULT], { onChanged });
    click(button(c, "Change address"));
    submitForm(c, "Orders@RiveraBakery.com");
    await flush();
    expect(routeActions.changeDefaultRouteAction).toHaveBeenCalledWith(
      "Orders@RiveraBakery.com",
    );
    expect(document.body.textContent).toContain(
      "We sent a confirmation to orders@riverabakery.com.",
    );
    const def = c.querySelector('[data-group="default"]')!;
    expect(def.textContent).toContain("maria@riverabakery.com");
    expect(def.textContent).toContain("Waiting for confirmation");
    expect(def.textContent).toContain(
      "New address. Your current one keeps getting email until this one is confirmed.",
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("a server refusal (suppressed) shows its copy under the field", async () => {
    routeActions.changeDefaultRouteAction.mockResolvedValue({
      ok: false,
      code: "invalid_input",
      message:
        "Emails to this address bounced before. Check the spelling, or use another address.",
    });
    const { container: c } = routing();
    click(button(c, "Change address"));
    submitForm(c, "gone@riverabakery.com");
    await flush();
    expect(c.textContent).toContain(
      "Emails to this address bounced before. Check the spelling, or use another address.",
    );
  });

  it("a bouncing default shows BOUNCE and its Change address opens the edit", () => {
    const { container: c } = routing([{ ...DEFAULT, status: "bouncing" }]);
    const alert = c.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      "Emails to maria@riverabakery.com are bouncing, so you may be missing messages.",
    );
    click(button(alert!, "Change address"));
    expect(button(c, ROUTING_COPY.save)).not.toBeNull();
  });
});

describe("EmailRouting: Use a different address for…", () => {
  it("closed by default; open when an override exists; four groups", () => {
    const first = routing();
    const toggle = button(first.container, "Use a different address for…")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    first.unmount();
    mounted = null;
    const { container: c } = routing([DEFAULT, route({})]);
    expect(
      button(c, "Use a different address for…")!.getAttribute("aria-expanded"),
    ).toBe("true");
    const groups = Array.from(c.querySelectorAll("fieldset[data-group]")).map(
      (g) => g.querySelector("label span span")?.textContent,
    );
    expect(groups).toEqual([
      "Website inquiries",
      "Newsletter",
      "Billing from CDS",
      "Account and support",
    ]);
    expect(box(c, "inquiries").checked).toBe(true);
    expect(box(c, "billing").checked).toBe(false);
  });

  it("checking Website inquiries reveals an address form; saving adds a waiting row + toast", async () => {
    routeActions.addEmailRouteAction.mockResolvedValue({
      ok: true,
      data: route({ id: "r0000000000inq1" }),
    });
    const { container: c } = routing();
    click(button(c, "Use a different address for…"));
    click(box(c, "inquiries"));
    const group = c.querySelector('[data-group="inquiries"]')!;
    submitForm(group, "orders@riverabakery.com");
    await flush();
    expect(routeActions.addEmailRouteAction).toHaveBeenCalledWith(
      "inquiries",
      "orders@riverabakery.com",
    );
    expect(group.textContent).toContain("Waiting for confirmation");
    expect(document.body.textContent).toContain(
      "We sent a confirmation to orders@riverabakery.com.",
    );
    expect(button(group, "Add another address")).not.toBeNull();
  });

  it("a duplicate within the group is refused with the list copy", async () => {
    const { container: c } = routing([DEFAULT, route({})]);
    const group = c.querySelector('[data-group="inquiries"]')!;
    click(button(group, "Add another address"));
    submitForm(group, "ORDERS@riverabakery.com");
    await flush();
    expect(group.textContent).toContain("This address is already on the list.");
    expect(routeActions.addEmailRouteAction).not.toHaveBeenCalled();
  });

  it("up to 5 inquiries: no Add another address at 5", () => {
    const five = [1, 2, 3, 4, 5].map((n) =>
      route({ address: `a${n}@riverabakery.com`, status: "confirmed" }),
    );
    const { container: c } = routing([DEFAULT, ...five]);
    const group = c.querySelector('[data-group="inquiries"]')!;
    expect(group.querySelectorAll("li")).toHaveLength(5);
    expect(button(group, "Add another address")).toBeNull();
  });

  it("C-WR-04: changing a bouncing inquiry address at the cap swaps it in one call", async () => {
    const five = [1, 2, 3, 4].map((n) =>
      route({ address: `a${n}@riverabakery.com`, status: "confirmed" }),
    );
    const bad = route({ address: "old@riverabakery.com", status: "bouncing" });
    routeActions.addEmailRouteAction.mockResolvedValue({
      ok: true,
      data: {
        ...bad,
        id: "r0000000000new1",
        address: "new@riverabakery.com",
        status: "waiting",
      },
    });
    const { container: c } = routing([DEFAULT, ...five, bad]);
    const group = c.querySelector('[data-group="inquiries"]')!;
    click(button(group.querySelector('[role="alert"]')!, "Change address"));
    submitForm(group, "new@riverabakery.com");
    await flush();
    expect(routeActions.addEmailRouteAction).toHaveBeenCalledWith(
      "inquiries",
      "new@riverabakery.com",
      bad.id,
    );
    expect(routeActions.removeEmailRouteAction).not.toHaveBeenCalled();
    expect(group.textContent).toContain("new@riverabakery.com");
    expect(group.textContent).not.toContain("old@riverabakery.com");
    expect(group.querySelectorAll("li")).toHaveLength(5);
  });

  it("C-WR-04: a refused change keeps the old row", async () => {
    const bad = route({ address: "old@riverabakery.com", status: "bouncing" });
    routeActions.addEmailRouteAction.mockResolvedValue({
      ok: false,
      code: "invalid_input",
      message:
        "That address isn't on the list anymore. Reload the page and try again.",
    });
    const { container: c } = routing([DEFAULT, bad]);
    const group = c.querySelector('[data-group="inquiries"]')!;
    click(button(group.querySelector('[role="alert"]')!, "Change address"));
    submitForm(group, "new@riverabakery.com");
    await flush();
    expect(group.textContent).toContain("isn't on the list anymore");
    expect(group.textContent).toContain("old@riverabakery.com");
  });

  it("remove is immediate with 'x removed.' and Undo, which adds it back", async () => {
    const r = route({ status: "confirmed" });
    routeActions.removeEmailRouteAction.mockResolvedValue({
      ok: true,
      data: null,
    });
    routeActions.restoreEmailRouteAction.mockResolvedValue({
      ok: true,
      data: { ...r, id: "r0000000000res1", status: "waiting" },
    });
    const { container: c } = routing([DEFAULT, r]);
    click(button(c, "Remove orders@riverabakery.com"));
    expect(c.querySelector('[data-group="inquiries"] li')).toBeNull();
    await flush();
    expect(routeActions.removeEmailRouteAction).toHaveBeenCalledWith(r.id);
    expect(document.body.textContent).toContain(
      "orders@riverabakery.com removed.",
    );
    click(button(document.body, "Undo"));
    await flush();
    expect(routeActions.restoreEmailRouteAction).toHaveBeenCalledWith({
      purpose: "inquiries",
      address: "orders@riverabakery.com",
    });
    expect(c.querySelector('[data-group="inquiries"]')!.textContent).toContain(
      "orders@riverabakery.com",
    );
  });

  it("Newsletter: Sender name defaults to the business name and saves on blur when changed", async () => {
    routeActions.setNewsletterSenderAction.mockResolvedValue({
      ok: true,
      data: null,
    });
    const nl = route({
      purpose: "newsletter",
      address: "news@riverabakery.com",
      status: "confirmed",
    });
    const { container: c } = routing([DEFAULT, nl]);
    const group = c.querySelector('[data-group="newsletter"]')!;
    const name = Array.from(group.querySelectorAll("input")).find(
      (i) => i.type === "text",
    )!;
    expect(name.value).toBe("Rivera Bakery");
    expect(group.textContent).toContain("The name people see in their inbox.");
    expect(group.textContent).toContain("news@riverabakery.com");
    typeInto(name, "Maria at Rivera Bakery");
    act(() => {
      name.focus();
      name.blur();
    });
    await flush();
    expect(routeActions.setNewsletterSenderAction).toHaveBeenCalledWith(
      "Maria at Rivera Bakery",
    );
  });

  it("C-WR-03: changing the sender name back to the first value saves it; an unchanged blur does not", async () => {
    routeActions.setNewsletterSenderAction.mockResolvedValue({
      ok: true,
      data: null,
    });
    const nl = route({
      purpose: "newsletter",
      address: "news@riverabakery.com",
      status: "confirmed",
    });
    const { container: c } = routing([DEFAULT, nl]);
    const group = c.querySelector('[data-group="newsletter"]')!;
    const name = Array.from(group.querySelectorAll("input")).find(
      (i) => i.type === "text",
    )!;
    const commit = async (v: string) => {
      typeInto(name, v);
      act(() => {
        name.focus();
        name.blur();
      });
      await flush();
    };
    await commit("Maria at Rivera Bakery");
    await commit("Rivera Bakery");
    await commit("Rivera Bakery");
    expect(routeActions.setNewsletterSenderAction.mock.calls).toEqual([
      ["Maria at Rivera Bakery"],
      [""],
    ]);
  });

  it("read-only (Editor): rows and badges, no forms, remove or change buttons", () => {
    const { container: c } = routing([DEFAULT, route({})], { readOnly: true });
    expect(button(c, "Change address")).toBeNull();
    expect(button(c, /^Remove /)).toBeNull();
    expect(button(c, ROUTING_COPY.save)).toBeNull();
    expect(box(c, "inquiries").disabled).toBe(true);
    expect(c.textContent).toContain("orders@riverabakery.com");
  });
});

describe("EmailRouting: How your emails look to customers", () => {
  it("From the business name at <slug>@<mail domain>; Replies go to the default", () => {
    const { container: c } = routing();
    const p = c.querySelector("[data-preview]")!;
    expect(p.textContent).toContain("How your emails look to customers");
    expect(p.textContent).toContain(
      "From: Rivera Bakery <rivera-bakery@send.example.com>",
    );
    expect(p.textContent).toContain("Replies go to: maria@riverabakery.com");
    expect(p.querySelector("[data-free-mail]")).toBeNull();
  });

  it("a Gmail reply-to adds the own-domain line, whose link opens the how-to steps; Gmail is never the From", () => {
    const { container: c } = routing([
      { ...DEFAULT, address: "maria@gmail.com" },
    ]);
    const p = c.querySelector("[data-preview]")!;
    expect(p.textContent).toContain(
      "Using Gmail is fine: replies come straight to you. For a more professional look, get an address at your own domain.",
    );
    const from = Array.from(p.querySelectorAll("p")).find((x) =>
      x.textContent?.startsWith("From:"),
    )!;
    expect(from.textContent).toBe(
      "From: Rivera Bakery <rivera-bakery@send.example.com>",
    );
    click(button(p, "get an address at your own domain"));
    expect(document.body.textContent).toContain(
      "Get an address at your own domain",
    );
    expect(document.body.textContent).toContain(PRO_EMAIL_STEPS[1]!.action);
  });

  it("previewSender is senderFor: free-mail never From; a bad mail domain gives null", () => {
    const s = previewSender({
      name: "Rivera Bakery",
      slug: "rivera-bakery",
      replyTo: "maria@gmail.com",
      mailDomain: "send.example.com",
    })!;
    expect(s.fromAddress).toBe("rivera-bakery@send.example.com");
    expect(s.replyTo).toBe("maria@gmail.com");
    expect(
      previewSender({
        name: "x",
        slug: "x",
        replyTo: "",
        mailDomain: "not a domain",
      }),
    ).toBeNull();
    expect(providerName("a@hotmail.com")).toBe("Outlook");
    expect(providerName("a@proton.me")).toBe("a personal address");
  });

  it("the baked how-to steps match docs/how-to/professional-email-address.md (drift)", async () => {
    const gen =
      (await import("../../../packages/addon-registry/scripts/gen.mjs")) as {
        parseUseSteps: (md: string) => unknown[];
      };
    const md = readFileSync(
      path.resolve(import.meta.dirname, "../../..", PRO_EMAIL_HOWTO),
      "utf8",
    );
    expect(gen.parseUseSteps(md)).toEqual(
      PRO_EMAIL_STEPS.map((s) => ({ ...s })),
    );
  });
});

// ---------------------------------------------------------------------------------------
// Step 3 · Email through the real /hub/setup/[stage] page

function load(routes: Route[] = [DEFAULT], role = "owner") {
  sess.requireHubSession.mockResolvedValue({
    ctx: { ...CTX, role },
    email: "a@b.c",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
  db.getOrgStage.mockResolvedValue({
    stage: "intake",
    path: "standard",
    slug: "rivera-bakery",
  });
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
  const profile = {
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
  };
  db.getIntakeSnapshot.mockResolvedValue({
    orgName: "Rivera Bakery",
    path: "standard",
    profile,
    answers,
    counts: { services: 0, team: 0, gallery: 0, moodboard: 0 },
    media: { logo: false, hero: false, photosMissingAlt: 0 },
    email: { defaultConfirmed: true, bouncing: 0 },
    addonIntake: {},
    selections,
    stagesSaved: [],
  });
  db.getBusinessProfile.mockResolvedValue({
    id: "bp1",
    orgName: "Rivera Bakery",
    ...profile,
  });
  db.getOrgIntake.mockResolvedValue({
    selections,
    answers,
    stagesSaved: [],
    firstVisitDismissed: true,
    submittedAt: null,
    addonConfig: {},
    moodboardProposal: null,
  });
  db.listMedia.mockResolvedValue([]);
  db.listEmailRoutes.mockResolvedValue(routes);
}

describe("3 · Email", () => {
  it("all seven steps have a form", () => {
    for (const slug of [
      "business",
      "contact",
      "email",
      "words",
      "people",
      "look",
      "the-rest",
    ] as const) {
      expect(STAGE_FORMS[slug]).toBeTypeOf("function");
    }
  });

  it("renders the intro and the routing component with the server's mail domain and slug", async () => {
    load();
    const { container: c } = show(
      await StagePage({ params: Promise.resolve({ stage: "email" }) }),
    );
    expect(c.querySelector("h1")?.textContent).toBe("Email");
    expect(c.textContent).toContain(
      "Your site sends you messages and replies to customers for you. Tell us where they should go.",
    );
    expect(c.textContent).toContain("Where should your email go?");
    expect(c.textContent).toContain(
      "From: Rivera Bakery <rivera-bakery@send.example.com>",
    );
    expect(db.listEmailRoutes).toHaveBeenCalled();
  });

  it("a saved address marks the step saved", async () => {
    load();
    routeActions.addEmailRouteAction.mockResolvedValue({
      ok: true,
      data: route({ purpose: "billing", address: "books@riverabakery.com" }),
    });
    const { container: c } = show(
      await StagePage({ params: Promise.resolve({ stage: "email" }) }),
    );
    click(button(c, "Use a different address for…"));
    click(box(c, "billing"));
    submitForm(
      c.querySelector('[data-group="billing"]')!,
      "books@riverabakery.com",
    );
    await flush();
    expect(intake.markStageSavedAction).toHaveBeenCalledWith("email");
  });
});

// ---------------------------------------------------------------------------------------
// The real actions (T-06-102, T-06-104)

describe("email-route actions", () => {
  function signedIn() {
    sess.getHubSession.mockResolvedValue({
      ctx: CTX,
      email: "a@b.c",
      org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
    });
  }

  it("allow-list: an unknown or default purpose and a non-string address never reach the chokepoint", async () => {
    signedIn();
    expect((await real.addEmailRouteAction("default", "a@b.co")).ok).toBe(
      false,
    );
    expect((await real.addEmailRouteAction("marketing", "a@b.co")).ok).toBe(
      false,
    );
    const res = await real.addEmailRouteAction("inquiries", { x: 1 });
    expect(res).toMatchObject({
      ok: false,
      message:
        "That doesn't look like an email address. Check it and try again.",
    });
    expect(db.addEmailRoute).not.toHaveBeenCalled();
  });

  it("add: the session ctx, purpose and address only (default transport); returns the view", async () => {
    signedIn();
    db.addEmailRoute.mockResolvedValue({
      id: "r0000000000inq1",
      purpose: "inquiries",
      address: "orders@riverabakery.com",
      senderName: "",
      status: "waiting",
      pendingDefault: false,
    });
    const res = await real.addEmailRouteAction(
      "inquiries",
      " orders@riverabakery.com ",
    );
    expect(db.addEmailRoute).toHaveBeenCalledWith(CTX, {
      purpose: "inquiries",
      address: "orders@riverabakery.com",
    });
    expect(db.addEmailRoute.mock.calls[0]).toHaveLength(2);
    expect(res).toMatchObject({ ok: true, data: { status: "waiting" } });
  });

  it("C-WR-04: add with replaces passes the row id; a bad id or a non-inquiry replace never reaches the chokepoint", async () => {
    signedIn();
    db.addEmailRoute.mockResolvedValue({
      id: "r0000000000inq2",
      purpose: "inquiries",
      address: "new@riverabakery.com",
      senderName: "",
      status: "waiting",
      pendingDefault: false,
    });
    await real.addEmailRouteAction(
      "inquiries",
      "new@riverabakery.com",
      "r0000000000inq1",
    );
    expect(db.addEmailRoute).toHaveBeenCalledWith(CTX, {
      purpose: "inquiries",
      address: "new@riverabakery.com",
      replaces: "r0000000000inq1",
    });
    db.addEmailRoute.mockClear();
    expect(
      (
        await real.addEmailRouteAction(
          "inquiries",
          "n@riverabakery.com",
          "../x",
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await real.addEmailRouteAction(
          "billing",
          "n@riverabakery.com",
          "r0000000000inq1",
        )
      ).ok,
    ).toBe(false);
    expect(db.addEmailRoute).not.toHaveBeenCalled();
  });

  it("resend: a bad id is refused; the cooldown answers with the cooldown copy", async () => {
    signedIn();
    expect((await real.resendRouteConfirmationAction("../x")).ok).toBe(false);
    const { RateLimited } = (await import("@cds/db")) as unknown as {
      RateLimited: new (m: string) => Error;
    };
    db.resendRouteConfirmation.mockRejectedValue(new RateLimited("slow"));
    const res = await real.resendRouteConfirmationAction("r0000000000inq1");
    expect(res).toMatchObject({
      ok: false,
      code: "rate_limited",
      message: "Sent. Check that inbox. You can send another in a minute.",
    });
  });

  it("the confirm-email cap (A-WR-01) answers add and resend with its own copy", async () => {
    signedIn();
    const { RateLimited, CONFIRM_RATE_COPY } =
      (await import("@cds/db")) as unknown as {
        RateLimited: new (m: string) => Error;
        CONFIRM_RATE_COPY: string;
      };
    db.addEmailRoute.mockRejectedValue(new RateLimited(CONFIRM_RATE_COPY));
    expect(
      await real.addEmailRouteAction("billing", "books@riverabakery.com"),
    ).toMatchObject({
      ok: false,
      code: "rate_limited",
      message: CONFIRM_RATE_COPY,
    });
    db.resendRouteConfirmation.mockRejectedValue(
      new RateLimited(CONFIRM_RATE_COPY),
    );
    expect(
      await real.resendRouteConfirmationAction("r0000000000inq1"),
    ).toMatchObject({
      ok: false,
      code: "rate_limited",
      message: CONFIRM_RATE_COPY,
    });
  });

  it("change default, remove, restore and sender name go through the chokepoint with the session ctx", async () => {
    signedIn();
    db.changeDefaultRoute.mockResolvedValue({
      ...DEFAULT,
      pendingDefault: true,
    });
    db.removeEmailRoute.mockResolvedValue(undefined);
    db.addEmailRoute.mockResolvedValue(route({}));
    db.setNewsletterSender.mockResolvedValue(undefined);
    await real.changeDefaultRouteAction("new@riverabakery.com");
    expect(db.changeDefaultRoute).toHaveBeenCalledWith(
      CTX,
      "new@riverabakery.com",
    );
    await real.removeEmailRouteAction("r0000000000inq1");
    expect(db.removeEmailRoute).toHaveBeenCalledWith(CTX, "r0000000000inq1");
    await real.restoreEmailRouteAction({
      purpose: "billing",
      address: "books@riverabakery.com",
      orgId: "other",
    });
    expect(db.addEmailRoute).toHaveBeenCalledWith(CTX, {
      purpose: "billing",
      address: "books@riverabakery.com",
    });
    await real.setNewsletterSenderAction("Rivera Bakery news");
    expect(db.setNewsletterSender).toHaveBeenCalledWith(
      CTX,
      "Rivera Bakery news",
    );
  });

  it("signed out: nothing is written", async () => {
    sess.getHubSession.mockResolvedValue(null);
    const res = await real.removeEmailRouteAction("r0000000000inq1");
    expect(res).toMatchObject({ ok: false, code: "signed_out" });
    expect(db.removeEmailRoute).not.toHaveBeenCalled();
  });
});
