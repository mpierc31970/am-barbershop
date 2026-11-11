// @vitest-environment jsdom
// 12-REVIEW IN-C04: Apply my changes on a live-save editor says "saved" only when every held
// change was saved as is; when a screened writer held one for review, the toast says so (the
// editor's own held copy when given). The builder keeps its draft copy.
import { ToastRegion } from "@cds/ui/hub";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

const held = vi.hoisted(() => ({
  applyHeldDraftAction: vi.fn(),
  discardHeldDraftAction: vi.fn(),
  undoDiscardHeldDraftAction: vi.fn(),
}));
vi.mock("../app/actions/held-drafts", () => held);

const { EditorLockPanel, HELD_COPY } =
  await import("../app/(platform)/hub/website/EditorLock");

const STATE = {
  locked: null,
  held: [
    { id: "h2", savedAt: "2026-10-12T19:14:00Z", locked: false },
    { id: "h1", savedAt: "2026-10-12T19:10:00Z", locked: false },
  ],
};

let mounted: Mounted | null = null;

function render(props: Partial<Parameters<typeof EditorLockPanel>[0]> = {}) {
  mounted = mount(
    <ToastRegion>
      <EditorLockPanel
        state={STATE}
        target="footer"
        panelId="footer-lock"
        {...props}
      />
    </ToastRegion>,
  );
  return mounted.container;
}

function applyButton(c: HTMLElement): HTMLButtonElement {
  return [...c.querySelectorAll("button")].find(
    (b) => b.textContent === "Apply my changes",
  )!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("EditorLockPanel Apply (IN-C04)", () => {
  it("all saved as is: Your changes are saved.", async () => {
    held.applyHeldDraftAction.mockResolvedValue({
      ok: true,
      data: { kind: "site_part", held: false },
    });
    const c = render();
    click(applyButton(c));
    await flush(10);
    expect(held.applyHeldDraftAction.mock.calls.map((a) => a[0])).toEqual([
      "h1",
      "h2",
    ]);
    expect(document.body.textContent).toContain(HELD_COPY.appliedLive);
  });

  it("one held for review: the editor's held copy, not 'saved'", async () => {
    held.applyHeldDraftAction
      .mockResolvedValueOnce({
        ok: true,
        data: { kind: "site_part", held: false },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { kind: "site_part", held: true },
      });
    const c = render({ heldCopy: "Your banner is being reviewed." });
    click(applyButton(c));
    await flush(10);
    expect(document.body.textContent).toContain(
      "Your banner is being reviewed.",
    );
    expect(document.body.textContent).not.toContain(HELD_COPY.appliedLive);
  });

  it("held with no editor copy: the generic held copy", async () => {
    held.applyHeldDraftAction.mockResolvedValue({
      ok: true,
      data: { kind: "addon_record", held: true },
    });
    const c = render({ target: "add-on" });
    click(applyButton(c));
    await flush(10);
    expect(document.body.textContent).toContain(HELD_COPY.appliedHeld);
  });

  it("the builder keeps its draft copy", async () => {
    held.applyHeldDraftAction.mockResolvedValue({
      ok: true,
      data: { kind: "section", held: false },
    });
    const c = render({ applies: "draft", target: "page" });
    click(applyButton(c));
    await flush(10);
    expect(document.body.textContent).toContain(HELD_COPY.appliedDraft);
  });
});
