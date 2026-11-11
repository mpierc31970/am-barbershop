// @vitest-environment jsdom
// IndexingTable (13-39; STAFF-17, D190; 13-UI-SPEC "Indexing" lines 911-915; T-13-39-01).
import { act, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastRegion } from "../../hub/Toast";
import { flush, mount, type Mounted } from "../../test-support/dom";
import { StaffActionProvider } from "../dialogs";
import {
  INDEXING_COPY,
  IndexingTable,
  indexingLiveCount,
  indexingPingText,
  type IndexingRowView,
} from "./index";

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
});

function row(over: Partial<IndexingRowView> = {}): IndexingRowView {
  return {
    orgId: "aaaaaaaaaaaaaaa",
    business: "Rivera Bakery",
    host: "riverabakery.com",
    live: true,
    demo: false,
    lastPingAt: "2026-10-02T12:00:00.000Z",
    lastPingResult: "logged",
    sitemapStatus: "ok",
    pagesIndexed: null,
    lastResubmitAt: null,
    ...over,
  };
}

const ROWS: IndexingRowView[] = [
  row(),
  row({
    orgId: "bbbbbbbbbbbbbbb",
    business: "Oak Studio",
    host: null,
    sitemapStatus: "unchecked",
    lastPingAt: null,
    lastPingResult: null,
  }),
  row({
    orgId: "ccccccccccccccc",
    business: "Bella's Salon",
    demo: true,
    sitemapStatus: "error",
    pagesIndexed: 12,
  }),
];

function withProviders(ui: ReactNode) {
  return (
    <ToastRegion>
      <StaffActionProvider
        requestStepUpCode={vi.fn()}
        confirmStepUp={vi.fn()}
        navigate={vi.fn()}
      >
        {ui}
      </StaffActionProvider>
    </ToastRegion>
  );
}

describe("IndexingTable", () => {
  it("renders sitemap words, '—' pages with the Search Console title and ping text", () => {
    mounted = mount(
      withProviders(
        <IndexingTable
          rows={ROWS}
          lastRunAt="2026-10-04T06:00:00.000Z"
          resubmit={vi.fn()}
        />,
      ),
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("Not checked");
    expect(text).toContain("Error");
    expect(text).toContain("2 Oct · logged (stand-in)");
    expect(text).toContain("Never");
    expect(text).toContain("Runs by itself every Sunday. Last run 4 Oct.");
    const dash = mounted.container.querySelector(
      `span[title="${INDEXING_COPY.pagesTitle}"]`,
    );
    expect(dash?.textContent).toBe("—");
    // Site view: no Resubmit all without the action.
    expect(text).not.toContain(INDEXING_COPY.resubmitAll);
  });

  it("Resubmit now calls the action with the org id and toasts its message", async () => {
    const resubmit = vi.fn(async () => ({
      ok: true as const,
      data: { message: "Resubmitted Rivera Bakery." },
    }));
    mounted = mount(
      withProviders(
        <IndexingTable rows={ROWS} lastRunAt={null} resubmit={resubmit} />,
      ),
    );
    expect(mounted.container.textContent).toContain("Not run yet.");
    const btn = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Resubmit now: Rivera Bakery"]',
    )!;
    act(() => btn.click());
    await flush();
    expect(resubmit).toHaveBeenCalledWith("aaaaaaaaaaaaaaa");
    expect(document.body.textContent).toContain("Resubmitted Rivera Bakery.");
  });

  it("an ended session toasts nothing (WR-E11)", async () => {
    const resubmit = vi.fn(async () => ({
      ok: false as const,
      code: "session_ended",
      message: "Your staff session ended.",
    }));
    mounted = mount(
      withProviders(
        <IndexingTable rows={ROWS} lastRunAt={null} resubmit={resubmit} />,
      ),
    );
    const btn = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Resubmit now: Rivera Bakery"]',
    )!;
    act(() => btn.click());
    await flush();
    expect(resubmit).toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(
      "Your staff session ended.",
    );
  });

  it("Resubmit all opens the dialog with the live count (demo skipped); confirm calls the action", async () => {
    const all = vi.fn(async () => ({
      ok: true as const,
      data: { message: "Resubmitted 2 live sites. 0 sitemap errors." },
    }));
    mounted = mount(
      withProviders(
        <IndexingTable
          rows={ROWS}
          lastRunAt={null}
          resubmit={vi.fn()}
          resubmitAll={all}
        />,
      ),
    );
    const open = [...mounted.container.querySelectorAll("button")].find(
      (b) => b.textContent === INDEXING_COPY.resubmitAll,
    )!;
    act(() => open.click());
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("Resubmit 2 live sites?");
    expect(dialog.textContent).toContain("The demo site is skipped.");
    expect(dialog.textContent).toContain("Not now");
    const confirm = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "Resubmit all",
    )!;
    act(() => confirm.click());
    await flush();
    expect(all).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      "Resubmitted 2 live sites. 0 sitemap errors.",
    );
  });

  it("no live sites: Resubmit all is disabled", () => {
    mounted = mount(
      withProviders(
        <IndexingTable
          rows={[row({ live: false })]}
          lastRunAt={null}
          resubmit={vi.fn()}
          resubmitAll={vi.fn()}
        />,
      ),
    );
    const open = [...mounted.container.querySelectorAll("button")].find(
      (b) => b.textContent === INDEXING_COPY.resubmitAll,
    )!;
    expect(open.disabled).toBe(true);
    expect(mounted.container.textContent).toContain(INDEXING_COPY.noLiveSites);
  });

  it("helpers", () => {
    expect(indexingLiveCount(ROWS)).toBe(2);
    expect(indexingPingText(row({ lastPingResult: "skipped" }))).toBe(
      "2 Oct · skipped (demo)",
    );
  });
});
