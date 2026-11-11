// @vitest-environment jsdom
// First-use tours (11-48; DASH-17, D208; T-11-48-01, T-11-48-02): Today's tour runs on the
// first visit and, after Done, not on the next; impersonating staff get no tour and write
// nothing; only TOURS ids are written; the help drawer's "Show the tour" replays the tour
// registered by the current screen; the help API names the screen's tour.
import { ScreenHeader } from "@cds/ui/hub/shell";
import { act, type ReactElement } from "react";
import {
  afterAll,
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
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const OWNER = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const STAFF = { ...OWNER, impersonator: "s1" };

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  requireHubSession: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

// A tiny in-memory member_prefs row for the signed-in person.
const store = vi.hoisted(() => ({ toursSeen: [] as string[] }));
const db = vi.hoisted(() => ({
  readMemberPrefs: vi.fn(async () => ({ toursSeen: [...store.toursSeen] })),
  updateMemberPrefs: vi.fn(
    async (_ctx: unknown, patch: { toursSeen: string[] }) => {
      store.toursSeen = [...patch.toursSeen];
      return { toursSeen: store.toursSeen };
    },
  ),
  markTourSeen: vi.fn(async (_ctx: unknown, id: string) => {
    if (!store.toursSeen.includes(id))
      store.toursSeen = [...store.toursSeen, id];
    return { toursSeen: store.toursSeen };
  }),
  activeAddons: vi.fn(async () => []),
}));
vi.mock("@cds/db", () => db);

const { markTourSeenAction } = await import("../app/actions/tours");
const { TourSlot } = await import("../app/(platform)/hub/tour-slot");
const { TourHost, TOUR_POLL_MS, TOUR_WAIT_MS } =
  await import("../app/(platform)/hub/TourHost");
const { HelpDrawerHost } = await import("../app/(platform)/hub/HelpDrawerHost");
const { GET } = await import("../app/(platform)/hub/api/help/[id]/route");

// jsdom has no layout (offsetParent is always null): treat everything not `hidden` as shown.
const desc = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetParent",
);
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest("[hidden]") ? null : document.body;
    },
  });
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
afterAll(() => {
  if (desc) Object.defineProperty(HTMLElement.prototype, "offsetParent", desc);
});

let mounted: Mounted | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  store.toursSeen = [];
  sess.getHubSession.mockResolvedValue({ ctx: OWNER });
  sess.agreementBlocks.mockResolvedValue(false);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Today's anchors, as the page renders them. */
const TODAY_SCREEN = (
  <div>
    <div data-tour="today-status">Good morning</div>
    <div data-tour="today-needs-you">Needs you</div>
    <section data-tour="today-cards">
      Your day <button data-tour="today-customize">Customize</button>
    </section>
  </div>
);

const coach = () =>
  document.querySelector<HTMLElement>("[data-tour-coachmark]");

async function settle(ms = TOUR_WAIT_MS): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Renders TourSlot's output (an async server component) next to the screen. */
async function visitToday(ctx: object): Promise<ReactElement | null> {
  const slot = (await TourSlot({
    ctx: ctx as never,
    tourId: "today",
  })) as ReactElement | null;
  mounted = mount(
    <>
      {TODAY_SCREEN}
      {slot}
    </>,
  );
  return slot;
}

