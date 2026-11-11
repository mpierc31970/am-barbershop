// WR-B05: hub chrome navigation asks the registered screen before it leaves.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createNavGuard,
  guardLinkClick,
  isPlainLeftClick,
} from "../app/(platform)/hub/nav-guard";

describe("isPlainLeftClick (IN-R05)", () => {
  const plain = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  it("is true only for an unmodified primary click", () => {
    expect(isPlainLeftClick(plain)).toBe(true);
    expect(isPlainLeftClick({ ...plain, button: 1 })).toBe(false);
    expect(isPlainLeftClick({ ...plain, metaKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...plain, shiftKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...plain, altKey: true })).toBe(false);
  });
});

describe("createNavGuard (WR-B05)", () => {
  it("lets navigation proceed when nothing is registered", () => {
    const guard = createNavGuard();
    const go = vi.fn();
    expect(guard.intercept(go)).toBe(false);
    expect(go).not.toHaveBeenCalled();
  });

  it("hands the navigation to a dirty screen, which runs it later", () => {
    const guard = createNavGuard();
    let pending: (() => void) | null = null;
    guard.register((go) => {
      pending = go;
      return true;
    });
    const go = vi.fn();
    expect(guard.intercept(go)).toBe(true);
    expect(go).not.toHaveBeenCalled();
    (pending as (() => void) | null)?.();
    expect(go).toHaveBeenCalledOnce();
  });

  it("proceeds when the registered screen is clean", () => {
    const guard = createNavGuard();
    guard.register(() => false);
    expect(guard.intercept(() => {})).toBe(false);
  });

  it("unregisters on unmount, and a stale unregister leaves a newer screen in place", () => {
    const guard = createNavGuard();
    const offA = guard.register(() => true);
    const offB = guard.register(() => true);
    offA();
    expect(guard.intercept(() => {})).toBe(true);
    offB();
    expect(guard.intercept(() => {})).toBe(false);
  });
});

describe("hub chrome uses the guard (WR-B05)", () => {
  const read = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), "utf8");

  it("HubShell routes nav links and Sign out through intercept", () => {
    const src = read("../app/(platform)/hub/HubShell.tsx");
    expect(src).toContain("<NavGuardProvider>");
    expect(src.match(/navGuard\.intercept\(/g)?.length).toBe(2);
  });

  it("HubShell lets modifier and middle clicks through before the guard (IN-R05)", () => {
    const src = read("../app/(platform)/hub/HubShell.tsx");
    const early = src.indexOf("if (!isPlainLeftClick(e)) return;");
    expect(early).toBeGreaterThan(-1);
    expect(early).toBeLessThan(src.indexOf("onNavigate?.()"));
  });

  it("Builder registers its leave guard with the hub", () => {
    const src = read(
      "../app/(platform)/hub/website/pages/[pageId]/Builder.tsx",
    );
    expect(src).toContain("useRegisterNavGuard(");
  });
});

describe("guardLinkClick (03-UI-REVIEW Fix 4)", () => {
  const click = (over: Record<string, unknown> = {}) => ({
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...over,
  });

  it("cancels the link when a dirty screen takes over, then runs it on answer", () => {
    const guard = createNavGuard();
    let pending: (() => void) | null = null;
    guard.register((go) => {
      pending = go;
      return true;
    });
    const e = click();
    const go = vi.fn();
    guardLinkClick(e, guard, go);
    expect(e.preventDefault).toHaveBeenCalledOnce();
    expect(go).not.toHaveBeenCalled();
    (pending as (() => void) | null)?.();
    expect(go).toHaveBeenCalledOnce();
  });

  it("lets the link through when the screen is clean", () => {
    const guard = createNavGuard();
    guard.register(() => false);
    const e = click();
    guardLinkClick(e, guard, () => {});
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("never asks for a new-tab click or an already-handled click", () => {
    const guard = createNavGuard();
    const interceptor = vi.fn(() => true);
    guard.register(interceptor);
    guardLinkClick(click({ metaKey: true }), guard, () => {});
    guardLinkClick(click({ button: 1 }), guard, () => {});
    guardLinkClick(click({ defaultPrevented: true }), guard, () => {});
    expect(interceptor).not.toHaveBeenCalled();
  });
});

describe("pop-up editor and Website links use the guard (03-UI-REVIEW Fix 4)", () => {
  const read = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), "utf8");

  it("PopupEditor registers a leave guard with a save dialog", () => {
    const src = read("../app/(platform)/hub/website/PopupEditor.tsx");
    expect(src).toContain("useRegisterNavGuard(");
    expect(src).toContain("Save changes to this pop-up?");
    expect(src).toContain("Save and continue");
    expect(src).toContain("Discard changes");
  });

  it("Website tabs, the pop-up list and the Pop-ups back link go through GuardedLink", () => {
    expect(read("../app/(platform)/hub/website/page.tsx")).toContain(
      "LinkComponent={GuardedLink}",
    );
    expect(read("../app/(platform)/hub/website/PopupList.tsx")).toContain(
      'import { GuardedLink as Link } from "../GuardedLink";',
    );
    expect(read("../app/(platform)/hub/website/PopupsTab.tsx")).toContain(
      "<GuardedLink",
    );
  });
});
