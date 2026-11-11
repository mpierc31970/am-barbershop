// 13-18 (STAFF-14, P13-P14): the FailsafeCapture port, env switch and the 13-04 signing
// strings. The DB sync, convert and dismiss are covered by failsafe.integration.test.ts.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  failsafeAckMessage,
  failsafePullMessage,
  failsafeSign,
  getFailsafeCapture,
  httpFailsafe,
  notDeployedFailsafe,
  parseCapturedRequest,
  salvageCapturedRequest,
} from "./failsafe";

const SECRET = "pull-secret-for-tests";
const NOW = new Date("2026-10-15T12:00:00.000Z");

const REQUEST = {
  id: "0123456789abcdef01234567",
  orgSlug: "bellas-salon",
  addon: "fixture-premium",
  name: "Ana",
  email: "ana@example.com",
  phone: "",
  preferred: "Tuesday",
  message: "Hello",
  created_at: "2026-10-15T11:00:00.000Z",
};

describe("signing strings (pinned to apps/failsafe/src/pull.ts, 13-04)", () => {
  it("pull and ack messages match the service byte for byte", () => {
    expect(failsafePullMessage("2026-10-01T00:00:00.000Z", 1760000000000)).toBe(
      "pull|2026-10-01T00:00:00.000Z|1760000000000",
    );
    expect(failsafeAckMessage(["a1", "b2"], 1760000000000)).toBe(
      "ack|a1,b2|1760000000000",
    );
  });

  it("signature is lowercase hex HMAC-SHA256", () => {
    const want = createHmac("sha256", SECRET).update("pull|x|1").digest("hex");
    expect(failsafeSign(SECRET, "pull|x|1")).toBe(want);
    expect(want).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("getFailsafeCapture (P13-P14)", () => {
  it("unset → not deployed, nothing to pull", async () => {
    const c = getFailsafeCapture({});
    expect(c).toBe(notDeployedFailsafe);
    expect(await c.status()).toBe("not_deployed");
    expect(await c.pull("1970-01-01T00:00:00.000Z")).toEqual([]);
  });

  it("an unknown value throws", () => {
    expect(() => getFailsafeCapture({ CDS_FAILSAFE: "bogus" })).toThrow(
      /CDS_FAILSAFE="bogus"/,
    );
  });

  it("http needs a URL and a secret", () => {
    expect(() =>
      getFailsafeCapture({
        CDS_FAILSAFE: "http",
        FAILSAFE_URL: "https://f.example",
      }),
    ).toThrow(/FAILSAFE_PULL_SECRET/);
    expect(() =>
      getFailsafeCapture({ CDS_FAILSAFE: "http", FAILSAFE_PULL_SECRET: "s" }),
    ).toThrow();
    expect(
      getFailsafeCapture({
        CDS_FAILSAFE: "http",
        FAILSAFE_URL: "https://f.example",
        FAILSAFE_PULL_SECRET: "s",
      }).name,
    ).toBe("http");
  });
});

describe("httpFailsafe adapter", () => {
  function fakeFetch(
    answer: unknown,
    calls: { url: string; init?: RequestInit }[],
  ) {
    return (async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  }

  it("signs the pull with the 13-04 string and parses the JSON", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const c = httpFailsafe({
      url: "https://failsafe.example",
      secret: SECRET,
      now: () => NOW,
      fetch: fakeFetch(
        { requests: [REQUEST, { id: "bad id!", orgSlug: "x" }], corrupt: 0 },
        calls,
      ),
    });
    const since = "2026-10-01T00:00:00.000Z";
    const got = await c.pull(since);
    expect(got).toEqual([REQUEST]);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/pull");
    // WR-B01: POST with a JSON body; nothing signed in the URL.
    expect(url.search).toBe("");
    expect(calls[0]!.init!.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init!.body)) as {
      since: string;
      ts: number;
      sig: string;
    };
    expect(body.since).toBe(since);
    expect(body.ts).toBe(NOW.getTime());
    expect(body.sig).toBe(
      createHmac("sha256", SECRET)
        .update(`pull|${since}|${body.ts}`)
        .digest("hex"),
    );
  });

  it("signs the ack over the ids in order", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const c = httpFailsafe({
      url: "https://failsafe.example",
      secret: SECRET,
      now: () => NOW,
      fetch: fakeFetch({ acked: 2 }, calls),
    });
    await c.ack(["b", "a"]);
    expect(new URL(calls[0]!.url).pathname).toBe("/ack");
    const body = JSON.parse(String(calls[0]!.init!.body)) as {
      ids: string[];
      ts: number;
      sig: string;
    };
    expect(body.ids).toEqual(["b", "a"]);
    expect(body.sig).toBe(
      createHmac("sha256", SECRET)
        .update(`ack|b,a|${NOW.getTime()}`)
        .digest("hex"),
    );
  });

  it("a non-200 or bad shape throws; status reports error", async () => {
    const notFound = (async () =>
      new Response("", { status: 404 })) as typeof fetch;
    const c = httpFailsafe({
      url: "https://f.example",
      secret: SECRET,
      fetch: notFound,
    });
    await expect(c.pull("x")).rejects.toThrow(/404/);
    expect(await c.status()).toBe("error");
    const bad = httpFailsafe({
      url: "https://f.example",
      secret: SECRET,
      fetch: fakeFetch({ nope: true }, []),
    });
    await expect(bad.pull("x")).rejects.toThrow(/bad shape/);
  });
});

describe("parseCapturedRequest (T-13-18-01)", () => {
  it("accepts the 13-04 shape and refuses oversize or malformed fields", () => {
    expect(parseCapturedRequest(REQUEST)).toEqual(REQUEST);
    expect(parseCapturedRequest({ ...REQUEST, orgSlug: "../x" })).toBeNull();
    expect(parseCapturedRequest({ ...REQUEST, name: "" })).toBeNull();
    expect(
      parseCapturedRequest({ ...REQUEST, message: "x".repeat(2001) }),
    ).toBeNull();
    expect(parseCapturedRequest({ ...REQUEST, created_at: "soon" })).toBeNull();
    expect(parseCapturedRequest(null)).toBeNull();
  });
});

describe("salvageCapturedRequest (CR-A01)", () => {
  it("keeps an item with a usable id and time, clipped, instead of dropping it", () => {
    expect(salvageCapturedRequest(REQUEST)).toEqual(REQUEST);
    expect(
      salvageCapturedRequest({
        ...REQUEST,
        orgSlug: "../x",
        name: "",
        message: "x".repeat(2500),
      }),
    ).toEqual({
      ...REQUEST,
      orgSlug: "",
      name: "(no name)",
      message: "x".repeat(2000),
    });
    expect(salvageCapturedRequest({ ...REQUEST, id: "../" })).toBeNull();
    expect(
      salvageCapturedRequest({ ...REQUEST, created_at: "soon" }),
    ).toBeNull();
    expect(salvageCapturedRequest(null)).toBeNull();
  });
});
