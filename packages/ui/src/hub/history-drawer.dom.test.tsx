// @vitest-environment jsdom
// Site-part History drawer (07-29; CONT-36, D184; 07-UI-SPEC "History", states row,
// "History empty", ERR-RESTORE, "Restore a history version"; choices 12-13).
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { button, click, flush, mount, type Mounted } from "../test-support/dom";
import type { HubActionResult } from "./addon-types";
import {
  HISTORY_COPY,
  HistoryDrawer,
  type HistoryPartKey,
  type HistoryVersionView,
} from "./HistoryDrawer";
import { ToastRegion } from "./Toast";

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

const VERSIONS: HistoryVersionView[] = [
  {
    id: "2026-09-28T14-14-00-000Z",
    at: "2026-09-28T14:14:00.000Z",
    who: { kind: "member", name: "Maria Lopez" },
    current: true,
  },
  {
    id: "2026-09-27T09-05-00-000Z",
    at: "2026-09-27T09:05:00.000Z",
    who: { kind: "support" },
    current: false,
  },
  {
    id: "2026-09-26T18-30-00-000Z",
    at: "2026-09-26T18:30:00.000Z",
    who: { kind: "former" },
    current: false,
  },
  {
    id: "2026-09-25T08-00-00-000Z",
    at: "2026-09-25T08:00:00.000Z",
    who: { kind: "earlier" },
    current: false,
  },
];

type RestoreFn = (
  v: string,
) => Promise<HubActionResult<{ at: string; dropped: number }>>;

function drawer(
  opts: {
    part?: HistoryPartKey;
    versions?: HistoryVersionView[];
    list?: () => Promise<HubActionResult<HistoryVersionView[]>>;
    restore?: RestoreFn;
    unsavedChanges?: boolean;
    readOnly?: boolean;
  } = {},
) {
  const restore = vi.fn<RestoreFn>(
    opts.restore ??
      (async () => ({
        ok: true as const,
        data: { at: VERSIONS[1]!.at, dropped: 0 },
      })),
  );
  const onRestored = vi.fn();
  const list = vi.fn(
    opts.list ??
      (async () => ({ ok: true as const, data: opts.versions ?? VERSIONS })),
  );
  mounted = mount(
    <ToastRegion>
      <HistoryDrawer
        open
        onClose={() => {}}
        part={opts.part ?? "nav"}
        list={list}
        restore={restore}
        onRestored={onRestored}
        unsavedChanges={opts.unsavedChanges}
        readOnly={opts.readOnly}
        timeZone="UTC"
      />
    </ToastRegion>,
  );
  return { el: document.body, restore, onRestored, list };
}

const ROW1 = "Restore navigation from 27 Sep, 9:05 am";

/** The restore Dialog (it stays mounted; `open` says whether it shows). */
function confirmDialog(root: ParentNode): HTMLDialogElement {
  const d = Array.from(root.querySelectorAll("dialog")).find(
    (x) => button(x, "Keep current") !== null,
  );
  if (!d) throw new Error("restore dialog not found");
  return d;
}

