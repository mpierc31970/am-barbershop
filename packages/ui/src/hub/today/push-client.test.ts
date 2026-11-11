// Review 11 WR-D05 (a subscription made with an old VAPID key is replaced) and WR-A02/E01
// (sign-out unsubscribes this browser and returns the old endpoint, never blocking).
// Browser globals are stubbed per test; nothing here touches a real push service.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetThisBrowser,
  HUB_SW_SCOPE,
  sameKey,
  subscribeThisDevice,
  urlBase64ToUint8Array,
} from "./push-client";

const OLD_KEY = "AQID"; // [1, 2, 3]
const NEW_KEY = "BAUG"; // [4, 5, 6]

type FakeSub = {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  unsubscribe: ReturnType<typeof vi.fn>;
  toJSON: () => PushSubscriptionJSON;
};

function fakeSub(endpoint: string, key: string): FakeSub {
  const bytes = urlBase64ToUint8Array(key);
  return {
    endpoint,
    options: { applicationServerKey: bytes.buffer },
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
  };
}

function stubBrowser(opts: {
  existing: FakeSub | null;
  created?: FakeSub;
  getRegistration?: () => Promise<unknown>;
}) {
  const subscribe = vi.fn(async () => opts.created);
  const pushManager = {
    getSubscription: vi.fn(async () => opts.existing),
    subscribe,
  };
  const reg = { pushManager };
  const serviceWorker = {
    register: vi.fn(async () => reg),
    ready: Promise.resolve(reg),
    getRegistration: vi.fn(opts.getRegistration ?? (async () => reg)),
  };
  const navigator = { serviceWorker, userAgent: "x", maxTouchPoints: 0 };
  vi.stubGlobal("navigator", navigator);
  vi.stubGlobal("window", {
    navigator,
    PushManager: function PushManager() {},
    Notification: { permission: "granted" },
  });
  vi.stubGlobal("Notification", {
    permission: "granted",
    requestPermission: vi.fn(async () => "granted"),
  });
  return { subscribe, serviceWorker };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("sameKey (WR-D05)", () => {
  it("compares the subscription's key bytes with the current key", () => {
    const want = urlBase64ToUint8Array(NEW_KEY);
    expect(sameKey(urlBase64ToUint8Array(NEW_KEY).buffer, want)).toBe(true);
    expect(sameKey(urlBase64ToUint8Array(NEW_KEY), want)).toBe(true);
    expect(sameKey(urlBase64ToUint8Array(OLD_KEY).buffer, want)).toBe(false);
    expect(sameKey(new Uint8Array([4, 5]).buffer, want)).toBe(false);
    expect(sameKey(null, want)).toBe(false);
  });
});

describe("subscribeThisDevice (WR-D05)", () => {
  it("replaces a subscription made with another VAPID key", async () => {
    const old = fakeSub("https://push.example/old", OLD_KEY);
    const fresh = fakeSub("https://push.example/new", NEW_KEY);
    const { subscribe } = stubBrowser({ existing: old, created: fresh });
    const save = vi.fn(async () => ({ ok: true }));
    expect(await subscribeThisDevice(NEW_KEY, save)).toBe("on");
    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://push.example/new" }),
    );
  });

  it("keeps a subscription made with the current key", async () => {
    const cur = fakeSub("https://push.example/cur", NEW_KEY);
    const { subscribe } = stubBrowser({ existing: cur });
    const save = vi.fn(async () => ({ ok: true }));
    expect(await subscribeThisDevice(NEW_KEY, save)).toBe("on");
    expect(cur.unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://push.example/cur" }),
    );
  });
});

describe("forgetThisBrowser (WR-A02, WR-E01)", () => {
  it("unsubscribes the hub's push and returns the old endpoint", async () => {
    const cur = fakeSub("https://push.example/cur", NEW_KEY);
    const { serviceWorker } = stubBrowser({ existing: cur });
    expect(await forgetThisBrowser()).toBe("https://push.example/cur");
    expect(serviceWorker.getRegistration).toHaveBeenCalledWith(HUB_SW_SCOPE);
    expect(cur.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("is null with nothing subscribed, no worker, or no push support", async () => {
    stubBrowser({ existing: null });
    expect(await forgetThisBrowser()).toBeNull();
    stubBrowser({ existing: null, getRegistration: async () => undefined });
    expect(await forgetThisBrowser()).toBeNull();
    vi.unstubAllGlobals();
    vi.stubGlobal("window", { navigator: {} });
    expect(await forgetThisBrowser()).toBeNull();
  });

  it("never throws and never waits past the timeout", async () => {
    stubBrowser({
      existing: null,
      getRegistration: async () => {
        throw new Error("blocked");
      },
    });
    expect(await forgetThisBrowser()).toBeNull();
    vi.useFakeTimers();
    stubBrowser({
      existing: null,
      getRegistration: () => new Promise(() => {}),
    });
    const p = forgetThisBrowser(50);
    await vi.advanceTimersByTimeAsync(60);
    expect(await p).toBeNull();
  });
});
