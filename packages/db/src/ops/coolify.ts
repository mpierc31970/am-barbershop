// packages/db/src/ops/coolify.ts (P15, HUB-04, D62). Owner: 15-25.
//
// The real CoolifyApi for the hub:cutover CLI (the planner in ./hub-cutover.ts only sees the
// port). RESEARCH Pattern 8 endpoints:
//   GET   /applications/{uuid}            getApp
//   GET   /applications/{uuid}/envs       listEnvKeys
//   PATCH /applications/{uuid} {domains}  setDomains (body is { domains } and nothing else:
//                                          Coolify's conflict override is never sent, so a
//                                          409 always stops the step)
//   POST  /deploy?uuid=&force=            deploy (GET on 405)
//   GET   /deployments/{id}               deploymentStatus (read-only)
//   POST  /applications/{uuid}/stop|start (GET on 405)
//
// Secrets (CLAUDE.md, T-15-25-01): the token is sent as a Bearer header and never printed.
// A failure is a CoolifyError carrying only the HTTP status and the method name: never the
// URL query, the response body (env values) or the token.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CoolifyApi, CoolifyApp, CoolifyEnvVar } from "./hub-cutover";

// WR-B05: the token can read every app's secrets and deploy, stop and re-domain apps, and the
// env answers carry secret values. Coolify's API has no HTTPS route yet, so the default is
// an SSH tunnel to the VPS (the bytes ride ssh, never plain HTTP across the internet).
// A non-loopback `http:` base is refused unless the caller opts in explicitly.
export const COOLIFY_BASE_URL = "http://127.0.0.1:8000/api/v1";
export const COOLIFY_TUNNEL_COMMAND =
  "ssh -i ~/.ssh/pocketbase-cds -N -L 8000:127.0.0.1:8000 root@82.180.132.176";
const TIMEOUT_MS = 30_000;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** A Coolify base URL that would send the token in cleartext over the network. */
export class CoolifyInsecureUrl extends Error {
  override name = "CoolifyInsecureUrl";
  constructor() {
    super(
      `Coolify API over plain http to a non-loopback host is refused: open the SSH tunnel (${COOLIFY_TUNNEL_COMMAND}) and use ${COOLIFY_BASE_URL}, or an https:// URL`,
    );
  }
}

/** True for https:, or http: to a loopback host (an SSH tunnel). */
export function isSecureCoolifyUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && LOOPBACK.has(u.hostname.toLowerCase());
}

export type CoolifyEndpoint = keyof CoolifyApi;

/** A Coolify call failed. Status 0 = no HTTP answer (network, timeout). */
export class CoolifyError extends Error {
  override name = "CoolifyError";
  readonly status: number;
  readonly endpoint: CoolifyEndpoint;
  constructor(status: number, endpoint: CoolifyEndpoint) {
    super(
      status === 0
        ? `Coolify ${endpoint}: no answer`
        : `Coolify ${endpoint} answered ${status}`,
    );
    this.status = status;
    this.endpoint = endpoint;
  }
}

export type CoolifyApiOptions = {
  baseUrl?: string;
  token: string;
  fetch?: typeof fetch;
  /** Explicit opt-in to plain http to a non-loopback host (WR-B05). Never the default. */
  allowInsecureHttp?: boolean;
};

type Json = Record<string, unknown>;

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function strOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function toApp(raw: Json): CoolifyApp {
  return {
    uuid: str(raw.uuid),
    fqdn: str(raw.fqdn),
    status: str(raw.status),
    git_repository: str(raw.git_repository),
    git_branch: str(raw.git_branch),
    build_pack: str(raw.build_pack),
    ports_exposes: str(raw.ports_exposes),
    dockerfile_location: strOrNull(raw.dockerfile_location),
    health_check_path: strOrNull(raw.health_check_path),
  };
}

/**
 * The env list came back without values: the token lacks Coolify's `read:sensitive`
 * permission, so the rows cannot be compared. preflight shows this class name only.
 */
export class CoolifyValuesHidden extends Error {
  override name = "CoolifyValuesHidden";
  constructor() {
    super("Coolify env values are hidden: the token needs read:sensitive");
  }
}

function hasValue(raw: Json): boolean {
  return "value" in raw || "real_value" in raw;
}

function toEnv(raw: Json): CoolifyEnvVar {
  const buildtime = raw.is_buildtime ?? raw.is_build_time;
  return {
    key: str(raw.key),
    value: str(raw.value ?? raw.real_value),
    is_preview: raw.is_preview === true,
    is_buildtime: buildtime === true,
  };
}

