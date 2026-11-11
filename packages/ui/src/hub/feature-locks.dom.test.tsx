// @vitest-environment jsdom
// P10 feature locks (10-07; BILL-04, D42, 10-UI-SPEC "Feature locks", LOCK-INLINE,
// LOCK-PANEL, D-UI-P10-17): both components render from a server-computed set and never fetch.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { mount, type Mounted } from "../test-support/dom";
import { FeatureGuard } from "./FeatureGuard";
import { FeatureInline } from "./FeatureInline";
import * as hub from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const NONE: ReadonlySet<string> = new Set<string>();
const PRO: ReadonlySet<string> = new Set(["builder-pro"]);
const PANEL =
  "Add Builder Pro to use this. Everything you set up here is kept if you ever remove it.";

describe("FeatureGuard", () => {
  it("renders children only when entitled", () => {
    mounted = mount(
      <FeatureGuard
        feature="builder-pro"
        entitlements={PRO}
        featureName="Builder Pro"
        canBuy
      >
        <p>Pro table settings</p>
      </FeatureGuard>,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("Pro table settings");
    expect(text).not.toContain("Part of Builder Pro");
  });

  it("renders the default lock panel with an owner link, never the children", () => {
    mounted = mount(
      <FeatureGuard
        feature="builder-pro"
        entitlements={NONE}
        featureName="Builder Pro"
        canBuy
      >
        <p>Pro table settings</p>
      </FeatureGuard>,
    );
    const c = mounted.container;
    expect(c.textContent).not.toContain("Pro table settings");
    expect(c.textContent).toContain("Part of Builder Pro");
    expect(c.textContent).toContain(PANEL);
    expect(c.querySelector("svg")).not.toBeNull();
    const link = c.querySelector("a");
    expect(link?.textContent).toBe("Add Builder Pro");
    expect(link?.getAttribute("href")).toBe("/hub/add-ons/builder-pro");
    expect(c.querySelector("section")?.className).toContain("bg-hub-surface-2");
    expect(c.innerHTML).not.toMatch(/blur|opacity-/);
  });

  it("shows no link to a non-owner and honours buyHref", () => {
    mounted = mount(
      <FeatureGuard
        feature="builder-pro"
        entitlements={NONE}
        featureName="Builder Pro"
        canBuy={false}
        buyHref="/x"
      >
        <p>child</p>
      </FeatureGuard>,
    );
    expect(mounted.container.querySelector("a")).toBeNull();
    mounted.unmount();
    mounted = mount(
      <FeatureGuard
        feature="builder-pro"
        entitlements={NONE}
        featureName="Builder Pro"
        canBuy
        buyHref="/hub/add-ons/builder-pro?from=forms"
      >
        <p>child</p>
      </FeatureGuard>,
    );
    expect(mounted.container.querySelector("a")?.getAttribute("href")).toBe(
      "/hub/add-ons/builder-pro?from=forms",
    );
  });

  it("a custom fallback replaces the panel", () => {
    mounted = mount(
      <FeatureGuard
        feature="builder-pro"
        entitlements={NONE}
        featureName="Builder Pro"
        canBuy
        fallback={<p>Custom lock</p>}
      >
        <p>child</p>
      </FeatureGuard>,
    );
    expect(mounted.container.textContent).toBe("Custom lock");
  });
});

describe("FeatureInline", () => {
  it("passes locked=true and shows the badge plus the owner link", () => {
    const seen: boolean[] = [];
    mounted = mount(
      <FeatureInline
        feature="builder-pro"
        entitlements={NONE}
        featureName="Builder Pro"
        canBuy
      >
        {(locked) => {
          seen.push(locked);
          return <button disabled={locked}>File upload</button>;
        }}
      </FeatureInline>,
    );
    const c = mounted.container;
    expect(seen.every((l) => l)).toBe(true);
    expect(c.querySelector("button")?.disabled).toBe(true);
    expect(c.textContent).toContain("Part of Builder Pro");
    const link = c.querySelector("a");
    expect(link?.textContent).toBe("Add Builder Pro");
    expect(link?.getAttribute("href")).toBe("/hub/add-ons/builder-pro");
    expect(c.textContent).not.toContain("Ask your site owner");
  });

  it("non-owners read the ask-owner line, no link", () => {
    mounted = mount(
      <FeatureInline
        feature="builder-pro"
        entitlements={NONE}
        featureName="Builder Pro"
        canBuy={false}
      >
        {(locked) => <button disabled={locked}>File upload</button>}
      </FeatureInline>,
    );
    const c = mounted.container;
    expect(c.querySelector("a")).toBeNull();
    expect(c.textContent).toContain("Ask your site owner to add Builder Pro.");
  });

  it("entitled: locked=false and no badge", () => {
    mounted = mount(
      <FeatureInline
        feature="builder-pro"
        entitlements={PRO}
        featureName="Builder Pro"
        canBuy
      >
        {(locked) => <button disabled={locked}>File upload</button>}
      </FeatureInline>,
    );
    const c = mounted.container;
    expect(c.querySelector("button")?.disabled).toBe(false);
    expect(c.textContent).not.toContain("Part of Builder Pro");
    expect(c.querySelector("a")).toBeNull();
  });
});

describe("no client fetch (CONTEXT A3)", () => {
  it("neither source fetches or loads in an effect", () => {
    for (const f of ["./FeatureGuard.tsx", "./FeatureInline.tsx"]) {
      const src = readFileSync(
        fileURLToPath(new URL(f, import.meta.url)),
        "utf8",
      );
      expect(src).not.toMatch(/fetch\(|useEffect/);
    }
  });

  it("is exported from the hub barrel", () => {
    expect(hub.FeatureGuard).toBe(FeatureGuard);
    expect(hub.FeatureInline).toBe(FeatureInline);
  });
});