describe("Today's first-use tour (DASH-17)", () => {
  it("runs on the first visit; after Done it is saved and the next visit has none", async () => {
    vi.useFakeTimers();
    await visitToday(OWNER);
    await settle(TOUR_POLL_MS);
    expect(coach()).not.toBeNull();
    expect(coach()!.textContent).toContain("Step 1 of 4");
    expect(coach()!.textContent).toContain("Where your site stands");
    for (let i = 0; i < 3; i += 1) click(button(document.body, "Next"));
    expect(coach()!.textContent).toContain("Step 4 of 4");
    click(button(document.body, "Done"));
    vi.useRealTimers();
    await flush();
    expect(coach()).toBeNull();
    expect(db.markTourSeen).toHaveBeenCalledWith(OWNER, "today");
    expect(store.toursSeen).toEqual(["today"]);

    mounted!.unmount();
    document.body.innerHTML = "";
    vi.useFakeTimers();
    await visitToday(OWNER);
    await settle(TOUR_WAIT_MS * 2);
    expect(coach()).toBeNull();
  });

  it("skipping counts as seen too", async () => {
    vi.useFakeTimers();
    await visitToday(OWNER);
    await settle(TOUR_POLL_MS);
    click(button(document.body, "Skip tour"));
    vi.useRealTimers();
    await flush();
    expect(store.toursSeen).toEqual(["today"]);
  });

  it("impersonating staff get no tour and nothing is read or written", async () => {
    vi.useFakeTimers();
    const slot = await visitToday(STAFF);
    expect(slot).toBeNull();
    await settle(TOUR_WAIT_MS * 2);
    expect(coach()).toBeNull();
    expect(db.readMemberPrefs).not.toHaveBeenCalled();

    sess.getHubSession.mockResolvedValue({ ctx: STAFF });
    const res = await markTourSeenAction("today");
    expect(res).toEqual({ ok: true, data: { seen: false } });
    expect(db.markTourSeen).not.toHaveBeenCalled();
  });

  it("a prefs read failure never starts the tour", async () => {
    db.readMemberPrefs.mockRejectedValueOnce(new Error("down"));
    vi.useFakeTimers();
    await visitToday(OWNER);
    await settle(TOUR_WAIT_MS * 2);
    expect(coach()).toBeNull();
  });

  it("waits while a modal dialog is open", async () => {
    vi.useFakeTimers();
    mounted = mount(
      <>
        {TODAY_SCREEN}
        <div role="dialog" aria-modal="true" id="modal">
          Busy
        </div>
        <TourHost tourId="today" autoStart />
      </>,
    );
    await settle(TOUR_POLL_MS * 2);
    expect(coach()).toBeNull();
    act(() => document.getElementById("modal")!.removeAttribute("role"));
    await settle(TOUR_POLL_MS);
    expect(coach()).not.toBeNull();
  });

  it("?tour=today replays a seen tour and drops the param", async () => {
    window.history.replaceState(null, "", "/hub/today?tour=today&x=1");
    vi.useFakeTimers();
    mounted = mount(
      <>
        {TODAY_SCREEN}
        <TourHost tourId="today" autoStart={false} />
      </>,
    );
    await settle(TOUR_POLL_MS);
    expect(coach()).not.toBeNull();
    expect(window.location.search).toBe("?x=1");
  });
});

describe("markTourSeenAction (T-11-48-02)", () => {
  it("writes only TOURS ids, once", async () => {
    for (const bad of ["nope", "", 3, null, "today;drop", ["today"]]) {
      const res = await markTourSeenAction(bad);
      expect(res.ok).toBe(false);
    }
    expect(db.markTourSeen).not.toHaveBeenCalled();
    expect((await markTourSeenAction("media")).ok).toBe(true);
    expect((await markTourSeenAction("media")).ok).toBe(true);
    expect(db.markTourSeen).toHaveBeenCalledWith(OWNER, "media");
    expect(store.toursSeen).toEqual(["media"]);
  });
});

describe("Show the tour from the help drawer", () => {
  it("the drawer footer replays the tour registered by this screen", async () => {
    store.toursSeen = ["today"];
    window.history.replaceState(null, "", "/hub/today");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "today",
              title: "Today",
              href: "/hub/help/today",
              steps: [
                { screen: "Today", action: "Read it.", expected: "Done." },
              ],
              tour: "today",
            }),
            { status: 200 },
          ),
      ),
    );
    mounted = mount(
      <HelpDrawerHost>
        <ScreenHeader title="Today" helpId="today" />
        {TODAY_SCREEN}
        <TourHost tourId="today" autoStart={false} />
      </HelpDrawerHost>,
    );
    click(mounted.container.querySelector('a[aria-label="How Today works"]'));
    await flush();
    const show = document.querySelector<HTMLButtonElement>("[data-show-tour]");
    expect(show?.textContent).toBe("Show the tour");
    click(show);
    await flush();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(coach()).not.toBeNull();
    expect(coach()!.textContent).toContain("Step 1 of 4");
  });

  it("no tour on this screen: no Show the tour", async () => {
    window.history.replaceState(null, "", "/hub/today");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "today",
              title: "Today",
              href: "/hub/help/today",
              steps: [
                { screen: "Today", action: "Read it.", expected: "Done." },
              ],
              tour: "today",
            }),
            { status: 200 },
          ),
      ),
    );
    mounted = mount(
      <HelpDrawerHost>
        <ScreenHeader title="Today" helpId="today" />
      </HelpDrawerHost>,
    );
    click(mounted.container.querySelector('a[aria-label="How Today works"]'));
    await flush();
    expect(document.querySelector("dialog[open]")).not.toBeNull();
    expect(document.querySelector("[data-show-tour]")).toBeNull();
  });

  it("the help API names each screen's tour", async () => {
    const call = async (id: string) => {
      const res = await GET(new Request(`http://x/hub/api/help/${id}`), {
        params: Promise.resolve({ id }),
      });
      return (await res.json()) as { tour: string | null };
    };
    expect((await call("today")).tour).toBe("today");
    expect((await call("website.pages")).tour).toBe("builder");
    expect((await call("add-ons")).tour).toBe("addons");
    expect((await call("website.media")).tour).toBe("media");
    expect((await call("profile")).tour).toBeNull();
  });
});