/** The real adapter. Every call has a 30 s timeout. */
export function coolifyApi(opts: CoolifyApiOptions): CoolifyApi {
  const token = opts.token.trim();
  if (token === "") throw new Error("Coolify token is empty");
  const base = (opts.baseUrl ?? COOLIFY_BASE_URL).replace(/\/+$/, "");
  if (!isSecureCoolifyUrl(base) && !opts.allowInsecureHttp) {
    throw new CoolifyInsecureUrl();
  }
  const doFetch = opts.fetch ?? fetch;
  const id = (uuid: string) => encodeURIComponent(uuid);

  async function call(
    endpoint: CoolifyEndpoint,
    method: string,
    path: string,
    body?: Json,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    };
    if (body) headers["content-type"] = "application/json";
    try {
      return await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // The fetch error can quote the request; drop it.
      throw new CoolifyError(0, endpoint);
    }
  }

  async function ok(
    endpoint: CoolifyEndpoint,
    res: Response,
  ): Promise<unknown> {
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new CoolifyError(res.status, endpoint);
    }
    const text = await res.text();
    if (text.trim() === "") return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  /** POST, and on 405 the same path as GET (older Coolify routes). */
  async function postOrGet(
    endpoint: CoolifyEndpoint,
    path: string,
  ): Promise<unknown> {
    let res = await call(endpoint, "POST", path);
    if (res.status === 405) {
      await res.body?.cancel().catch(() => undefined);
      res = await call(endpoint, "GET", path);
    }
    return ok(endpoint, res);
  }

  return {
    async getApp(uuid) {
      const raw = await ok(
        "getApp",
        await call("getApp", "GET", `/applications/${id(uuid)}`),
      );
      if (!raw || typeof raw !== "object")
        throw new CoolifyError(200, "getApp");
      return toApp(raw as Json);
    },
    async listEnvKeys(uuid) {
      const raw = await ok(
        "listEnvKeys",
        await call("listEnvKeys", "GET", `/applications/${id(uuid)}/envs`),
      );
      if (!Array.isArray(raw)) throw new CoolifyError(200, "listEnvKeys");
      const rows = raw.filter((r): r is Json => !!r && typeof r === "object");
      // Without read:sensitive Coolify drops the value field entirely; a set key would then
      // look missing. Refuse rather than report a false "missing" (15-25 check rehearsal).
      if (rows.some((r) => !hasValue(r))) throw new CoolifyValuesHidden();
      return rows.map(toEnv);
    },
    async setDomains(uuid, domains) {
      await ok(
        "setDomains",
        await call("setDomains", "PATCH", `/applications/${id(uuid)}`, {
          domains,
        }),
      );
    },
    async deploy(uuid, force) {
      const raw = (await postOrGet(
        "deploy",
        `/deploy?uuid=${id(uuid)}&force=${force ? "true" : "false"}`,
      )) as { deployments?: { deployment_uuid?: unknown }[] } | null;
      return str(raw?.deployments?.[0]?.deployment_uuid);
    },
    async deploymentStatus(deploymentId) {
      const raw = await ok(
        "deploymentStatus",
        await call(
          "deploymentStatus",
          "GET",
          `/deployments/${id(deploymentId)}`,
        ),
      );
      if (!raw || typeof raw !== "object")
        throw new CoolifyError(200, "deploymentStatus");
      return str((raw as Json).status);
    },
    async stop(uuid) {
      await postOrGet("stop", `/applications/${id(uuid)}/stop`);
    },
    async start(uuid) {
      await postOrGet("start", `/applications/${id(uuid)}/start`);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------------------------

/** Trim whitespace and one pair of surrounding quotes; empty -> null. */
export function parseCoolifyToken(raw: string): string | null {
  let v = raw.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith('"') && v.endsWith('"')))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v === "" ? null : v;
}

export type ReadTokenOptions = {
  home?: string;
  cwd?: string;
  readFile?: (path: string) => string;
};

/**
 * `~/.coolify_api_token`, else `.env.local` `COOLIFY_API_TOKEN` (CLAUDE.md: the .env.local
 * value is single-quoted). Returns null when neither has one. Never logs.
 */
export function readCoolifyToken(opts: ReadTokenOptions = {}): string | null {
  const read = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const home = opts.home ?? homedir();
  const cwd = opts.cwd ?? process.cwd();
  try {
    const t = parseCoolifyToken(read(join(home, ".coolify_api_token")));
    if (t) return t;
  } catch {
    // fall through to .env.local
  }
  try {
    for (const line of read(join(cwd, ".env.local")).split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?COOLIFY_API_TOKEN\s*=(.*)$/.exec(line);
      if (m) return parseCoolifyToken(m[1]!);
    }
  } catch {
    // no .env.local
  }
  return null;
}
