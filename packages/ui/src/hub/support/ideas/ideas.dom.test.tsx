// @vitest-environment jsdom
// 12-11 Task 2 (CUSTOM-01, D297, D-UI-P12-20..22; 12-UI-SPEC Ideas lines 525-560, a11y 843-844):
// the optimistic vote toggle, the client-side idea search and the similar-ideas panel. Ideas
// are other sites' text: rendered as text, and no site identity beyond the `mine` boolean
// (T-12-11-01, T-12-11-03).
import type { IdeaCard } from "@cds/core/support";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { button, mount, type Mounted } from "../../../test-support/dom";
import { SUPPORT_UI_COPY } from "../copy";
import {
  IdeaList,
  SIMILAR_MAX,
  SimilarIdeas,
  VoteButton,
  type IdeaListProps,
} from "./index";

const TZ = "America/Chicago";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function clickNow(el: Element | null) {
  if (!el) throw new Error("not found");
  act(() => (el as HTMLElement).click());
}

function idea(p: Partial<IdeaCard> = {}): IdeaCard {
  return {
    id: "i1",
    title: "Gift cards in the store",
    description: "Sell vouchers people can give.",
    status: "suggested",
    votes: 12,
    voted: false,
    mine: false,
    created: "2026-10-09T15:00:00Z",
    ...p,
  };
}

