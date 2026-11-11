// Fail-safe capture service (D155, D269, D291; design note .planning/design/FAILSAFE-NOTE.md).
// Dependency-free node:http server, run on the third VPS so it stays up when the platform is
// down. Routes:
//   GET  /healthz                       → "ok"
//   GET  /r/<orgSlug>/<addon>           → request form (routed pairs only)
//   POST /r/<orgSlug>/<addon>           → capture (5 per 10 min per IP, honeypot, length caps)
//   POST /pull { since, ts, sig }       → signed pull of decrypted requests (JSON)
//   POST /ack  { ids, ts, sig }         → signed ack, marks ids reconciled
// A signature is accepted once (WR-B01). Everything else, and every refused pull/ack, is 404.
// Rows reconciled more than 30 days ago are swept at start and then hourly on a timer, never
// in the request path (WR-B02: a sweep decrypts the whole store). Errors are logged by class name only.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadKey, unseal } from "./crypto.ts";
import { openStore } from "./store.ts";
import type { FailsafeRequest } from "./store.ts";
import { replayGuard, verifyAck, verifyPull } from "./pull.ts";
import {
  parseForm,
  renderForm,
  renderMessage,
  renderReceived,
  toInput,
} from "./form.ts";
import { loggingMail, mailFromEnv } from "./mail.ts";
import type { MailTransport } from "./mail.ts";

export type RoutingEntry = {
  orgSlug: string;
  addon: string;
  businessName?: string;
  ownerEmailHash?: string;
  ownerEmail: string;
  staffEmail: string;
};

export type FailsafeServerOptions = {
  dataDir: string;
  dataKey: string | undefined;
  pullSecret: string | undefined;
  routing: RoutingEntry[] | (() => RoutingEntry[]);
  mail?: MailTransport;
  now?: () => Date;
  log?: (line: string) => void;
  /** Trusted reverse-proxy hops in front of the service (Caddy = 1). Default 0. */
  trustProxyHops?: number;
  /** How often the retention sweep runs (WR-B02). Default 1 hour. */
  sweepEveryMs?: number;
};

const MAX_FORM_BYTES = 16 * 1024;
const MAX_ACK_BYTES = 64 * 1024;
const MAX_PULL_BYTES = 4 * 1024;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function isEntry(v: unknown): v is RoutingEntry {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.orgSlug === "string" &&
    typeof r.addon === "string" &&
    typeof r.ownerEmail === "string" &&
    typeof r.staffEmail === "string" &&
    (r.businessName === undefined || typeof r.businessName === "string") &&
    (r.ownerEmailHash === undefined || typeof r.ownerEmailHash === "string")
  );
}

/** Read and decrypt FAILSAFE_ROUTING_FILE (same AES-256-GCM key as the store). */
export function loadRouting(
  file: string,
  dataKey: string | undefined,
): RoutingEntry[] {
  const key = loadKey(dataKey);
  const value = unseal(key, JSON.parse(readFileSync(file, "utf8")));
  if (!Array.isArray(value) || !value.every(isEntry)) {
    throw new Error("routing file is not a list of routing entries");
  }
  return value;
}

/** Per-IP sliding window, in process. */
function slidingWindow(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (ip: string, at: number): boolean => {
    const recent = (hits.get(ip) ?? []).filter((t) => at - t < windowMs);
    if (recent.length >= limit) {
      hits.set(ip, recent);
      return false;
    }
    recent.push(at);
    hits.set(ip, recent);
    if (hits.size > 10_000) {
      for (const [k, v] of hits) {
        if (v.every((t) => at - t >= windowMs)) hits.delete(k);
      }
    }
    return true;
  };
}

class TooLarge extends Error {
  override name = "TooLarge";
}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new TooLarge("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  type = "text/html; charset=utf-8",
): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), "application/json; charset=utf-8");
}

const NOT_FOUND = renderMessage(
  "Not found",
  "There is nothing at this address.",
);

