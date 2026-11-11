// @vitest-environment jsdom
// 13-42 Task 1 (STAFF-21, D212; 13-UI-SPEC lines 935-958, 1107; T-13-42-01, T-13-42-02): the
// hub rating card. Buttons carry aria-pressed and names with the meaning; taps save in order
// with the latest choice; the link (confirm) mode never saves until Save rating; hidden on
// a non-resolved ticket; read-only under impersonation.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../../test-support/dom";
import { SUPPORT_UI_COPY } from "../copy";
import {
  RATING_CARD_COPY as C,
  RatingCard,
  type RatingCardProps,
  type RatingSaveInput,
} from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function ok(input: RatingSaveInput) {
  return Promise.resolve({
    ok: true as const,
    rating: input.rating,
    comment: input.comment ?? null,
  });
}

function render(p: Partial<RatingCardProps> = {}) {
  const onRate = vi.fn(ok);
  mounted = mount(
    <RatingCard
      status="resolved"
      rating={null}
      comment={null}
      canRate
      onRate={onRate}
      {...p}
    />,
  );
  return { onRate: (p.onRate as typeof onRate | undefined) ?? onRate };
}

const root = () => mounted!.container;
const yes = () => button(root(), C.yesName)!;
const no = () => button(root(), C.noName)!;

describe("RatingCard (13-42 choice 1)", () => {
  it("asks RATING-Q with two pressed-state buttons whose names carry the meaning", () => {
    render();
    expect(root().textContent).toContain("Was this resolved well?");
    expect(yes().getAttribute("aria-pressed")).toBe("false");
    expect(no().getAttribute("aria-pressed")).toBe("false");
    expect(yes().getAttribute("aria-label")).toBe("Yes, resolved well");
    expect(no().getAttribute("aria-label")).toBe("No, not resolved well");
    expect(yes().textContent).toContain("Yes");
    expect(yes().querySelector("svg")).not.toBeNull();
    // No comment box until a choice is made.
    expect(root().querySelector("textarea")).toBeNull();
  });

  it("selecting down then up calls the action twice, in order, ending on up", async () => {
    const { onRate } = render();
    click(no());
    expect(no().getAttribute("aria-pressed")).toBe("true");
    click(yes());
    expect(yes().getAttribute("aria-pressed")).toBe("true");
    expect(no().getAttribute("aria-pressed")).toBe("false");
    await flush();
    expect(onRate).toHaveBeenCalledTimes(2);
    expect(onRate.mock.calls[0]![0]).toEqual({ rating: "down" });
    expect(onRate.mock.calls[1]![0]).toEqual({ rating: "up" });
    expect(root().textContent).toContain(C.thanks);
    expect(root().querySelector("textarea")).not.toBeNull();
  });

  it("a failed save reverts the choice and shows ERR-SAVE", async () => {
    const onRate = vi.fn(async () => ({
      ok: false as const,
      message: SUPPORT_UI_COPY.ERR_SAVE,
    }));
    render({ onRate, rating: "up" });
    expect(yes().getAttribute("aria-pressed")).toBe("true");
    click(no());
    await flush();
    expect(yes().getAttribute("aria-pressed")).toBe("true");
    expect(no().getAttribute("aria-pressed")).toBe("false");
    expect(root().querySelector('[role="alert"]')?.textContent).toBe(
      SUPPORT_UI_COPY.ERR_SAVE,
    );
  });

  it("saves a comment with the current rating and says Comment saved.", async () => {
    const notify = vi.fn();
    const { onRate } = render({ rating: "down", notify });
    typeInto(root().querySelector("textarea"), "  Still slow on mobile. ");
    click(button(root(), C.saveComment));
    await flush();
    expect(onRate).toHaveBeenCalledWith({
      rating: "down",
      comment: "Still slow on mobile.",
    });
    expect(notify).toHaveBeenCalledWith(C.commentSaved);
  });

  it("a comment saved after a failing tap carries the rating the server holds (WR-E13)", async () => {
    let failTap: () => void = () => {};
    const onRate = vi.fn((input: RatingSaveInput) => {
      if (input.comment === undefined && input.rating === "down") {
        return new Promise<{ ok: false; message: string }>((r) => {
          failTap = () => r({ ok: false, message: SUPPORT_UI_COPY.ERR_SAVE });
        });
      }
      return ok(input);
    });
    render({ onRate, rating: "up" });
    click(no());
    typeInto(root().querySelector("textarea"), "Thanks");
    click(button(root(), C.saveComment));
    await flush();
    // The comment waits for the pending tap.
    expect(onRate).toHaveBeenCalledTimes(1);
    failTap();
    await flush();
    expect(onRate).toHaveBeenCalledTimes(2);
    expect(onRate.mock.calls[1]![0]).toEqual({
      rating: "up",
      comment: "Thanks",
    });
    expect(yes().getAttribute("aria-pressed")).toBe("true");
  });

  it("is hidden on a non-resolved ticket and for people who cannot rate", () => {
    render({ status: "in_progress" });
    expect(root().innerHTML).toBe("");
    mounted!.unmount();
    render({ status: "open", rating: "up" });
    expect(root().innerHTML).toBe("");
    mounted!.unmount();
    render({ canRate: false });
    expect(root().innerHTML).toBe("");
  });

  it("closed shows 'You rated this Yes.' or nothing when unrated", () => {
    render({ status: "closed", rating: "up" });
    expect(root().textContent).toBe("You rated this Yes.");
    expect(root().querySelector("button")).toBeNull();
    mounted!.unmount();
    render({ status: "closed", rating: null });
    expect(root().innerHTML).toBe("");
  });

  it("under impersonation is read-only with no write controls", () => {
    const { onRate } = render({
      impersonating: true,
      canRate: false,
      rating: "down",
    });
    expect(root().textContent).toContain(C.impersonating);
    expect(root().textContent).toContain("You rated this No.");
    expect(root().querySelector("button")).toBeNull();
    expect(root().querySelector("textarea")).toBeNull();
    expect(onRate).not.toHaveBeenCalled();
  });

  it("confirm mode (email link) preselects the choice and saves only on Save rating", async () => {
    const onSaved = vi.fn();
    const { onRate } = render({ preselect: "down", onSaved });
    expect(no().getAttribute("aria-pressed")).toBe("true");
    click(yes());
    expect(yes().getAttribute("aria-pressed")).toBe("true");
    typeInto(root().querySelector("textarea"), "Fast fix");
    await flush();
    expect(onRate).not.toHaveBeenCalled();
    click(button(root(), C.saveRating));
    await flush();
    expect(onRate).toHaveBeenCalledTimes(1);
    expect(onRate).toHaveBeenCalledWith({ rating: "up", comment: "Fast fix" });
    expect(onSaved).toHaveBeenCalledWith({ rating: "up", comment: "Fast fix" });
    expect(root().textContent).toContain(C.ratingSaved);
  });
});
