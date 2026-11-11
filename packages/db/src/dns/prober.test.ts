// 14-12 (DOM-06; P14-P9, T-14-12-02, T-14-12-03): the pinned HTTPS prober against an injected
// request function. No network: the fake below plays the edge.
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { describe, expect, it } from "vitest";
import {
  CDS_HOST_PROOF_PATH,
  pinnedHttpsProber,
  UnsafeProbeTarget,
  type ProbeRequestFn,
} from "./prober";

const EDGE = "82.180.132.176";
const NOW = new Date("2026-10-17T00:00:00Z");

type Scenario =
  | { kind: "response"; status: number; body?: string; validTo?: string }
  | { kind: "error"; code: string }
  | { kind: "timeout" };

function fakeRequest(sc: Scenario) {
  const seen: RequestOptions[] = [];
  const fn: ProbeRequestFn = (opts, cb) => {
    seen.push(opts);
    const req = new EventEmitter() as EventEmitter & {
      end(): void;
      destroy(): void;
      destroyed: boolean;
    };
    req.destroyed = false;
    req.destroy = () => {
      req.destroyed = true;
    };
    req.end = () => {
      queueMicrotask(() => {
        if (sc.kind === "error") {
          req.emit("error", Object.assign(new Error("tls"), { code: sc.code }));
          return;
        }
        if (sc.kind === "timeout") {
          req.emit("timeout");
          return;
        }
        const res = new EventEmitter() as EventEmitter & {
          statusCode: number;
          socket: unknown;
          resume(): void;
          destroy(): void;
        };
        res.statusCode = sc.status;
        res.socket = {
          getPeerCertificate: () => ({ valid_to: sc.validTo ?? "" }),
        };
        res.resume = () => undefined;
        res.destroy = () => undefined;
        cb(res as unknown as IncomingMessage);
        if (sc.body !== undefined) res.emit("data", Buffer.from(sc.body));
        res.emit("end");
      });
    };
    return req;
  };
  return { fn, seen };
}

function lookupResult(opts: RequestOptions, all: boolean): unknown {
  let out: unknown;
  const lookup = opts.lookup as unknown as (
    h: string,
    o: object,
    cb: (...a: unknown[]) => void,
  ) => void;
  lookup("169.254.169.254.nip.io", { all }, (...a) => {
    out = a;
  });
  return out;
}

describe("pinnedHttpsProber (choice 4)", () => {
  it("pins the connection to the edge IP with SNI and Host = the domain", async () => {
    const { fn, seen } = fakeRequest({
      kind: "response",
      status: 200,
      body: "v1.abc123\n",
      validTo: "Jan 15 00:00:00 2027 GMT",
    });
    const p = pinnedHttpsProber({ edgeIp: EDGE, request: fn, now: () => NOW });
    const r = await p.probe("WWW.Rivera-Bakery.com.");
    expect(r).toEqual({
      ok: true,
      status: 200,
      proof: "v1.abc123",
      certDaysLeft: 90,
      error: null,
    });
    const o = seen[0] as RequestOptions & { servername?: string };
    expect(o.host).toBe("www.rivera-bakery.com");
    expect(o.servername).toBe("www.rivera-bakery.com");
    expect(o.headers).toMatchObject({ host: "www.rivera-bakery.com" });
    expect(o.path).toBe(CDS_HOST_PROOF_PATH);
    expect(o.method).toBe("GET");
    expect(o.timeout).toBe(8000);
    expect(o.rejectUnauthorized).toBe(true);
    // Whatever the name, the lookup answers the edge IP (both callback shapes).
    expect(lookupResult(o, false)).toEqual([null, EDGE, 4]);
    expect(lookupResult(o, true)).toEqual([
      null,
      [{ address: EDGE, family: 4 }],
    ]);
  });

  it("never follows a redirect: 301 -> ok false with the status", async () => {
    const { fn, seen } = fakeRequest({ kind: "response", status: 301 });
    const r = await pinnedHttpsProber({ edgeIp: EDGE, request: fn }).probe(
      "example.com",
    );
    expect(r.ok).toBe(false);
    expect(r.status).toBe(301);
    expect(r.proof).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it("reads at most 256 bytes of proof", async () => {
    const { fn } = fakeRequest({
      kind: "response",
      status: 200,
      body: "x".repeat(1000),
    });
    const r = await pinnedHttpsProber({ edgeIp: EDGE, request: fn }).probe(
      "example.com",
    );
    expect(r.proof).toHaveLength(256);
  });

  it("TLS errors report the code only; timeouts report timeout", async () => {
    const tls = fakeRequest({ kind: "error", code: "CERT_HAS_EXPIRED" });
    expect(
      await pinnedHttpsProber({ edgeIp: EDGE, request: tls.fn }).probe(
        "example.com",
      ),
    ).toEqual({
      ok: false,
      status: null,
      proof: null,
      certDaysLeft: null,
      error: "CERT_HAS_EXPIRED",
    });
    const slow = fakeRequest({ kind: "timeout" });
    expect(
      (
        await pinnedHttpsProber({ edgeIp: EDGE, request: slow.fn }).probe(
          "example.com",
        )
      ).error,
    ).toBe("timeout");
  });

  it("refuses a non-public edge IP", () => {
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "",
      "edge.example",
    ]) {
      expect(() => pinnedHttpsProber({ edgeIp: ip }), ip).toThrow(
        UnsafeProbeTarget,
      );
    }
  });
});
