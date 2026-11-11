// @vitest-environment jsdom
// 11-31 Task 3: the cookieless beacon island (DASH-11, DASH-15; Pitfall 10; T-11-31-03).
// Nothing is sent before idle; then one view (or a 404 marker); vitals once on hide; a
// conversion on `cds:form-submitted`. No cookie is ever written.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../test-support/dom";

type Metric = { value: number };
const vitals = vi.hoisted(() => ({
  lcp: null as null | ((m: Metric) => void),
  inp: null as null | ((m: Metric) => void),
  cls: null as null | ((m: Metric) => void),
}));
vi.mock("web-vitals", () => ({
  onLCP: (cb: (m: Metric) => void) => {
    vitals.lcp = cb;
  },
  onINP: (cb: (m: Metric) => void) => {
    vitals.inp = cb;
  },
  onCLS: (cb: (m: Metric) => void) => {
    vitals.cls = cb;
  },
}));

const { Beacon, FORM_SUBMITTED_EVENT, deviceClass } = await import("./Beacon");

let mounted: Mounted | null = null;
let idle: (() => void)[] = [];
let sent: { url: string; body: Record<string, unknown> }[] = [];
let cookieWrites = 0;
let visibility: DocumentVisibilityState = "visible";

function setUrl(path: string) {
  window.history.replaceState(null, "", path);
}

async function runIdle() {
  await act(async () => {
    const q = idle;
    idle = [];
    for (const cb of q) cb();
    // Let the dynamic import of web-vitals settle.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  idle = [];
  sent = [];
  cookieWrites = 0;
  visibility = "visible";
  vitals.lcp = vitals.inp = vitals.cls = null;
  sessionStorage.clear();
  document.body.innerHTML = "";
  Object.defineProperty(window, "requestIdleCallback", {
    configurable: true,
    writable: true,
    value: (cb: () => void) => {
      idle.push(cb);
      return idle.length;
    },
  });
  Object.defineProperty(window, "cancelIdleCallback", {
    configurable: true,
    writable: true,
    value: () => {},
  });
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    writable: true,
    value: (url: string, data: string) => {
      sent.push({ url, body: JSON.parse(data) as Record<string, unknown> });
      return true;
    },
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => (desc?.get ? desc.get.call(document) : ""),
    set: () => {
      cookieWrites++;
    },
  });
  Object.defineProperty(document, "referrer", {
    configurable: true,
    get: () => "",
  });
  setUrl("/");
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("Beacon", () => {
  it("sends nothing before idle, then one view with path, utm source and device", async () => {
    setUrl("/services?utm_source=Instagram&utm_medium=social");
    mounted = mount(<Beacon />);
    expect(sent).toHaveLength(0);
    await runIdle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("/api/m");
    expect(sent[0]!.body).toMatchObject({
      t: "v",
      p: "/services",
      us: "Instagram",
      um: "social",
    });
    expect(["m", "t", "c"]).toContain(sent[0]!.body.d);
    expect(cookieWrites).toBe(0);
    // The landing source is kept for this tab only (sessionStorage, not a cookie).
    expect(JSON.parse(sessionStorage.getItem("cds_src")!)).toMatchObject({
      us: "Instagram",
    });
  });

  it("sends the referrer host only, never a full URL", async () => {
    Object.defineProperty(document, "referrer", {
      configurable: true,
      get: () => "https://l.facebook.com/some/path?fbclid=abc",
    });
    mounted = mount(<Beacon />);
    await runIdle();
    expect(sent[0]!.body.r).toBe("l.facebook.com");
  });

  it("keeps the landing source on later pages of the same visit", async () => {
    sessionStorage.setItem(
      "cds_src",
      JSON.stringify({ r: "", us: "instagram", um: "" }),
    );
    Object.defineProperty(document, "referrer", {
      configurable: true,
      get: () => `${window.location.origin}/`,
    });
    setUrl("/about");
    mounted = mount(<Beacon />);
    await runIdle();
    expect(sent[0]!.body).toMatchObject({
      t: "v",
      p: "/about",
      us: "instagram",
    });
  });

  it("sends one vitals beacon on hide with the collected values", async () => {
    mounted = mount(<Beacon />);
    await runIdle();
    expect(vitals.lcp).not.toBeNull();
    vitals.lcp!({ value: 1800 });
    vitals.cls!({ value: 0.03 });
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    const w = sent.filter((s) => s.body.t === "w");
    expect(w).toHaveLength(1);
    expect(w[0]!.body).toMatchObject({ p: "/", lcp: 1800, cls: 0.03 });
    expect(w[0]!.body.inp).toBeUndefined();
  });

  it("sends no vitals beacon when nothing was collected", async () => {
    mounted = mount(<Beacon />);
    await runIdle();
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sent.filter((s) => s.body.t === "w")).toHaveLength(0);
  });

  it("sends a not-found marker instead of a view on the 404 page", async () => {
    setUrl("/no-such-page");
    const marker = document.createElement("span");
    marker.setAttribute("data-cds-404", "");
    document.body.appendChild(marker);
    mounted = mount(<Beacon />);
    await runIdle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ t: "n", p: "/no-such-page" });
  });

  it("sends a conversion when a form submit succeeds", async () => {
    sessionStorage.setItem(
      "cds_src",
      JSON.stringify({ r: "", us: "tiktok", um: "" }),
    );
    setUrl("/contact");
    mounted = mount(<Beacon />);
    await runIdle();
    window.dispatchEvent(new CustomEvent(FORM_SUBMITTED_EVENT));
    const c = sent.filter((s) => s.body.t === "c");
    expect(c).toHaveLength(1);
    expect(c[0]!.body).toMatchObject({ p: "/contact", us: "tiktok" });
    expect(cookieWrites).toBe(0);
  });

  it("classifies devices by viewport width", () => {
    expect(deviceClass(390)).toBe("m");
    expect(deviceClass(820)).toBe("t");
    expect(deviceClass(1440)).toBe("c");
  });

  it("does nothing when sendBeacon is missing", async () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    mounted = mount(<Beacon />);
    await runIdle();
    expect(sent).toHaveLength(0);
  });
});
