// @vitest-environment jsdom
// 11-32 Task 2: GA4 loads only after statistics consent (DASH-11, CONT-34; T-11-32-02,
// T-11-32-03). No choice -> no script; "all" -> exactly one gtag script for the id; a
// "necessary" choice never injects; a malformed id never reaches the URL.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, type Mounted } from "../../test-support/dom";
import { announceConsent, isGaCookie } from "./consent-state";
import { GaLoader, GA_SCRIPT_ATTR } from "./GaLoader";

let mounted: Mounted | null = null;

function scripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>("script")].filter(
    (s) => s.src.includes("googletagmanager.com"),
  );
}

function clearCookie() {
  document.cookie = "cds_consent=; Path=/; Max-Age=0";
}

beforeEach(() => {
  clearCookie();
  for (const s of scripts()) s.remove();
  const w = window as unknown as Record<string, unknown>;
  delete w.dataLayer;
  delete w.gtag;
  for (const k of Object.keys(w)) if (k.startsWith("ga-disable-")) delete w[k];
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  clearCookie();
});

describe("GaLoader", () => {
  it("injects nothing before any consent choice", async () => {
    mounted = mount(<GaLoader measurementId="G-ABC123" />);
    await act(async () => {});
    expect(scripts()).toHaveLength(0);
    expect((window as unknown as { dataLayer?: unknown }).dataLayer).toBe(
      undefined,
    );
  });

  it("injects exactly one gtag script after statistics consent", async () => {
    mounted = mount(<GaLoader measurementId="G-ABC123" />);
    await act(async () => {
      document.cookie = "cds_consent=all; Path=/";
      announceConsent("all");
    });
    await act(async () => {
      announceConsent("all");
    });
    const s = scripts();
    expect(s).toHaveLength(1);
    expect(s[0]!.src).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-ABC123",
    );
    expect(s[0]!.async).toBe(true);
    expect(s[0]!.hasAttribute(GA_SCRIPT_ATTR)).toBe(true);
    const layer = (window as unknown as { dataLayer: IArguments[] }).dataLayer;
    const config = layer.map((a) => [...a]).find((a) => a[0] === "config");
    expect(config).toEqual(["config", "G-ABC123", { anonymize_ip: true }]);
  });

  it("loads straight away for a returning visitor who chose all", async () => {
    document.cookie = "cds_consent=all; Path=/";
    mounted = mount(<GaLoader measurementId="G-ABC123" />);
    await act(async () => {});
    expect(scripts()).toHaveLength(1);
  });

  it("a declined choice never injects", async () => {
    mounted = mount(<GaLoader measurementId="G-ABC123" />);
    await act(async () => {
      document.cookie = "cds_consent=necessary; Path=/";
      announceConsent("necessary");
    });
    expect(scripts()).toHaveLength(0);
  });

  it("switching to necessary after loading disables GA for the id", async () => {
    document.cookie = "cds_consent=all; Path=/";
    mounted = mount(<GaLoader measurementId="G-ABC123" />);
    await act(async () => {});
    await act(async () => {
      document.cookie = "cds_consent=necessary; Path=/";
      announceConsent("necessary");
    });
    expect(
      (window as unknown as Record<string, unknown>)["ga-disable-G-ABC123"],
    ).toBe(true);
  });

  it("withdrawing consent expires GA's cookies, and leaves others (WR-D06)", async () => {
    document.cookie = "cds_consent=all; Path=/";
    mounted = mount(<GaLoader measurementId="G-ABC123" />);
    await act(async () => {});
    document.cookie = "_ga=GA1.1.123.456; Path=/";
    document.cookie = "_ga_ABC123=GS1.1.789; Path=/";
    document.cookie = "other=keep; Path=/";
    await act(async () => {
      document.cookie = "cds_consent=necessary; Path=/";
      announceConsent("necessary");
    });
    expect(document.cookie).not.toMatch(/(^|; )_ga/);
    expect(document.cookie).toContain("other=keep");
    document.cookie = "other=; Path=/; Max-Age=0";
  });

  it("a returning visitor who chose necessary has stale GA cookies swept (WR-D06)", async () => {
    document.cookie = "cds_consent=necessary; Path=/";
    document.cookie = "_ga=GA1.1.123.456; Path=/";
    mounted = mount(<GaLoader measurementId="G-ABC123" />);
    await act(async () => {});
    expect(document.cookie).not.toMatch(/(^|; )_ga/);
    expect(scripts()).toHaveLength(0);
  });

  it("isGaCookie names only GA's cookies", () => {
    expect(isGaCookie("_ga")).toBe(true);
    expect(isGaCookie("_ga_ABC123")).toBe(true);
    expect(isGaCookie("_gid")).toBe(true);
    expect(isGaCookie("_gat_UA-1")).toBe(true);
    expect(isGaCookie("_gaming")).toBe(false);
    expect(isGaCookie("cds_consent")).toBe(false);
  });

  it("a malformed id never loads", async () => {
    document.cookie = "cds_consent=all; Path=/";
    mounted = mount(<GaLoader measurementId={'G-1"><script>'} />);
    await act(async () => {});
    expect(scripts()).toHaveLength(0);
  });
});
