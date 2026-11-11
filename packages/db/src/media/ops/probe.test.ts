import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaDelivery } from "../ports";
import { mediaOriginErrorsSince, resetMediaCountersForTests } from "./counters";
import { probeCdn, type Canary, type ProbeDeps } from "./probe";

const CANARY: Canary = {
  id: "aaaaaaaaaaaaaaa",
  orgId: "bbbbbbbbbbbbbbb",
  kind: "image",
  key: "tenants/bbbbbbbbbbbbbbb/media/image/aaaaaaaaaaaaaaa/thumb.webp",
};

function delivery(name: "app" | "bunny"): MediaDelivery {
  return {
    name,
    urlFor: (a, v) => `https://cdn.example.test/${a.orgId}/${a.id}/${v}`,
    purge: async () => undefined,
    deliveryBytes: async () => null,
  };
}

function deps(over: Partial<ProbeDeps> = {}): ProbeDeps {
  return {
    delivery: delivery("bunny"),
    findCanary: async () => CANARY,
    fetch: vi.fn(async () => ({ status: 200 })),
    store: { stat: vi.fn(async () => ({ size: 1, lastModified: new Date() })) },
    sleep: async () => undefined,
    ...over,
  };
}

describe("probeCdn (07-27 choice 1)", () => {
  beforeEach(() => resetMediaCountersForTests());

  it("app delivery is skipped without calling fetch", async () => {
    const fetch = vi.fn();
    const d = deps({ delivery: delivery("app"), fetch });
    expect(await probeCdn(d)).toEqual({ result: "skipped", canary: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("no canary row -> no-canary without fetch", async () => {
    const fetch = vi.fn();
    const d = deps({ findCanary: async () => null, fetch });
    expect(await probeCdn(d)).toEqual({ result: "no-canary", canary: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("HEAD 200 -> ok, with the delivery URL, HEAD and manual redirect", async () => {
    const fetch = vi.fn(async () => ({ status: 200 }));
    const out = await probeCdn(deps({ fetch }));
    expect(out).toEqual({ result: "ok", canary: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [
      string,
      { method: string; redirect: string },
    ];
    expect(url).toBe(
      delivery("bunny").urlFor(
        { id: CANARY.id, orgId: CANARY.orgId, kind: "image" },
        "thumb",
      ),
    );
    expect(init.method).toBe("HEAD");
    expect(init.redirect).toBe("manual");
  });

  it("304 passes", async () => {
    const out = await probeCdn(deps({ fetch: async () => ({ status: 304 }) }));
    expect(out.result).toBe("ok");
  });

  it("503 then 200 -> ok after one retry", async () => {
    const statuses = [503, 200];
    const fetch = vi.fn(async () => ({ status: statuses.shift()! }));
    const sleep = vi.fn(async () => undefined);
    expect((await probeCdn(deps({ fetch, sleep }))).result).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("two failures + object present -> down", async () => {
    const fetch = vi.fn(async () => ({ status: 502 }));
    expect(await probeCdn(deps({ fetch }))).toEqual({
      result: "down",
      canary: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mediaOriginErrorsSince()).toBe(0);
  });

  it("a fetch that throws counts as a failure", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("timeout");
    });
    expect((await probeCdn(deps({ fetch }))).result).toBe("down");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("two failures + object missing -> no-canary and one origin error", async () => {
    const out = await probeCdn(
      deps({
        fetch: async () => ({ status: 404 }),
        store: { stat: async () => null },
      }),
    );
    expect(out).toEqual({ result: "no-canary", canary: true });
    expect(mediaOriginErrorsSince()).toBe(1);
  });

  it("two failures + stat rejects -> no-canary and one origin error", async () => {
    const out = await probeCdn(
      deps({
        fetch: async () => ({ status: 500 }),
        store: {
          stat: async () => {
            throw new Error("boom");
          },
        },
      }),
    );
    expect(out.result).toBe("no-canary");
    expect(mediaOriginErrorsSince()).toBe(1);
  });
});
