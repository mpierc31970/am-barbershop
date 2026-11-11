// WR-B02: a rejected Server Action request becomes a failed result, so every builder
// handler reverts its optimistic state through its `!res.ok` branch.
import { ERR_SAVE_COPY } from "@cds/ui/builder";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { callAction } from "../lib/call-action";

describe("callAction (WR-B02)", () => {
  it("passes a resolved result through untouched", async () => {
    const ok = { ok: true as const, data: 1 };
    expect(await callAction(async () => ok)).toBe(ok);
    const failed = { ok: false as const, code: "not_found", message: "gone" };
    expect(await callAction(async () => failed)).toBe(failed);
  });

  it("turns a rejected request into the ERR-SAVE failed result", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await callAction<number>(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    spy.mockRestore();
    expect(r).toEqual({
      ok: false,
      code: "save_failed",
      message: ERR_SAVE_COPY,
    });
  });

  it("covers a synchronous throw from the call", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await callAction<number>(() => {
      throw new Error("boom");
    });
    spy.mockRestore();
    expect(r.ok).toBe(false);
  });
});

describe("Builder calls every Server Action through callAction (WR-B02)", () => {
  it("has no bare action call", () => {
    const src = readFileSync(
      new URL(
        "../app/(platform)/hub/website/pages/[pageId]/Builder.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const calls = [...src.matchAll(/(\S+)\s*(\w+Action)\(/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const [, before, name] of calls) {
      // publishPageAction runs inside publish()'s own try/catch.
      if (name === "callAction" || name === "publishPageAction") continue;
      expect(`${before} ${name}`).toMatch(/^=> /);
    }
  });
});