export function createFailsafeServer(opts: FailsafeServerOptions): Server {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((l: string) => console.info(l));
  const mail = opts.mail ?? loggingMail(log);
  const store = openStore({ dir: opts.dataDir, key: opts.dataKey, now });
  const allow = slidingWindow(RATE_LIMIT, RATE_WINDOW_MS);
  const firstUse = replayGuard();
  const hops = Math.max(0, Math.floor(opts.trustProxyHops ?? 0));
  const routing = (): RoutingEntry[] =>
    typeof opts.routing === "function" ? opts.routing() : opts.routing;

  function clientIp(req: IncomingMessage): string {
    if (hops > 0) {
      const xff = req.headers["x-forwarded-for"];
      const list = (Array.isArray(xff) ? xff.join(",") : (xff ?? ""))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const ip = list[list.length - hops];
      if (ip) return ip;
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  function findRoute(org: string, addon: string): RoutingEntry | undefined {
    if (!SLUG_RE.test(org) || !SLUG_RE.test(addon)) return undefined;
    return routing().find((r) => r.orgSlug === org && r.addon === addon);
  }

  async function notify(
    route: RoutingEntry,
    saved: FailsafeRequest,
  ): Promise<void> {
    const biz = route.businessName ?? route.orgSlug;
    const text = `A customer sent a request through the fail-safe form while online booking was unavailable.\n\nName: ${saved.name}\nEmail: ${saved.email}\nPhone: ${saved.phone || "-"}\nPreferred: ${saved.preferred || "-"}\n\n${saved.message}\n\nThis is a request only: nothing is booked or paid. It appears in the platform once it is back.`;
    const base = { orgSlug: route.orgSlug, addon: route.addon, text };
    const results = await Promise.allSettled([
      mail.send({
        ...base,
        type: "failsafe.request_owner",
        to: route.ownerEmail,
        subject: `New request for ${biz}`,
      }),
      mail.send({
        ...base,
        type: "failsafe.request_staff",
        to: route.staffEmail,
        subject: `Fail-safe request captured (${route.orgSlug})`,
      }),
    ]);
    for (const r of results) {
      if (r.status === "rejected") {
        log(`[failsafe] mail failed ${errName(r.reason)}`);
      }
    }
  }

  function sweep(): void {
    try {
      const deleted = store.sweep(now());
      if (deleted > 0) log(`[failsafe] swept ${deleted}`);
    } catch (err) {
      log(`[failsafe] sweep failed ${errName(err)}`);
    }
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://failsafe.local");
    const method = req.method ?? "GET";
    const path = url.pathname;

    if (path === "/healthz" && method === "GET") {
      send(res, 200, "ok", "text/plain; charset=utf-8");
      return;
    }

    if (path === "/pull" && method === "POST") {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, MAX_PULL_BYTES));
      } catch {
        send(res, 404, NOT_FOUND);
        return;
      }
      const b = (body ?? {}) as Record<string, unknown>;
      const at = now();
      const ok =
        verifyPull({
          secret: opts.pullSecret,
          since: b.since,
          ts: b.ts,
          sig: b.sig,
          now: at,
        }) && firstUse(b.sig as string, at.getTime());
      if (!ok) {
        send(res, 404, NOT_FOUND);
        return;
      }
      const since = b.since as string;
      sendJson(res, 200, store.readSince(since === "" ? undefined : since));
      return;
    }

    if (path === "/ack" && method === "POST") {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, MAX_ACK_BYTES));
      } catch {
        send(res, 404, NOT_FOUND);
        return;
      }
      const b = (body ?? {}) as Record<string, unknown>;
      const at = now();
      const ok =
        verifyAck({
          secret: opts.pullSecret,
          ids: b.ids,
          ts: b.ts,
          sig: b.sig,
          now: at,
        }) && firstUse(b.sig as string, at.getTime());
      if (!ok) {
        send(res, 404, NOT_FOUND);
        return;
      }
      sendJson(res, 200, { acked: store.ack(b.ids as string[]) });
      return;
    }

    const m = /^\/r\/([^/]+)\/([^/]+)\/?$/.exec(path);
    const route = m ? findRoute(m[1]!, m[2]!) : undefined;
    if (!m || !route) {
      send(res, 404, NOT_FOUND);
      return;
    }
    const businessName = route.businessName ?? route.orgSlug;
    const action = `/r/${route.orgSlug}/${route.addon}`;

    if (method === "GET") {
      send(res, 200, renderForm({ businessName, action }));
      return;
    }
    if (method !== "POST") {
      send(res, 404, NOT_FOUND);
      return;
    }

    if (!allow(clientIp(req), now().getTime())) {
      send(
        res,
        429,
        renderMessage(
          "Too many requests",
          "Please wait a few minutes, then try again.",
        ),
      );
      return;
    }

    let raw: string;
    try {
      raw = await readBody(req, MAX_FORM_BYTES);
    } catch (err) {
      send(
        res,
        err instanceof TooLarge ? 413 : 400,
        renderMessage(
          "Request too large",
          "Please shorten your message and try again.",
        ),
      );
      return;
    }

    const parsed = parseForm(raw);
    if (parsed.kind === "bot") {
      send(res, 200, renderReceived(businessName));
      return;
    }
    if (parsed.kind === "invalid") {
      send(
        res,
        400,
        renderForm({
          businessName,
          action,
          values: parsed.values,
          errors: parsed.errors,
        }),
      );
      return;
    }
    const saved = store.append(
      toInput(route.orgSlug, route.addon, parsed.values),
    );
    log(`[failsafe] captured ${route.orgSlug}/${route.addon} id=${saved.id}`);
    await notify(route, saved);
    send(res, 200, renderReceived(businessName));
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      log(`[failsafe] request failed ${errName(err)}`);
      if (!res.headersSent) {
        send(
          res,
          500,
          renderMessage("Something went wrong", "Please try again."),
        );
      } else {
        res.end();
      }
    });
  });
  // WR-B02: sweep once at start, then on a timer; the request path never reads the store
  // unless the route needs it.
  sweep();
  const timer = setInterval(sweep, opts.sweepEveryMs ?? SWEEP_EVERY_MS);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  return server;
}

