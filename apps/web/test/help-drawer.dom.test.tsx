// @vitest-environment jsdom
// 11-47 (DASH-17, D-UI-P11-16; T-11-47-01, T-11-47-02): the "?" beside every screen's H1
// opens that screen's how-to in the TrainingDrawer in place (`?help=<id>`), Esc closes it and
// removes the param; screen-owned ids (`stripe`) and malformed ids never reach the host; the
// help route answers only articles the person may read, with no-store headers.
// 12-20: the drawer footer adds "Still stuck? Ask CDS" for people who can file (askCds).
import { ScreenHeader } from "@cds/ui/hub/shell";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const session = vi.hoisted(() => ({
  current: null as null | { ctx: { role: string; grants: string[] } },
  throws: false,
}));
vi.mock("../lib/session", () => ({
  getHubSession: async () => {
    if (session.throws) throw new Error("fetch failed");
    return session.current;
  },
}));
vi.mock("@cds/db", () => ({ activeAddons: async () => [] }));

const { HelpDrawerHost, askCdsHref, hostHelpId, screenTarget } =
  await import("../app/(platform)/hub/HelpDrawerHost");
const { GET } = await import("../app/(platform)/hub/api/help/[id]/route");

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
  };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

const TODAY = {
  id: "today",
  title: "Today",
  href: "/hub/help/today",
  steps: [
    {
      screen: "Today",
      action: "Read the status line.",
      expected: "You see where your site stands.",
    },
  ],
};

function stubFetch(): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      return url.endsWith("/today")
        ? new Response(JSON.stringify(TODAY), { status: 200 })
        : new Response("{}", { status: 404 });
    }),
  );
  return urls;
}

const openDialog = () => document.querySelector("dialog[open]");

describe("HelpDrawerHost (DASH-17)", () => {
  it("clicking ? sets ?help=today and opens Today's steps; Esc closes and clears it", async () => {
    window.history.replaceState(null, "", "/hub/today?tab=x");
    const urls = stubFetch();
    mounted = mount(
      <HelpDrawerHost>
        <ScreenHeader title="Today" helpId="today" />
      </HelpDrawerHost>,
    );
    const link = mounted.container.querySelector<HTMLAnchorElement>(
      'a[aria-label="How Today works"]',
    );
    expect(link!.getAttribute("href")).toBe("/hub/help/today");
    click(link);
    await flush();
    expect(new URLSearchParams(window.location.search).get("help")).toBe(
      "today",
    );
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("x");
    expect(urls).toEqual(["/hub/api/help/today"]);
    const dialog = openDialog();
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Read the status line.");
    const footer = [...dialog!.querySelectorAll("a")].find(
      (a) => a.textContent === "Open in Help center",
    );
    expect(footer?.getAttribute("href")).toBe("/hub/help/today");

    dialog!.dispatchEvent(new Event("cancel", { cancelable: true }));
    await flush();
    expect(openDialog()).toBeNull();
    expect(window.location.search).toBe("?tab=x");
  });

  it("opens from a ?help= already in the URL", async () => {
    window.history.replaceState(null, "", "/hub/today?help=today");
    stubFetch();
    mounted = mount(
      <HelpDrawerHost>
        <p>screen</p>
      </HelpDrawerHost>,
    );
    await flush();
    expect(openDialog()?.textContent).toContain("Read the status line.");
  });

  it("an unknown id opens nothing", async () => {
    window.history.replaceState(null, "", "/hub/today?help=nope");
    stubFetch();
    mounted = mount(
      <HelpDrawerHost>
        <p>screen</p>
      </HelpDrawerHost>,
    );
    await flush();
    expect(openDialog()).toBeNull();
  });

  it("screen-owned and malformed ids never reach the host (T-11-47-02)", () => {
    expect(hostHelpId("stripe")).toBeNull();
    expect(hostHelpId("../x")).toBeNull();
    expect(hostHelpId("A")).toBeNull();
    expect(hostHelpId("")).toBeNull();
    expect(hostHelpId("website.pages")).toBe("website.pages");
  });

  it("a modifier click still follows the link (new tab)", () => {
    stubFetch();
    mounted = mount(
      <HelpDrawerHost>
        <ScreenHeader title="Today" helpId="today" />
      </HelpDrawerHost>,
    );
    const link = mounted.container.querySelector("a")!;
    const ev = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(button(mounted.container, "How Today works")).toBeNull();
  });
});

