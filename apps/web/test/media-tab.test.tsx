// @vitest-environment jsdom
// 07-17 Task 3: Website › Media (CONT-14, CONT-19, CONT-21, CONT-35, D280, D-UI-P7-4/5/7/8/9;
// 07-UI-SPEC "Media"; T-07-17-01, T-07-17-07). The real server tab runs over a mocked session
// and @cds/db; the actions are mocked; the client panel renders in jsdom inside the hub
// ToastRegion. MediaPanel is also rendered directly with a fake MediaSource for polling,
// retry, delete and the batch toast.
import { NotFound } from "@cds/core";
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
  usePathname: () => "/hub/website",
  useRouter: () => ({
    push: nav.push,
    refresh: nav.refresh,
    replace: nav.replace,
  }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const OWNER = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const VIEWER = { orgId: "org1", actor: "u2", role: "viewer", grants: [] };
const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const REGISTRY = vi.hoisted(() => ({ sentinel: "registry" }));
vi.mock("../lib/section-registry", () => ({ SECTION_REGISTRY: REGISTRY }));

type PackRow = {
  itemKind: string;
  itemKey: string;
  path: string;
  monthlyCents: number | null;
};

const db = vi.hoisted(() => ({
  listLibrary: vi.fn(),
  mediaUsage: vi.fn(),
  videoStates: vi.fn(),
  getBusinessProfile: vi.fn(),
  getLibraryItem: vi.fn(),
  mediaUsedOn: vi.fn(),
  listMediaNeedingDescription: vi.fn(),
  // WR-D05: the pack buttons read the catalog for the org's path.
  orgPlanPath: vi.fn(async () => "standard"),
  readPriceCatalog: vi.fn(async (): Promise<PackRow[]> => [
    {
      itemKind: "pack",
      itemKey: "media-5gb",
      path: "standard",
      monthlyCents: 500,
    },
    {
      itemKind: "pack",
      itemKey: "media-25gb",
      path: "standard",
      monthlyCents: 1500,
    },
  ]),
}));
vi.mock("@cds/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cds/db")>()),
  ...db,
}));

const actions = vi.hoisted(() => ({
  deleteLibraryMediaAction: vi.fn(),
  retryVideoAction: vi.fn(),
  setVideoCoverAction: vi.fn(),
}));
vi.mock("../app/actions/media", () => actions);

const billing = vi.hoisted(() => ({
  packPreviewAction: vi.fn(),
  buyPackAction: vi.fn(),
}));
vi.mock("../app/actions/billing", () => billing);

const { USAGE_COPY } = await import("@cds/db");
const { MediaTab } = await import("../app/(platform)/hub/website/MediaTab");
const { MediaPanel } = await import("../app/(platform)/hub/website/MediaPanel");
const { MEDIA_STEPS, MEDIA_HOWTO } =
  await import("../app/(platform)/hub/website/media-steps");
const { parseMediaParams } =
  await import("../app/(platform)/hub/website/media-params");

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const GB = 1024 ** 3;
const MB = 1024 * 1024;

type Item = Record<string, unknown> & { id: string; kind: string };

function photo(id: string, p: Record<string, unknown> = {}): Item {
  return {
    id,
    kind: "image",
    rowKind: "library",
    name: `${id}.jpg`,
    alt: "",
    needsDescription: true,
    status: "ready",
    width: 800,
    height: 600,
    bytes: MB,
    durationS: 0,
    createdAt: "2026-09-12T19:14:00.000Z",
    thumbUrl: `/hub/media/${id}/thumb`,
    previewUrl: `/hub/media/${id}/web`,
    posterUrl: null,
    ...p,
  };
}

function video(id: string, p: Record<string, unknown> = {}): Item {
  return photo(id, {
    kind: "video",
    rowKind: "video",
    name: "Tour.mp4",
    needsDescription: false,
    width: 0,
    height: 0,
    durationS: 42,
    thumbUrl: `/hub/media/${id}/poster.webp`,
    previewUrl: `/hub/media/${id}/video.mp4`,
    posterUrl: `/hub/media/${id}/poster.webp`,
    ...p,
  });
}