/** Start from env. Refuses to start without a valid FAILSAFE_DATA_KEY. */
export function main(env: NodeJS.ProcessEnv = process.env): Server {
  const dataDir = env.FAILSAFE_DATA_DIR;
  if (!dataDir) throw new Error("FAILSAFE_DATA_DIR is not set");
  loadKey(env.FAILSAFE_DATA_KEY);
  if (!env.FAILSAFE_PULL_SECRET) {
    console.warn(
      "[failsafe] FAILSAFE_PULL_SECRET is not set: /pull and /ack refuse everything",
    );
  }
  const routingFile = env.FAILSAFE_ROUTING_FILE;
  let cached: RoutingEntry[] = routingFile
    ? loadRouting(routingFile, env.FAILSAFE_DATA_KEY)
    : [];
  let loadedAt = Date.now();
  const routing = (): RoutingEntry[] => {
    // Pick up a re-synced routing file within a minute, without a restart.
    if (routingFile && Date.now() - loadedAt > 60_000) {
      loadedAt = Date.now();
      try {
        cached = loadRouting(routingFile, env.FAILSAFE_DATA_KEY);
      } catch (err) {
        console.error(`[failsafe] routing reload failed ${errName(err)}`);
      }
    }
    return cached;
  };
  const port = Number(env.FAILSAFE_PORT ?? 8787);
  const server = createFailsafeServer({
    dataDir,
    dataKey: env.FAILSAFE_DATA_KEY,
    pullSecret: env.FAILSAFE_PULL_SECRET,
    routing,
    mail: mailFromEnv(env.FAILSAFE_MAIL_TRANSPORT),
    trustProxyHops: Number(env.FAILSAFE_TRUST_PROXY_HOPS ?? 0),
  });
  server.listen(port, () => {
    console.info(`[failsafe] listening on ${port}, ${cached.length} routes`);
  });
  return server;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main();
}