describe("GET /hub/api/help/<id> (T-11-47-01)", () => {
  const call = (id: string) =>
    GET(new Request(`http://x/hub/api/help/${id}`), {
      params: Promise.resolve({ id }),
    });

  it("signed out is 401", async () => {
    session.current = null;
    const res = await call("today");
    expect(res.status).toBe(401);
  });

  it("a session-read outage is 503, no-store (IN-E03)", async () => {
    session.throws = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await call("today");
      expect(res.status).toBe(503);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    } finally {
      session.throws = false;
      spy.mockRestore();
    }
  });

  it("answers the steps for a screen help id, no-store", async () => {
    session.current = { ctx: { role: "owner", grants: [] } };
    const res = await call("website.pages");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await res.json()) as typeof TODAY;
    expect(body.id).toBe("pages");
    expect(body.href).toBe("/hub/help/pages");
    expect(body.steps.length).toBeGreaterThan(0);
    for (const s of body.steps) expect(s.action).not.toMatch(/\*\*|`/);
  });

  it("a Viewer asking for download-data gets 404; unknown ids 404", async () => {
    session.current = { ctx: { role: "viewer", grants: [] } };
    const refused = await call("download-data");
    expect(refused.status).toBe(404);
    expect(refused.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await call("nope")).status).toBe(404);
    session.current = { ctx: { role: "owner", grants: [] } };
    expect((await call("download-data")).status).toBe(200);
  });
});

describe("Still stuck? Ask Support (12-20; COMM-06)", () => {
  function stubAsk(askCds: boolean) {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ...TODAY, tour: null, askCds }), {
            status: 200,
          }),
      ),
    );
  }

  it("a writer gets the Support line: a question about this screen, from here", async () => {
    window.history.replaceState(null, "", "/hub/website?tab=footer&help=today");
    stubAsk(true);
    mounted = mount(
      <HelpDrawerHost>
        <ScreenHeader title="Website" helpId="today" />
      </HelpDrawerHost>,
    );
    await flush();
    const line = openDialog()?.querySelector("[data-ask-cds]");
    expect(line?.hasAttribute("data-cds-identity")).toBe(true);
    expect(line?.textContent).toBe("Still stuck? Ask Support");
    expect(line?.querySelector("a")?.getAttribute("href")).toBe(
      "/hub/support/tickets/new?type=question&target=part%3Afooter&from=%2Fhub%2Fwebsite%3Ftab%3Dfooter",
    );
  });

  it("absent when the API says the person can't file (Viewer, impersonating)", async () => {
    window.history.replaceState(null, "", "/hub/today?help=today");
    stubAsk(false);
    mounted = mount(
      <HelpDrawerHost>
        <ScreenHeader title="Today" helpId="today" />
      </HelpDrawerHost>,
    );
    await flush();
    expect(openDialog()).not.toBeNull();
    expect(openDialog()?.querySelector("[data-ask-cds]")).toBeNull();
  });

  it("screenTarget: builder page, add-on screen, footer / navigation tabs, else none", () => {
    expect(screenTarget("/hub/website/pages/pageaaaaaaaaaa1", null)).toBe(
      "page:pageaaaaaaaaaa1",
    );
    expect(screenTarget("/hub/add-ons/appointments", null)).toBe(
      "addon:appointments",
    );
    expect(
      screenTarget("/hub/website", new URLSearchParams("tab=navigation")),
    ).toBe("part:menus");
    expect(screenTarget("/hub/today", null)).toBeNull();
    // IN-C02: Banner and Site settings are the header; an add-on's Website tab is the add-on.
    for (const tab of ["banner", "site"]) {
      expect(
        screenTarget("/hub/website", new URLSearchParams(`tab=${tab}`)),
      ).toBe("part:header");
    }
    expect(
      screenTarget("/hub/website", new URLSearchParams("tab=testimonials")),
    ).toBe("addon:testimonials");
    for (const tab of ["pages", "media", "", "../x"]) {
      expect(
        screenTarget("/hub/website", new URLSearchParams(`tab=${tab}`)),
      ).toBeNull();
    }
    expect(askCdsHref("/hub/today", null)).toBe(
      "/hub/support/tickets/new?type=question&from=%2Fhub%2Ftoday",
    );
  });

  it("the help API answers askCds: owner true, viewer false, impersonating false", async () => {
    const call = async (ctx: Record<string, unknown>) => {
      session.current = ctx as { ctx: { role: string; grants: string[] } };
      const res = await GET(new Request("http://x/hub/api/help/today"), {
        params: Promise.resolve({ id: "today" }),
      });
      return ((await res.json()) as { askCds: boolean }).askCds;
    };
    expect(await call({ ctx: { role: "owner", grants: [] } })).toBe(true);
    expect(await call({ ctx: { role: "viewer", grants: [] } })).toBe(false);
    expect(
      await call({
        ctx: { role: "owner", grants: [], impersonator: "staff1" },
      }),
    ).toBe(false);
  });
});