describe("HistoryDrawer", () => {
  it("titles each part", async () => {
    const titles: [HistoryPartKey, string][] = [
      ["nav", "Navigation history"],
      ["footer", "Footer history"],
      ["banner", "Banner history"],
      ["settings", "Site settings history"],
    ];
    for (const [part, title] of titles) {
      const { el } = drawer({ part });
      await flush();
      expect(el.querySelector("h2")?.textContent).toBe(title);
      expect(el.textContent).toContain("We keep the last 10 versions.");
      mounted?.unmount();
      mounted = null;
      document.body.innerHTML = "";
    }
  });

  it("shows 3 skeleton rows while loading", async () => {
    const { el } = drawer({ list: () => new Promise(() => {}) });
    await flush();
    expect(el.querySelectorAll("[data-skeleton-row]")).toHaveLength(3);
  });

  it("shows the empty copy with no versions, and under a lone Current row", async () => {
    const { el } = drawer({ versions: [] });
    await flush();
    expect(el.textContent).toContain(HISTORY_COPY.empty);
    expect(el.querySelectorAll("[data-version]")).toHaveLength(0);
    mounted?.unmount();
    mounted = null;
    document.body.innerHTML = "";
    const again = drawer({ versions: [VERSIONS[0]!] });
    await flush();
    expect(again.el.querySelectorAll("[data-version]")).toHaveLength(1);
    expect(again.el.textContent).toContain(HISTORY_COPY.empty);
  });

  it("marks the Current row with the badge and no Restore; others get labelled Restore", async () => {
    const { el } = drawer();
    await flush();
    const rows = el.querySelectorAll("[data-version]");
    expect(rows).toHaveLength(4);
    expect(rows[0]!.hasAttribute("data-current")).toBe(true);
    expect(rows[0]!.textContent).toContain("Current");
    expect(rows[0]!.querySelector("button")).toBeNull();
    expect(rows[0]!.textContent).toContain("28 Sep, 2:14 pm");
    expect(button(el, ROW1)).not.toBeNull();
    expect(
      button(el, "Restore navigation from 26 Sep, 6:30 pm"),
    ).not.toBeNull();
    expect(
      button(el, "Restore navigation from 25 Sep, 8:00 am"),
    ).not.toBeNull();
  });

  it("renders the who line for all four kinds", async () => {
    const { el } = drawer();
    await flush();
    const rows = el.querySelectorAll("[data-version]");
    expect(rows[0]!.textContent).toContain("Saved by Maria Lopez");
    expect(rows[1]!.textContent).toContain("Saved by CDS support");
    expect(rows[2]!.textContent).toContain("Saved by a former team member");
    expect(rows[3]!.textContent).toContain(
      "Saved before history was turned on",
    );
  });

  it("renders a hostile name as literal text", async () => {
    const evil = '<img src=x onerror="alert(1)">';
    const { el } = drawer({
      versions: [{ ...VERSIONS[0]!, who: { kind: "member", name: evil } }],
    });
    await flush();
    expect(el.textContent).toContain(`Saved by ${evil}`);
    expect(el.querySelector("img")).toBeNull();
  });

  it("opens the dialog with Keep current focused; Keep current and Esc close it without restoring", async () => {
    const { el, restore } = drawer();
    await flush();
    click(button(el, ROW1));
    expect(el.textContent).toContain("Restore your menu from 27 Sep, 9:05 am?");
    expect(el.textContent).toContain(
      "Your site's menu goes back to how it was then. Your current menu is kept in this history, so you can switch back.",
    );
    expect(el.textContent).not.toContain(HISTORY_COPY.unsaved);
    expect(document.activeElement).toBe(button(el, "Keep current"));
    expect(confirmDialog(el).hasAttribute("open")).toBe(true);
    click(button(el, "Keep current"));
    await flush();
    expect(confirmDialog(el).hasAttribute("open")).toBe(false);
    click(button(el, ROW1));
    expect(confirmDialog(el).hasAttribute("open")).toBe(true);
    act(() => {
      confirmDialog(el).dispatchEvent(
        new Event("cancel", { cancelable: true }),
      );
    });
    await flush();
    expect(confirmDialog(el).hasAttribute("open")).toBe(false);
    expect(restore).not.toHaveBeenCalled();
  });

  it("restores once, toasts the exact copy and calls onRestored", async () => {
    const { el, restore, onRestored, list } = drawer();
    await flush();
    click(button(el, ROW1));
    click(button(el, "Restore this version"));
    await flush();
    expect(restore).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledWith("2026-09-27T09-05-00-000Z");
    expect(onRestored).toHaveBeenCalledOnce();
    expect(el.textContent).toContain(
      "Restored. Your site shows the menu from 27 Sep, 9:05 am.",
    );
    expect(list).toHaveBeenCalledTimes(2);
    expect(el.textContent).not.toContain(HISTORY_COPY.dropped);
  });

  it("shows the dropped info alert when something was left out", async () => {
    const { el } = drawer({
      restore: async () => ({
        ok: true,
        data: { at: VERSIONS[1]!.at, dropped: 1 },
      }),
    });
    await flush();
    click(button(el, ROW1));
    click(button(el, "Restore this version"));
    await flush();
    expect(el.textContent).toContain(
      "A button to a pop-up or page you've since deleted was left out.",
    );
  });

  it("shows ERR-RESTORE and keeps the dialog open on failure", async () => {
    const { el, onRestored } = drawer({
      restore: async () => ({
        ok: false,
        code: "internal",
        message: "boom",
      }),
    });
    await flush();
    click(button(el, ROW1));
    click(button(el, "Restore this version"));
    await flush();
    expect(el.textContent).toContain(
      "The restore didn't finish, so nothing changed. Try again in a minute.",
    );
    expect(el.textContent).not.toContain("boom");
    expect(confirmDialog(el).hasAttribute("open")).toBe(true);
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("warns about unsaved changes; settings use the plural copy", async () => {
    const { el, restore } = drawer({
      part: "settings",
      unsavedChanges: true,
    });
    await flush();
    click(button(el, "Restore site settings from 27 Sep, 9:05 am"));
    expect(el.textContent).toContain(
      "Restore your settings from 27 Sep, 9:05 am?",
    );
    expect(el.textContent).toContain(
      "Your site's settings go back to how they were then. Your current settings are kept in this history, so you can switch back. Your unsaved changes on this screen will be lost.",
    );
    click(button(el, "Restore this version"));
    await flush();
    expect(restore).toHaveBeenCalledOnce();
    expect(el.textContent).toContain(
      "Restored. Your site uses the settings from 27 Sep, 9:05 am.",
    );
  });

  describe("page part (DASH-07, 11-25)", () => {
    const PAGE: HistoryVersionView[] = [
      {
        id: "2026-10-09T14-14-00-000Z",
        at: "2026-10-09T14:14:00.000Z",
        who: { kind: "member", name: "Maria Rivera" },
        current: true,
      },
      {
        id: "2026-10-08T09-05-00-000Z",
        at: "2026-10-08T09:05:00.000Z",
        who: { kind: "assembly" },
        current: false,
      },
      {
        id: "2026-10-07T09-05-00-000Z",
        at: "2026-10-07T09:05:00.000Z",
        who: { kind: "support" },
        current: false,
      },
      {
        id: "2026-10-06T09-05-00-000Z",
        at: "2026-10-06T09:05:00.000Z",
        who: { kind: "former" },
        current: false,
      },
      {
        id: "2026-10-05T09-05-00-000Z",
        at: "2026-10-05T09:05:00.000Z",
        who: { kind: "earlier" },
        current: false,
      },
    ];
    const PAGE_ROW1 = "Restore this page from 8 Oct, 9:05 am";

    it("titles the page part and labels who published each version", async () => {
      const { el } = drawer({ part: "page", versions: PAGE });
      await flush();
      expect(el.querySelector("h2")?.textContent).toBe("Page history");
      expect(el.textContent).toContain(
        "We keep the last 10 published versions of this page.",
      );
      const rows = el.querySelectorAll("[data-version]");
      expect(rows[0]!.textContent).toContain("Published by Maria Rivera");
      expect(rows[0]!.textContent).toContain("Current");
      expect(rows[0]!.querySelector("button")).toBeNull();
      expect(rows[1]!.textContent).toContain("Set up by CDS from your answers");
      expect(rows[2]!.textContent).toContain("Published by CDS support");
      expect(rows[3]!.textContent).toContain(
        "Published by a former team member",
      );
      expect(rows[4]!.textContent).toContain(
        "Published before history was turned on",
      );
      expect(button(el, PAGE_ROW1)).not.toBeNull();
    });

    it("shows the page empty copy", async () => {
      const { el } = drawer({ part: "page", versions: [] });
      await flush();
      expect(el.textContent).toContain(
        "No earlier versions yet. Each time you publish, the previous version is kept here.",
      );
    });

    it("asks first with Keep current focused, then restores and publishes by id", async () => {
      const { el, restore, onRestored } = drawer({
        part: "page",
        versions: PAGE,
      });
      await flush();
      click(button(el, PAGE_ROW1));
      expect(el.textContent).toContain("Restore this page from 8 Oct?");
      expect(el.textContent).toContain(
        "This page goes back to how it was then and is published straight away. The current version stays in this history, so you can switch back.",
      );
      expect(document.activeElement).toBe(button(el, "Keep current"));
      click(button(el, "Restore and publish"));
      await flush();
      expect(restore).toHaveBeenCalledWith("2026-10-08T09-05-00-000Z");
      expect(onRestored).toHaveBeenCalledOnce();
      expect(el.textContent).toContain(
        "Restored. Your page shows the version from 8 Oct.",
      );
    });

    it("a restore held by the publish scan toasts the review copy", async () => {
      const { el } = drawer({
        part: "page",
        versions: PAGE,
        restore: async () => ({
          ok: true,
          data: { at: PAGE[1]!.at, dropped: 0, held: true },
        }),
      });
      await flush();
      click(button(el, PAGE_ROW1));
      click(button(el, "Restore and publish"));
      await flush();
      expect(el.textContent).toContain(
        "Restored. It's being reviewed before it shows, usually within 2 business days.",
      );
    });

    it("read only (Viewer): no Restore buttons, the editors-only label", async () => {
      const { el } = drawer({ part: "page", versions: PAGE, readOnly: true });
      await flush();
      expect(el.querySelectorAll("[data-version]")).toHaveLength(5);
      expect(button(el, PAGE_ROW1)).toBeNull();
      expect(el.textContent).not.toContain("Restore");
      expect(el.textContent).toContain("Only editors can restore a version.");
    });
  });
});