function pageOf(items: Item[], p: Record<string, unknown> = {}) {
  return {
    items,
    total: items.length,
    page: 1,
    perPage: 60,
    counts: { all: items.length, images: 1, videos: 0, audio: 0 },
    needsDescription: 1,
    ...p,
  };
}

function usage(level: "ok" | "warn" | "full", used = GB) {
  return {
    usedBytes: used,
    allowanceBytes: 2 * GB,
    ratio: used / (2 * GB),
    level,
    assets: 1,
    byKind: { image: 0, video: 0, audio: 0 },
    label: "1 GB of 2 GB used",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sess.requireHubSession.mockResolvedValue({
    ctx: OWNER,
    email: "a@b.c",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
  db.listLibrary.mockResolvedValue(pageOf([photo("p1")]));
  db.mediaUsage.mockResolvedValue(usage("ok"));
  db.videoStates.mockResolvedValue({});
  db.getBusinessProfile.mockResolvedValue({ time_zone: "America/Chicago" });
});

async function render(sp: Record<string, string | string[] | undefined>) {
  const el = await MediaTab({ tab: "media", ...sp });
  mounted = mount(<ToastRegion>{el}</ToastRegion>);
  await flush();
  return mounted.container;
}

function asViewer() {
  sess.requireHubSession.mockResolvedValue({
    ctx: VIEWER,
    email: "v@b.c",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
}

function asRole(role: string, extra: Record<string, unknown> = {}) {
  sess.requireHubSession.mockResolvedValue({
    ctx: { orgId: "org1", actor: "u3", role, grants: [], ...extra },
    email: "x@b.c",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
}

describe("MediaTab storage packs at the limit (10-43)", () => {
  const PREVIEW = {
    title: "Add 5 GB of media storage?",
    what: "5 GB more room for your photos, video and audio.",
    todayCents: 242,
    todayLabel: "For the rest of October",
    thenText: "$5/mo on your monthly bill from Nov 1",
    cardLine: "Plus sales tax. Charged to Visa ending 4242.",
    confirmLabel: "Add 5 GB",
    token: "tok-5",
  };

  it("owner at 100%: pack buttons replace Upload files; one confirm buys 5 GB", async () => {
    db.mediaUsage.mockResolvedValue(usage("full", 2 * GB));
    billing.packPreviewAction.mockResolvedValue({ ok: true, preview: PREVIEW });
    billing.buyPackAction.mockResolvedValue({
      ok: true,
      toast: "5 GB added. You now have 7 GB.",
    });
    const c = await render({});
    expect(c.querySelector("[data-upload-button]")).toBeNull();
    expect(button(c, "Add 5 GB for $5/mo")?.className).toMatch(
      /hub-accent|primary|bg-/,
    );
    expect(button(c, "Add 25 GB for $15/mo")).not.toBeNull();
    expect(c.querySelector("[data-usage-full]")?.textContent).toBe(
      USAGE_COPY.full(2 * GB),
    );
    click(button(c, "Add 5 GB for $5/mo"));
    await flush();
    expect(billing.packPreviewAction).toHaveBeenCalledWith("5gb");
    expect(document.body.textContent).toContain("Add 5 GB of media storage?");
    expect(document.body.textContent).toContain("Today · $2.42");
    expect(billing.buyPackAction).not.toHaveBeenCalled();
    click(button(document.body, "Add 5 GB"));
    await flush();
    expect(billing.buyPackAction).toHaveBeenCalledWith("5gb", "tok-5");
    expect(nav.refresh).toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "5 GB added. You now have 7 GB.",
    );
  });

  it("WR-D05: the button prices come from the catalog; an unset size is not offered", async () => {
    db.mediaUsage.mockResolvedValue(usage("full", 2 * GB));
    db.readPriceCatalog.mockResolvedValueOnce([
      {
        itemKind: "pack",
        itemKey: "media-5gb",
        path: "standard",
        monthlyCents: 700,
      },
      {
        itemKind: "pack",
        itemKey: "media-25gb",
        path: "standard",
        monthlyCents: null,
      },
    ]);
    const c = await render({});
    expect(button(c, "Add 5 GB for $7/mo")).not.toBeNull();
    const offers = c.querySelector("[data-pack-offers]")!;
    expect(offers.textContent).not.toContain("Add 25 GB");
    expect(offers.textContent).not.toContain("$5/mo");
  });

  it("after a buy the refreshed view (7 GB) brings Upload files back", async () => {
    db.mediaUsage.mockResolvedValue({
      ...usage("ok", 2 * GB),
      allowanceBytes: 7 * GB,
      ratio: 2 / 7,
      label: "2 GB of 7 GB used",
    });
    const c = await render({});
    expect(c.querySelector("[data-upload-button]")).not.toBeNull();
    expect(c.querySelector("[data-pack-offers]")).toBeNull();
    expect(c.textContent).toContain("2 GB of 7 GB used");
  });

  it("a failed preview closes the confirm and toasts; nothing is bought", async () => {
    db.mediaUsage.mockResolvedValue(usage("full", 2 * GB));
    billing.packPreviewAction.mockResolvedValue({
      ok: false,
      message: "Only the site owner can change billing.",
    });
    const c = await render({});
    click(button(c, "Add 25 GB for $15/mo"));
    await flush();
    expect(billing.packPreviewAction).toHaveBeenCalledWith("25gb");
    expect(document.body.textContent).toContain(
      "Only the site owner can change billing.",
    );
    expect(billing.buyPackAction).not.toHaveBeenCalled();
  });

  it("owner at 85%: USAGE-80-PACKS with Add storage to Settings › Billing; Upload stays", async () => {
    db.mediaUsage.mockResolvedValue(usage("warn", 1.7 * GB));
    const c = await render({});
    expect(c.textContent).toContain(USAGE_COPY.warn(1.7 * GB, 2 * GB));
    const link = c.querySelector<HTMLAnchorElement>("[data-add-storage]");
    expect(link?.textContent).toBe("Add storage");
    expect(link?.getAttribute("href")).toBe(
      "/hub/settings?tab=billing#storage",
    );
    expect(c.querySelector("[data-upload-button]")).not.toBeNull();
  });

  it.each([
    ["admin", {}],
    ["editor", {}],
    ["owner", { impersonator: "staff1" }],
  ])(
    "%s %o at 100%: USAGE-FULL-MEMBER, no purchase buttons",
    async (role, extra) => {
      asRole(role, extra);
      db.mediaUsage.mockResolvedValue(usage("full", 2 * GB));
      const c = await render({});
      expect(c.querySelector("[data-usage-full]")?.textContent).toBe(
        USAGE_COPY.member,
      );
      expect(c.querySelector("[data-pack-offers]")).toBeNull();
      expect(c.querySelector("[data-add-storage]")).toBeNull();
      expect(button(c, /Add 5 GB/)).toBeNull();
    },
  );

  it("an Admin at 85% sees the warning without the link", async () => {
    asRole("admin");
    db.mediaUsage.mockResolvedValue(usage("warn", 1.7 * GB));
    const c = await render({});
    expect(c.textContent).toContain(USAGE_COPY.warn(1.7 * GB, 2 * GB));
    expect(c.querySelector("[data-add-storage]")).toBeNull();
  });
});

describe("MediaTab (07-17)", () => {
  it("owner: heading, how-to, meter, Upload files, filters and the grid", async () => {
    const c = await render({});
    expect(c.querySelector("h2")?.textContent).toBe("Media");
    expect(button(c, "How Media works")).not.toBeNull();
    expect(c.querySelector('[role="meter"]')).not.toBeNull();
    expect(c.querySelector("[data-upload-button]")?.textContent).toContain(
      "Upload files",
    );
    expect(c.textContent).toContain("Images1");
    expect(button(c, "p1.jpg, photo, needs description")).not.toBeNull();
    expect(db.listLibrary).toHaveBeenCalledWith(OWNER, {
      filter: "all",
      q: "",
      page: 1,
      perPage: 60,
    });
  });

  it("passes the URL filter and search; an unknown type is all", async () => {
    await render({ type: "videos", q: "tour" });
    expect(db.listLibrary).toHaveBeenLastCalledWith(OWNER, {
      filter: "videos",
      q: "tour",
      page: 1,
      perPage: 60,
    });
    await render({ type: "bogus" });
    expect(db.listLibrary).toHaveBeenLastCalledWith(
      OWNER,
      expect.objectContaining({ filter: "all" }),
    );
  });

  it("usage at full replaces Upload files with USAGE-FULL; warn shows USAGE-80", async () => {
    db.mediaUsage.mockResolvedValueOnce(usage("full", 2 * GB));
    let c = await render({});
    expect(c.querySelector("[data-upload-button]")).toBeNull();
    expect(c.textContent).toContain(USAGE_COPY.full(2 * GB));
    mounted?.unmount();
    db.mediaUsage.mockResolvedValueOnce(usage("warn", 1.7 * GB));
    c = await render({});
    expect(c.textContent).toContain(USAGE_COPY.warn(1.7 * GB, 2 * GB));
  });

  it("video tiles carry their state from videoStates", async () => {
    db.listLibrary.mockResolvedValue(pageOf([video("v1")]));
    db.videoStates.mockResolvedValue({ v1: "optimizing" });
    const c = await render({});
    expect(db.videoStates).toHaveBeenCalledWith(OWNER, ["v1"]);
    expect(button(c, "Tour.mp4, video, optimizing")).not.toBeNull();
  });

  it("&asset=<id> reads the file and where it is used; the drawer opens", async () => {
    db.getLibraryItem.mockResolvedValue(photo("p1"));
    db.mediaUsedOn.mockResolvedValue({
      pages: [{ id: "pg1", title: "Home" }],
      inVersions: false,
      inPopups: false,
      asCover: false,
      intakeSlot: false,
    });
    await render({ asset: "p1" });
    expect(db.getLibraryItem).toHaveBeenCalledWith(OWNER, "p1");
    expect(db.mediaUsedOn).toHaveBeenCalledWith(OWNER, "p1", REGISTRY);
    const link = document.querySelector("[data-used-on] a");
    expect(link?.getAttribute("href")).toBe("/hub/website/pages/pg1");
    expect(link?.textContent).toBe("Home");
    expect(document.body.textContent).toContain("12 Sep, 2:14 pm");
  });

  it("a file that is gone shows the info alert and no drawer", async () => {
    db.getLibraryItem.mockRejectedValue(new NotFound());
    db.mediaUsedOn.mockRejectedValue(new NotFound());
    const c = await render({ asset: "gone1" });
    expect(c.textContent).toContain(
      "This was removed or moved. Reload the page to see the latest.",
    );
    expect(document.querySelector("[data-used-on]")).toBeNull();
  });

  it("any other read failure rethrows (the page shows ERR-LOAD)", async () => {
    db.getLibraryItem.mockRejectedValue(new Error("boom"));
    db.mediaUsedOn.mockResolvedValue({ pages: [] });
    await expect(MediaTab({ tab: "media", asset: "p1" })).rejects.toThrow(
      "boom",
    );
  });

  it("&view=describe lists photos needing a description instead of the grid", async () => {
    db.listMediaNeedingDescription.mockResolvedValue({
      items: [
        {
          id: "p1",
          name: "IMG_1.jpg",
          thumbUrl: "/hub/media/p1/thumb",
          suggestion: "IMG 1",
        },
      ],
      total: 1,
    });
    const c = await render({ view: "describe" });
    expect(db.listMediaNeedingDescription).toHaveBeenCalledWith(OWNER, {
      limit: 200,
    });
    expect(c.textContent).toContain("Describe your photos");
    expect(c.querySelector('[aria-live="polite"]')?.textContent).toBe("1 left");
    expect(c.querySelector('input[type="search"]')).toBeNull();
    expect(c.querySelector("[data-media-tile]")).toBeNull();
  });

  it("a viewer sees the grid and drawer read-only", async () => {
    asViewer();
    db.listLibrary.mockResolvedValue(
      pageOf([photo("p1"), video("v1", { name: "Bad.mp4" })]),
    );
    db.videoStates.mockResolvedValue({ v1: "failed" });
    db.getLibraryItem.mockResolvedValue(photo("p1"));
    db.mediaUsedOn.mockResolvedValue({
      pages: [],
      inVersions: false,
      inPopups: false,
    });
    const c = await render({ asset: "p1" });
    expect(c.querySelector("[data-upload-button]")).toBeNull();
    expect(button(c, "Try again")).toBeNull();
    for (const name of ["Save description", "Delete photo"]) {
      expect(button(document.body, name)).toBeNull();
    }
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("the time zone falls back to UTC when the profile can't be read", async () => {
    db.getBusinessProfile.mockRejectedValue(new Error("nope"));
    db.getLibraryItem.mockResolvedValue(photo("p1"));
    db.mediaUsedOn.mockResolvedValue({
      pages: [],
      inVersions: false,
      inPopups: false,
    });
    await render({ asset: "p1" });
    expect(document.body.textContent).toContain("12 Sep, 7:14 pm");
  });

  it("the baked how-to steps match docs/how-to/media-library.md (drift)", async () => {
    const gen =
      (await import("../../../packages/addon-registry/scripts/gen.mjs")) as {
        parseUseSteps: (md: string) => unknown[];
      };
    const md = readFileSync(
      path.resolve(import.meta.dirname, "../../..", MEDIA_HOWTO),
      "utf8",
    );
    expect(gen.parseUseSteps(md)).toEqual(MEDIA_STEPS.map((s) => ({ ...s })));
    expect(MEDIA_STEPS.length).toBe(12);
  });

  it("MediaTab no longer shows the 07-03 shell", () => {
    const src = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../app/(platform)/hub/website/MediaTab.tsx",
      ),
      "utf8",
    );
    expect(src).not.toContain("SHELL_PANEL_BODY");
  });
});

describe("MediaPanel (07-17, client)", () => {
  function fakeSource(statesSeq: Record<string, string>[] = []) {
    let n = 0;
    return {
      list: vi.fn(),
      items: vi.fn(async (ids: readonly string[]) => ({
        ok: true as const,
        data: ids.map((id) => photo(id)),
      })),
      states: vi.fn(async () => ({
        ok: true as const,
        data: statesSeq[Math.min(n++, statesSeq.length - 1)] ?? {},
      })),
      describe: vi.fn(async () => ({ ok: true as const, data: { count: 1 } })),
    };
  }

  function panel(
    items: Item[],
    source: ReturnType<typeof fakeSource>,
    sp: Record<string, string> = {},
    open: unknown = null,
  ) {
    const props = {
      page: pageOf(items),
      usage: {
        usedBytes: GB,
        allowanceBytes: 2 * GB,
        ratio: 0.5,
        level: "ok" as const,
        label: "1 GB of 2 GB used",
        message: "",
      },
      params: parseMediaParams({ tab: "media", ...sp }),
      open,
      describeRows: null,
      canWrite: true,
      timeZone: "UTC",
      gone: false,
      source,
    } as unknown as Parameters<typeof MediaPanel>[0];
    mounted = mount(
      <ToastRegion>
        <MediaPanel {...props} />
      </ToastRegion>,
    );
    return mounted.container;
  }

  it("polls every 10 s only while a video waits, and announces ready once", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const source = fakeSource([{ v1: "optimizing" }, { v1: "ready" }]);
    panel([video("v1", { videoState: "waiting" })], source);
    expect(source.states).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flush();
    expect(source.states).toHaveBeenCalledTimes(1);
    expect(source.states).toHaveBeenCalledWith(["v1"]);
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    await flush();
    expect(source.states).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Tour.mp4 is ready.");
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await flush();
    expect(source.states).toHaveBeenCalledTimes(2);
    expect(document.body.textContent?.split("Tour.mp4 is ready.").length).toBe(
      2,
    );
  });

  it("Try again retries the video and says Optimizing again.", async () => {
    actions.retryVideoAction.mockResolvedValue({ ok: true, data: null });
    const c = panel([video("v1", { videoState: "failed" })], fakeSource());
    click(button(c, "Try again"));
    await flush();
    expect(actions.retryVideoAction).toHaveBeenCalledWith("v1");
    expect(document.body.textContent).toContain("Optimizing again.");
    expect(button(c, "Tour.mp4, video, waiting to optimize")).not.toBeNull();
  });

  it("deleting a used photo from the drawer calls the action and toasts", async () => {
    actions.deleteLibraryMediaAction.mockResolvedValue({
      ok: true,
      data: { outcome: "soft" },
    });
    const p = photo("p1");
    const c = panel(
      [p],
      fakeSource(),
      { asset: "p1" },
      {
        item: p,
        usedOn: {
          pages: [{ id: "pg1", title: "Home" }],
          inVersions: false,
          inPopups: false,
        },
      },
    );
    click(button(document.body, "Delete photo"));
    expect(document.querySelector("[data-delete-body]")?.textContent).toContain(
      "keep showing it",
    );
    const confirmDialog = document
      .querySelector("[data-delete-body]")!
      .closest("dialog")!;
    const confirm = Array.from(confirmDialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Delete photo",
    );
    click(confirm);
    await flush();
    expect(actions.deleteLibraryMediaAction).toHaveBeenCalledWith("p1");
    expect(document.body.textContent).toContain("Photo deleted.");
    expect(c.querySelector('[data-media-tile="p1"]')).toBeNull();
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("a batch of 5 photos toasts the batch copy with Describe them", async () => {
    let seq = 0;
    class AutoXHR {
      status = 0;
      responseText = "";
      upload = { onprogress: null, onload: null as null | (() => void) };
      onload: null | (() => void) = null;
      onerror = null;
      onabort = null;
      open() {}
      setRequestHeader() {}
      send() {
        queueMicrotask(() => {
          seq += 1;
          this.status = 200;
          this.responseText = JSON.stringify({ asset: { id: `n${seq}` } });
          this.upload.onload?.();
          this.onload?.();
        });
      }
      abort() {}
    }
    vi.stubGlobal("XMLHttpRequest", AutoXHR);
    const source = fakeSource();
    const c = panel([photo("p1")], source);
    const input = c.querySelector('[data-upload-button] input[type="file"]')!;
    const files = Array.from(
      { length: 5 },
      (_, i) => new File(["x"], `IMG_${i}.jpg`, { type: "image/jpeg" }),
    );
    Object.defineProperty(input, "files", { value: files, configurable: true });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush(20);
    expect(source.items).toHaveBeenCalledTimes(5);
    expect(document.body.textContent).toContain(
      "5 photos uploaded. Add their descriptions so everyone can see them.",
    );
    click(button(document.body, "Describe them"));
    expect(nav.push).toHaveBeenCalledWith(
      "/hub/website?tab=media&view=describe",
    );
  });

  it("choosing a filter replaces the URL inside a transition", () => {
    const c = panel([photo("p1")], fakeSource());
    click(c.querySelector('input[value="images"]'));
    expect(nav.replace).toHaveBeenCalledWith(
      "/hub/website?tab=media&type=images",
      { scroll: false },
    );
  });
});
