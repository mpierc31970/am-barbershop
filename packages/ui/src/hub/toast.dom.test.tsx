// @vitest-environment jsdom
// Toast pause and focus behaviour in a real DOM (03-REVIEW WR-C12).
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastRegion, UNDO_TOAST_MS, useToast } from "./Toast";
import { button, click, mount, type Mounted } from "../test-support/dom";

let mounted: Mounted | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

function Trigger() {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast.show({
          message: "Image deleted.",
          action: { label: "Undo", onClick: () => {} },
        })
      }
    >
      Delete
    </button>
  );
}

function setup() {
  mounted = mount(
    <ToastRegion>
      <Trigger />
    </ToastRegion>,
  );
  const trigger = button(mounted.container, "Delete")!;
  trigger.focus();
  click(trigger);
  const undo = button(mounted.container, "Undo")!;
  const toastEl = undo.parentElement!;
  return { trigger, undo, toastEl };
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function focusMove(to: HTMLElement) {
  act(() => {
    to.focus();
  });
}

describe("WR-C12: the Undo toast and keyboard focus", () => {
  it("stays open while Undo has focus, even after the mouse passes over and leaves", () => {
    const { undo, toastEl } = setup();
    focusMove(undo);
    act(() => {
      toastEl.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }),
      );
      toastEl.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });
    advance(UNDO_TOAST_MS * 3);
    expect(button(mounted!.container, "Undo")).not.toBeNull();
  });

  it("moving focus from Undo to Dismiss keeps it paused", () => {
    const { undo } = setup();
    focusMove(undo);
    focusMove(button(mounted!.container, "Dismiss")!);
    advance(UNDO_TOAST_MS * 3);
    expect(button(mounted!.container, "Undo")).not.toBeNull();
  });

  it("dismissing a focused toast returns focus to where it came from", () => {
    const { trigger, undo } = setup();
    focusMove(undo);
    click(button(mounted!.container, "Dismiss"));
    expect(button(mounted!.container, "Undo")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("a focused toast dropped by the 3-toast cap returns focus (IN-R04)", () => {
    const { trigger, undo } = setup();
    focusMove(undo);
    // Three more toasts evict the focused (oldest) one without calling close().
    act(() => {
      for (let i = 0; i < 3; i += 1) trigger.click();
    });
    expect(undo.isConnected).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("focus that entered with no relatedTarget goes back to the element that showed the toast (IN-R04)", () => {
    const { trigger, undo } = setup();
    // F6 or a landmark jump: focus arrives with relatedTarget null.
    act(() => {
      trigger.blur();
    });
    focusMove(undo);
    click(button(mounted!.container, "Dismiss"));
    expect(button(mounted!.container, "Undo")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("without focus or hover it closes after 8s", () => {
    setup();
    advance(UNDO_TOAST_MS + 10);
    expect(button(mounted!.container, "Undo")).toBeNull();
  });
});
