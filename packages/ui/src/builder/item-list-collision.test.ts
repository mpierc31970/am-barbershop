// ItemListEditor drop targets (03-REVIEW WR-C03).
import { describe, expect, it } from "vitest";
import type { ClientRect, CollisionDetection } from "@dnd-kit/core";
import { itemListCollision } from "./ItemListEditor";

type Args = Parameters<CollisionDetection>[0];

function rect(top: number, height: number): ClientRect {
  return {
    top,
    left: 0,
    width: 300,
    height,
    bottom: top + height,
    right: 300,
  };
}

function container(id: string, type: string, r: ClientRect) {
  return {
    id,
    key: id,
    data: { current: { type } },
    disabled: false,
    node: { current: null },
    rect: { current: r },
  };
}

function args(
  entries: { id: string; type: string; rect: ClientRect }[],
  pointerRect: ClientRect,
): Args {
  const droppableContainers = entries.map((e) =>
    container(e.id, e.type, e.rect),
  );
  return {
    active: {
      id: "dragged",
      data: { current: { type: "item" } },
      rect: { current: { initial: null, translated: null } },
    },
    collisionRect: pointerRect,
    droppableRects: new Map(entries.map((e) => [e.id, e.rect])),
    droppableContainers,
    pointerCoordinates: null,
  } as unknown as Args;
}

describe("itemListCollision", () => {
  it("resolves a mid-list drop to the nearest row, never the list container", () => {
    // Rows at 0, 100, 200; the container spans them all, centre 150 (row 2's edge).
    const entries = [
      { id: "list", type: "column-drop", rect: rect(0, 300) },
      { id: "r1", type: "item", rect: rect(0, 100) },
      { id: "r2", type: "item", rect: rect(100, 100) },
      { id: "r3", type: "item", rect: rect(200, 100) },
    ];
    const hits = itemListCollision(args(entries, rect(100, 100)));
    expect(hits[0]?.id).toBe("r2");
    expect(hits.some((h) => h.id === "list")).toBe(false);
  });

  it("falls back to the container when the list has no rows", () => {
    const entries = [{ id: "list", type: "column-drop", rect: rect(0, 100) }];
    const hits = itemListCollision(args(entries, rect(10, 40)));
    expect(hits[0]?.id).toBe("list");
  });
});
