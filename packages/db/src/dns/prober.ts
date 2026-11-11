// packages/db/src/dns/prober.ts (P14, DOM-06).
// Owner: 14-12 (14-EXECUTOR-BRIEF "Module seams"). Not in the dns barrel: only factory.ts imports it.
//
// The real HttpsProber (14-12 choice 4; P14-P9, RESEARCH Pitfall 5, D13):
// - Connects to CDS_EDGE_IPV4 only: node:https with a `lookup` pinned to the edge IP, so an
//   owner who points DNS at 169.254.169.254 or an internal service is never reached
//   (T-14-12-02). A non-public edge IP is refused when the prober is built.
// - SNI (servername) and Host are the domain; the certificate is validated normally
//   (rejectUnauthorized), so a probe passes only when the edge serves a valid cert for it.
// - GET /.well-known/cds-host; never follows a redirect (any 3xx -> ok false with the status).
// - Reads at most 256 bytes of body as the proof (the cds-host MAC from 14-14; compared by
//   the caller) and the certificate's days left. 8 s timeout (T-14-12-03).
// - Errors are reported as their code (CERT_HAS_EXPIRED, ECONNREFUSED, timeout ...), never a
//   host or a value. Built-in modules only (no extra HTTP client package).
import type { IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { LookupFunction } from "node:net";
import type { TLSSocket } from "node:tls";
import { fqdn } from "@cds/core/dns";
import type { HttpsProber, ProbeResult } from "./ports";
import { isPublicIp } from "./real-resolver";

export const CDS_HOST_PROOF_PATH = "/.well-known/cds-host";
const MAX_PROOF_BYTES = 256;
const TIMEOUT_MS = 8000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The edge IP given to the prober is not a public address. */
export class UnsafeProbeTarget extends Error {
  constructor() {
    super("Refused a non-public CDS_EDGE_IPV4");
    this.name = "UnsafeProbeTarget";
  }
}

/** The subset of a ClientRequest the prober drives (tests inject a fake). */
export interface ProbeRequest {
  on(event: "error", cb: (err: Error) => void): unknown;
  on(event: "timeout", cb: () => void): unknown;
  destroy(err?: Error): unknown;
  end(): unknown;
}

export type ProbeRequestFn = (
  opts: RequestOptions,
  cb: (res: IncomingMessage) => void,
) => ProbeRequest;

export type PinnedProberOptions = {
  edgeIp: string;
  request?: ProbeRequestFn;
  now?: () => Date;
  timeoutMs?: number;
};

/** A dns.lookup replacement that always answers the edge IP (both callback shapes). */
export function pinnedLookup(edgeIp: string): LookupFunction {
  const family = edgeIp.includes(":") ? 6 : 4;
  return ((
    _hostname: string,
    options: unknown,
    cb?: (...args: unknown[]) => void,
  ) => {
    const callback = (typeof options === "function" ? options : cb) as (
      ...args: unknown[]
    ) => void;
    const all =
      typeof options === "object" &&
      options !== null &&
      (options as { all?: unknown }).all === true;
    if (all) callback(null, [{ address: edgeIp, family }]);
    else callback(null, edgeIp, family);
  }) as unknown as LookupFunction;
}

function codeOf(err: unknown): string {
  if (err && typeof err === "object") {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string" && /^[A-Za-z0-9_]{1,64}$/.test(c)) return c;
    const n = (err as { name?: unknown }).name;
    if (typeof n === "string" && /^[A-Za-z0-9_]{1,64}$/.test(n)) return n;
  }
  return "probe_failed";
}

function certDaysLeft(res: IncomingMessage, now: Date): number | null {
  const sock = res.socket as TLSSocket | null | undefined;
  if (!sock || typeof sock.getPeerCertificate !== "function") return null;
  const cert = sock.getPeerCertificate();
  const validTo =
    cert && typeof cert.valid_to === "string" ? cert.valid_to : "";
  const t = Date.parse(validTo);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now.getTime()) / DAY_MS);
}

export function pinnedHttpsProber(opts: PinnedProberOptions): HttpsProber {
  const edgeIp = opts.edgeIp?.trim() ?? "";
  if (!isPublicIp(edgeIp)) throw new UnsafeProbeTarget();
  const doRequest: ProbeRequestFn =
    opts.request ?? (httpsRequest as unknown as ProbeRequestFn);
  const now = opts.now ?? (() => new Date());
  const timeout = opts.timeoutMs ?? TIMEOUT_MS;
  const lookup = pinnedLookup(edgeIp);

  return {
    probe(host): Promise<ProbeResult> {
      const h = fqdn(host);
      const fail = (
        error: string,
        status: number | null = null,
      ): ProbeResult => ({
        ok: false,
        status,
        proof: null,
        certDaysLeft: null,
        error,
      });
      return new Promise<ProbeResult>((resolve) => {
        let settled = false;
        const done = (r: ProbeResult) => {
          if (settled) return;
          settled = true;
          resolve(r);
        };
        let req: ProbeRequest;
        try {
          req = doRequest(
            {
              host: h,
              servername: h,
              port: 443,
              path: CDS_HOST_PROOF_PATH,
              method: "GET",
              lookup,
              timeout,
              agent: false,
              rejectUnauthorized: true,
              headers: { host: h, accept: "text/plain" },
            },
            (res) => {
              const status = res.statusCode ?? null;
              const days = certDaysLeft(res, now());
              if (status === null || status < 200 || status >= 300) {
                res.resume?.();
                done({
                  ok: false,
                  status,
                  proof: null,
                  certDaysLeft: days,
                  error:
                    status !== null && status >= 300 && status < 400
                      ? "redirect"
                      : "http_status",
                });
                return;
              }
              const chunks: Buffer[] = [];
              let size = 0;
              const finish = () => {
                const body = Buffer.concat(chunks).subarray(0, MAX_PROOF_BYTES);
                done({
                  ok: true,
                  status,
                  proof: body.toString("utf8").trim() || null,
                  certDaysLeft: days,
                  error: null,
                });
              };
              res.on("data", (c: Buffer | string) => {
                const b = typeof c === "string" ? Buffer.from(c) : c;
                chunks.push(b);
                size += b.length;
                if (size >= MAX_PROOF_BYTES) {
                  finish();
                  res.destroy?.();
                }
              });
              res.on("end", finish);
              res.on("error", (err: Error) => done(fail(codeOf(err), status)));
            },
          );
        } catch (err) {
          done(fail(codeOf(err)));
          return;
        }
        req.on("timeout", () => {
          done(fail("timeout"));
          req.destroy();
        });
        req.on("error", (err) => done(fail(codeOf(err))));
        req.end();
      });
    },
  };
}