describe("VoteButton", () => {
  it("flips aria-pressed and the count immediately and announces it", () => {
    vi.useFakeTimers();
    const onToggle = vi.fn(async () => {});
    mounted = mount(
      <VoteButton
        title="Gift cards"
        count={12}
        voted={false}
        canVote
        onToggle={onToggle}
      />,
    );
    const b = button(mounted.container, "Vote for Gift cards, 12 votes")!;
    expect(b.getAttribute("aria-pressed")).toBe("false");
    expect(b.className).not.toMatch(/hub-accent/);
    clickNow(b);
    const after = mounted.container.querySelector("button")!;
    expect(after.getAttribute("aria-pressed")).toBe("true");
    expect(after.getAttribute("aria-label")).toBe(
      "Remove your vote for Gift cards, 13 votes",
    );
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(
      mounted.container.querySelector('[aria-live="polite"]')!.textContent,
    ).toBe("Voted. 13 votes.");
  });

  it("reverts and shows ERR-VOTE when onToggle rejects", async () => {
    const onError = vi.fn();
    mounted = mount(
      <VoteButton
        title="Gift cards"
        count={12}
        voted={false}
        canVote
        onToggle={() => Promise.reject(new Error("x"))}
        onError={onError}
      />,
    );
    clickNow(mounted.container.querySelector("button"));
    await settle();
    const b = mounted.container.querySelector("button")!;
    expect(b.getAttribute("aria-pressed")).toBe("false");
    expect(b.textContent).toContain("12");
    expect(onError).toHaveBeenCalledWith(SUPPORT_UI_COPY.ERR_VOTE);
  });

  it("shows ERR-VOTE inline when no onError is wired", async () => {
    mounted = mount(
      <VoteButton
        title="Gift cards"
        count={12}
        voted
        canVote
        onToggle={() => Promise.reject(new Error("x"))}
      />,
    );
    clickNow(mounted.container.querySelector("button"));
    await settle();
    expect(mounted.container.textContent).toContain(SUPPORT_UI_COPY.ERR_VOTE);
    expect(
      mounted.container.querySelector("button")!.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("two clicks within 300 ms call onToggle once", async () => {
    vi.useFakeTimers();
    const onToggle = vi.fn(async () => {});
    mounted = mount(
      <VoteButton
        title="Gift cards"
        count={12}
        voted={false}
        canVote
        onToggle={onToggle}
      />,
    );
    clickNow(mounted.container.querySelector("button"));
    await settle();
    advance(100);
    clickNow(mounted.container.querySelector("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(
      mounted.container.querySelector("button")!.getAttribute("aria-pressed"),
    ).toBe("true");
    advance(400);
    clickNow(mounted.container.querySelector("button"));
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it("a second click is ignored until the first save settles (WR-D02)", async () => {
    vi.useFakeTimers();
    let settleFirst!: () => void;
    const onToggle = vi
      .fn<(next: boolean) => Promise<unknown>>()
      .mockReturnValueOnce(
        new Promise<void>((r) => {
          settleFirst = r;
        }),
      )
      .mockResolvedValue(undefined);
    mounted = mount(
      <VoteButton
        title="Gift cards"
        count={12}
        voted={false}
        canVote
        onToggle={onToggle}
      />,
    );
    clickNow(mounted.container.querySelector("button"));
    advance(400); // past the debounce, save still in flight
    clickNow(mounted.container.querySelector("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    settleFirst();
    await settle();
    clickNow(mounted.container.querySelector("button"));
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it("viewers get a plain count box, no button, sr '12 votes'", () => {
    mounted = mount(
      <VoteButton
        title="Gift cards"
        count={12}
        voted={false}
        canVote={false}
        onToggle={vi.fn()}
      />,
    );
    expect(mounted.container.querySelector("button")).toBeNull();
    expect(mounted.container.querySelector(".sr-only")!.textContent).toBe(
      "12 votes",
    );
  });

  it("compact is 44px, default 56px", () => {
    mounted = mount(
      <>
        <VoteButton
          title="A"
          count={1}
          voted={false}
          canVote
          onToggle={vi.fn()}
        />
        <VoteButton
          title="B"
          count={1}
          voted={false}
          canVote
          compact
          onToggle={vi.fn()}
        />
      </>,
    );
    const [a, b] = Array.from(mounted.container.querySelectorAll("button"));
    expect(a!.className).toMatch(/h-14 w-14/);
    expect(b!.className).toMatch(/h-11 w-11/);
    expect(a!.getAttribute("aria-label")).toBe("Vote for A, 1 vote");
  });
});

function ideaList(p: Partial<IdeaListProps> = {}) {
  const props: IdeaListProps = {
    ideas: [
      idea(),
      idea({
        id: "i2",
        title: "Online waitlist",
        description: "Let people join a list.",
        mine: true,
        votes: 3,
      }),
      idea({
        id: "i3",
        title: "Printable menus",
        description: "PDF menus.",
        status: "planned",
      }),
    ],
    query: "",
    status: "suggested",
    canVote: true,
    onToggle: vi.fn(async () => {}),
    timeZone: TZ,
    ...p,
  };
  mounted = mount(<IdeaList {...props} />);
  return { props, c: mounted.container };
}

describe("IdeaList", () => {
  it("lists the status's ideas in the given order", () => {
    const { c } = ideaList();
    const rows = Array.from(c.querySelectorAll("[data-idea]")).map((r) =>
      r.getAttribute("data-idea"),
    );
    expect(rows).toEqual(["i1", "i2"]);
  });

  it("query 'gift' filters to matching titles", () => {
    const { c } = ideaList({ query: "gift" });
    const rows = Array.from(c.querySelectorAll("[data-idea]"));
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toContain("Gift cards in the store");
  });

  it("shows 'You suggested this' only on mine", () => {
    const { c } = ideaList();
    expect(c.querySelector('[data-idea="i1"]')!.textContent).not.toContain(
      "You suggested this",
    );
    expect(c.querySelector('[data-idea="i2"]')!.textContent).toContain(
      "Suggested 9 Oct · You suggested this",
    );
  });

  it("no match shows IDEAS-NOMATCH with Suggest it", () => {
    const { c } = ideaList({ query: "zebra" });
    expect(c.textContent).toContain('No ideas match "zebra".');
    const a = Array.from(c.querySelectorAll("a")).find(
      (x) => x.textContent === "Suggest it",
    );
    expect(a?.getAttribute("href")).toBe(
      "/hub/support/tickets/new?type=suggestion",
    );
  });

  it("an empty status shows its empty copy", () => {
    const { c } = ideaList({ status: "built" });
    expect(c.textContent).toContain(SUPPORT_UI_COPY.IDEAS_EMPTY.built);
  });

  it("renders the merged notice and highlights a row", () => {
    const { c } = ideaList({ mergedNotice: true, highlightId: "i2" });
    expect(c.textContent).toContain(
      "This idea was merged with a similar one. Your vote carried over.",
    );
    expect(
      c.querySelector('[data-idea="i2"]')!.hasAttribute("data-highlight"),
    ).toBe(true);
  });

  it("voting calls onToggle with the idea id", () => {
    const { c, props } = ideaList();
    clickNow(button(c, "Vote for Gift cards in the store, 12 votes"));
    expect(props.onToggle).toHaveBeenCalledWith("i1", true);
  });

  it("idea text renders as text, never HTML", () => {
    const { c } = ideaList({
      ideas: [idea({ title: "<img src=x>", description: "<b>hi</b>" })],
    });
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("b")).toBeNull();
  });
});

describe("SimilarIdeas", () => {
  const many = [
    idea({ id: "a", title: "Gift cards" }),
    idea({ id: "b", title: "Gift wrapping" }),
    idea({ id: "c", title: "Gift vouchers by email" }),
    idea({ id: "d", title: "Gift registry" }),
    idea({ id: "e", title: "Online waitlist" }),
  ];

  it("shows nothing under 3 characters", () => {
    vi.useFakeTimers();
    mounted = mount(
      <SimilarIdeas query="gi" ideas={many} onToggle={vi.fn()} canVote />,
    );
    advance(300);
    expect(mounted.container.textContent).not.toContain(
      SUPPORT_UI_COPY.SIMILAR_HEAD,
    );
    expect(
      mounted.container.querySelector('[aria-live="polite"]'),
    ).not.toBeNull();
  });

  it("with 'gift' shows at most 3 rows after the debounce", () => {
    vi.useFakeTimers();
    mounted = mount(
      <SimilarIdeas query="gift" ideas={many} onToggle={vi.fn()} canVote />,
    );
    expect(mounted.container.querySelectorAll("[data-similar]").length).toBe(0);
    advance(250);
    const rows = mounted.container.querySelectorAll("[data-similar]");
    expect(rows.length).toBe(SIMILAR_MAX);
    expect(SIMILAR_MAX).toBe(3);
    expect(mounted.container.textContent).toContain(
      SUPPORT_UI_COPY.SIMILAR_HEAD,
    );
    const compact = mounted.container.querySelector("[data-similar] button")!;
    expect(compact.className).toMatch(/h-11 w-11/);
    // WR-D06: only the count is live; the rows sit outside any live region.
    expect(
      mounted.container.querySelector("[data-similar-count]")!.textContent,
    ).toBe("3 similar ideas");
    expect(rows[0]!.closest("[aria-live]")).toBeNull();
  });

  it("votes in place and reports the title", () => {
    vi.useFakeTimers();
    const onToggle = vi.fn(async () => {});
    const onVoted = vi.fn();
    mounted = mount(
      <SimilarIdeas
        query="waitlist"
        ideas={many}
        onToggle={onToggle}
        onVoted={onVoted}
        canVote
      />,
    );
    advance(250);
    clickNow(button(mounted.container, "Vote for Online waitlist, 12 votes"));
    expect(onToggle).toHaveBeenCalledWith("e", true);
  });
});
