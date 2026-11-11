// OptimisticCommits ordering rules (03-REVIEW WR-C01, CR-C01, CR-C02).
import { describe, expect, it } from "vitest";
import { OptimisticCommits } from "./optimistic";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(base = "base") {
  const shown: (string | null)[] = [];
  let savedCount = 0;
  const t = new OptimisticCommits<string>(base, {
    show: (v) => shown.push(v),
    saved: () => {
      savedCount += 1;
    },
  });
  const saves: Deferred[] = [];
  const save = () => {
    const d = deferred();
    saves.push(d);
    return d.promise;
  };
  return { t, shown, saves, save, saved: () => savedCount };
}

/** Settle state of a promise, without awaiting it forever. */
function track(p: Promise<void>) {
  const state = { value: "pending" as "pending" | "ok" | "failed" };
  p.then(
    () => (state.value = "ok"),
    () => (state.value = "failed"),
  );
  return state;
}

describe("OptimisticCommits", () => {
  it("shows a commit at once and builds the next one on it", async () => {
    const { t, shown, save } = setup();
    void t.commit("A", save).catch(() => {});
    expect(shown).toEqual(["A"]);
    expect(t.latest).toBe("A");
    expect(t.busy).toBe(true);
  });

  it("the newest commit failing reverts to the props and runs onRevert", async () => {
    const { t, shown, saves, save } = setup();
    let reverted = 0;
    const a = track(t.commit("A", save, () => (reverted += 1)));
    await tick();
    saves[0]!.reject(new Error("x"));
    await tick();
    expect(a.value).toBe("failed");
    expect(shown.at(-1)).toBeNull();
    expect(t.latest).toBe("base");
    expect(reverted).toBe(1);
  });

  it("a superseded failure does not roll back a change the newer commit saved", async () => {
    const { t, shown, saves, save, saved } = setup();
    let reverted = 0;
    const a = track(t.commit("A", save, () => (reverted += 1)));
    const b = track(t.commit("AB", save, () => (reverted += 1)));
    await tick();
    saves[0]!.reject(new Error("A failed"));
    await tick();
    // A's failure changes nothing yet: B carries A's change and decides.
    expect(shown.at(-1)).toBe("AB");
    expect(a.value).toBe("pending");
    saves[1]!.resolve();
    await tick();
    expect(b.value).toBe("ok");
    expect(a.value).toBe("ok");
    expect(shown.at(-1)).toBe("AB");
    expect(reverted).toBe(0);
    expect(saved()).toBe(1);
  });

  it("when the newest fails, the view reverts to the newest confirmed value", async () => {
    const { t, shown, saves, save } = setup();
    const a = track(t.commit("A", save));
    const b = track(t.commit("AB", save));
    await tick();
    saves[0]!.resolve();
    await tick();
    saves[1]!.reject(new Error("B failed"));
    await tick();
    expect(a.value).toBe("ok");
    expect(b.value).toBe("failed");
    expect(shown.at(-1)).toBe("A");
    expect(t.latest).toBe("A");
  });

  it("an older success after the newest failed moves the view to it", async () => {
    const { t, shown, saves, save } = setup();
    track(t.commit("A", save));
    track(t.commit("AB", save));
    await tick();
    saves[1]!.reject(new Error("B failed"));
    await tick();
    expect(shown.at(-1)).toBeNull();
    saves[0]!.resolve();
    await tick();
    expect(shown.at(-1)).toBe("A");
  });

  it("a commit whose change was reverted rejects even though a later one saved", async () => {
    const { t, saves, save } = setup();
    const a = track(t.commit("A", save));
    track(t.commit("AB", save));
    await tick();
    saves[1]!.reject(new Error("B failed")); // revert: A's change is off screen now
    await tick();
    const c = track(t.commit("C", save)); // built on the reverted view, without A
    await tick();
    saves[2]!.resolve();
    await tick();
    saves[0]!.reject(new Error("A failed"));
    await tick();
    expect(c.value).toBe("ok");
    expect(a.value).toBe("failed");
  });

  it("new props are adopted only when nothing is in flight", async () => {
    const { t, saves, save } = setup();
    track(t.commit("A", save));
    expect(t.setBase("props-1")).toBe(false);
    expect(t.latest).toBe("A");
    await tick();
    saves[0]!.resolve();
    await tick();
    expect(t.setBase("props-2")).toBe(true);
    expect(t.latest).toBe("props-2");
  });

  it("a save that throws synchronously is a failed commit", async () => {
    const { t } = setup();
    const a = track(
      t.commit("A", () => {
        throw new Error("sync");
      }),
    );
    await tick();
    expect(a.value).toBe("failed");
    expect(t.latest).toBe("base");
  });
});
