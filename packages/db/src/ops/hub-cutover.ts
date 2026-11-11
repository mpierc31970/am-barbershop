// packages/db/src/ops/hub-cutover.ts (P15, HUB-04, D62).
// Owner: 15-24 (pure planner + ports). 15-25 adds the real adapters in ./coolify.ts and the CLI.
//
// The old marketing site retires once, safely: preflight is read-only, apply needs the apex
// typed back, and a failed deploy or verify rolls back on its own (CONTEXT A4-Q1..Q4).
// Every effect is injected, so the logic is proven against ./fake-coolify with no network.
//
// Hard limits (CLAUDE.md): the planner never names the old site's database container, never
// touches the api./pb. records, never deletes a Coolify app (D62: stop, never delete) and
// never asks Coolify to override a domain conflict. A 409 means a step was skipped.

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------

export type CutoverConfig = {
  readonly apex: string;
  readonly www: string;
  readonly oldAppUuid: string;
  readonly prodAppUuid: string;
  readonly prodSslipUrl: string;
  readonly edgeIpv4: string;
  readonly expectedRepo: string;
  readonly expectedBranch: string;
  readonly expectedPort: string;
  readonly healthPath: string;
  readonly hubMarker: string;
  readonly prodPbDataPath: string;
};

export const HUB_CUTOVER_DEFAULTS: CutoverConfig = Object.freeze({
  apex: "connectionsdesignstudios.com",
  www: "www.connectionsdesignstudios.com",
  oldAppUuid: "vok4o448cw0ggws08cg40048",
  prodAppUuid: "3l6gwamoblvy8znte9nsxbuv",
  prodSslipUrl: "http://3l6gwamoblvy8znte9nsxbuv.82.180.132.176.sslip.io",
  edgeIpv4: "82.180.132.176",
  expectedRepo: "mpierc31970/cds-website",
  expectedBranch: "main",
  expectedPort: "3000",
  healthPath: "/api/health",
  hubMarker: '<meta name="cds-surface" content="hub"',
  prodPbDataPath: "/root/pocketbase-cdsp-prod/pb_data/data.db",
});

// ---------------------------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------------------------

/** The Coolify application fields the cutover reads. */
export type CoolifyApp = {
  uuid: string;
  fqdn: string;
  status: string;
  git_repository: string;
  git_branch: string;
  build_pack: string;
  ports_exposes: string;
  dockerfile_location: string | null;
  health_check_path: string | null;
};

/** One env row. `value` is compared in memory only; it never reaches a row, a log or stdout. */
export type CoolifyEnvVar = {
  key: string;
  value: string;
  is_preview: boolean;
  is_buildtime: boolean;
};

/** The Coolify API surface the cutover may use. There is no delete, by design (D62). */
export interface CoolifyApi {
  getApp(uuid: string): Promise<CoolifyApp>;
  listEnvKeys(uuid: string): Promise<CoolifyEnvVar[]>;
  /** PATCH /applications/{uuid} { domains }. Comma-separated URLs. Never overrides a conflict. */
  setDomains(uuid: string, domains: string): Promise<void>;
  /** Queues a deployment and returns its id at once; the build runs on afterwards. */
  deploy(uuid: string, force: boolean): Promise<string>;
  /**
   * GET /deployments/{id}: Coolify's status for one deployment (`queued`, `in_progress`,
   * `finished`, `failed`, `cancelled-by-user`). Read-only.
   */
  deploymentStatus(deploymentId: string): Promise<string>;
  stop(uuid: string): Promise<void>;
  start(uuid: string): Promise<void>;
}

/** The method names of CoolifyApi, exactly (a type check keeps it exhaustive). */
export const COOLIFY_API_METHODS = Object.freeze([
  "getApp",
  "listEnvKeys",
  "setDomains",
  "deploy",
  "deploymentStatus",
  "stop",
  "start",
] as const satisfies readonly (keyof CoolifyApi)[]);

type MissingCoolifyMethod = Exclude<
  keyof CoolifyApi,
  (typeof COOLIFY_API_METHODS)[number]
>;
const _allCoolifyMethodsListed: [MissingCoolifyMethod] extends [never]
  ? true
  : never = true;
void _allCoolifyMethodsListed;

/** The methods that change Coolify. preflight() calls none of them. */
export const COOLIFY_WRITE_METHODS = Object.freeze([
  "setDomains",
  "deploy",
  "stop",
  "start",
] as const satisfies readonly (keyof CoolifyApi)[]);

export type PublicResolver = "1.1.1.1" | "8.8.8.8";
export const CUTOVER_RESOLVERS: readonly PublicResolver[] = Object.freeze([
  "1.1.1.1",
  "8.8.8.8",
]);

export type Resolver = {
  resolve4(host: string, server: PublicResolver): Promise<string[]>;
};

export type ProbeResponse = {
  status: number;
  body: string;
  headers: Record<string, string>;
};
export type HttpsProbe = (url: string) => Promise<ProbeResponse>;

export type MigrationsReader = {
  applied(): Promise<string[]>;
  expected(): Promise<string[]>;
};

export type SavedCutoverState = {
  oldFqdn: string;
  prodFqdn: string;
  at: string;
};

export type StateStore = {
  save(state: SavedCutoverState): Promise<void>;
  load(): Promise<SavedCutoverState | null>;
};

/** One dated runbook line: `YYYY-MM-DD HH:MM UTC · <step> · <ok|failed>`. */
export type LogSink = (line: string) => void;

export type CutoverReadiness = {
  claimsVerified: number;
  proofConfirmed: number;
  parityComplete: boolean;
  mailboxes: boolean;
};

export type CutoverDeps = {
  cfg: CutoverConfig;
  coolify: CoolifyApi;
  resolver: Resolver;
  probe: HttpsProbe;
  migrations: MigrationsReader;
  state: StateStore;
  log: LogSink;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  readiness: CutoverReadiness;
  /** Verify polling: attempts and the wait between them. Defaults 30 x 10 s. */
  verifyAttempts?: number;
  verifyIntervalMs?: number;
  /**
   * Deployment polling (WR-B02): `deploy()` only queues a build, so every deploy is waited on
   * until Coolify reports it finished. Defaults 90 x 10 s (15 minutes, room for a fresh build).
   */
  deployAttempts?: number;
  deployIntervalMs?: number;
};

// ---------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------

export type StepKey =
  | "preflight"
  | "save-state"
  | "free-old"
  | "redeploy-old"
  | "assign-prod"
  | "deploy-prod"
  | "verify"
  | "stop-old";

export type Step = { n: number; key: StepKey; text: string };

export type CheckStatus = "PASS" | "FAIL" | "WARN";
export type CheckRow = {
  id: string;
  status: CheckStatus;
  label: string;
  hint: string;
};

export type RollbackResult = { ok: boolean; failed: string[] };

export type CutoverResult =
  | { ok: true; rolledBack: false; saved: SavedCutoverState; steps: StepKey[] }
  | {
      ok: false;
      rolledBack: boolean;
      failedStep: StepKey;
      saved: SavedCutoverState;
      steps: StepKey[];
      rollback: RollbackResult | null;
    };

export class CutoverRefused extends Error {
  override name = "CutoverRefused";
}

export class CutoverConfigError extends Error {
  override name = "CutoverConfigError";
}

class CutoverStepFailed extends Error {
  override name = "CutoverStepFailed";
}

// ---------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------

/** The data-VPS records the cutover must never touch (CLAUDE.md). */
const FORBIDDEN_HOSTS = Object.freeze([
  "api.connectionsdesignstudios.com",
  "pb.connectionsdesignstudios.com",
]);

/** The only PocketBase data file the migrations check may read (production, never the old site's). */
const PROD_PB_PREFIX = "/root/pocketbase-cdsp-prod/";

/** The old site's database container name, minus the trailing `p` ours carries. */
const OLD_DB_NAME = /pocketbase-cds(?!p)/;

function hostsIn(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return new URL(s).hostname.toLowerCase();
      } catch {
        return s.toLowerCase();
      }
    });
}

function refuseForbiddenHosts(value: string, what: string): void {
  for (const h of hostsIn(value)) {
    if (FORBIDDEN_HOSTS.some((f) => h === f || h.endsWith(f))) {
      throw new CutoverConfigError(
        `${what} names ${h}: the api. and pb. records are never touched by the cutover`,
      );
    }
  }
}

/** Throws unless the config only names the hub's own hosts, apps and the production PB. */
export function assertCutoverConfig(cfg: CutoverConfig): void {
  refuseForbiddenHosts(cfg.apex, "apex");
  refuseForbiddenHosts(cfg.www, "www");
  refuseForbiddenHosts(cfg.prodSslipUrl, "prodSslipUrl");
  if (!cfg.prodPbDataPath.startsWith(PROD_PB_PREFIX)) {
    throw new CutoverConfigError(
      `prodPbDataPath must be under ${PROD_PB_PREFIX} (production PocketBase only)`,
    );
  }
  for (const [field, value] of Object.entries(cfg)) {
    if (typeof value === "string" && OLD_DB_NAME.test(value)) {
      throw new CutoverConfigError(
        `${field} names the old site's database: never touched`,
      );
    }
  }
  if (cfg.oldAppUuid === cfg.prodAppUuid) {
    throw new CutoverConfigError("oldAppUuid and prodAppUuid must differ");
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function stamp(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * Best-effort (WR-B03): the CLI's sink appends to the runbook, which can throw (EBUSY/EPERM on
 * Windows). A log write must never fail a step, skip a rollback or abort a rollback step.
 */
function logStep(deps: CutoverDeps, step: string, ok: boolean): void {
  try {
    deps.log(`${stamp(deps.now())} · ${step} · ${ok ? "ok" : "failed"}`);
  } catch {
    // never block a step on the log
  }
}

/** The error's class name only: messages can carry env values or tokens. */
function errName(e: unknown): string {
  return e instanceof Error ? e.constructor.name : typeof e;
}

function oldSslipUrl(cfg: CutoverConfig): string {
  return `http://${cfg.oldAppUuid}.${cfg.edgeIpv4}.sslip.io`;
}

function prodDomains(cfg: CutoverConfig): string {
  return `https://${cfg.apex},https://${cfg.www}`;
}

function normalizeRepo(repo: string): string {
  return repo
    .trim()
    .replace(/^git@github\.com:/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** The only domain write the planner makes: guarded, two known apps, no conflict override. */
async function setDomainsSafe(
  deps: CutoverDeps,
  uuid: string,
  domains: string,
): Promise<void> {
  const { cfg } = deps;
  if (uuid !== cfg.oldAppUuid && uuid !== cfg.prodAppUuid) {
    throw new CutoverConfigError(
      "setDomains may only touch the old or prod app",
    );
  }
  refuseForbiddenHosts(domains, "domains");
  await deps.coolify.setDomains(uuid, domains);
}

// ---------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------

/** The apply steps in order (A4-Q3, RESEARCH Pattern 8). `plan` and `--dry-run` print these. */
export function cutoverPlan(cfg: CutoverConfig): Step[] {
  assertCutoverConfig(cfg);
  const steps: [StepKey, string][] = [
    [
      "preflight",
      "Run every check read-only; stop on any FAIL. Type the apex to confirm.",
    ],
    [
      "save-state",
      `Save both apps' current domains (old app ${cfg.oldAppUuid}, prod ${cfg.prodAppUuid}) for rollback.`,
    ],
    [
      "free-old",
      `Move the old app off the apex: domains -> ${oldSslipUrl(cfg)}.`,
    ],
    [
      "redeploy-old",
      "Redeploy the old app (force=false) and wait until Coolify reports it finished, so the proxy drops its apex and www routes; only one app routes the names from here on.",
    ],
    [
      "assign-prod",
      `Give prod the real names: domains -> ${prodDomains(cfg)}.`,
    ],
    [
      "deploy-prod",
      "Deploy prod (force=false) and wait until Coolify reports it finished (up to 15 minutes), so the proxy picks up the new names and issues certificates.",
    ],
    [
      "verify",
      `Poll HTTPS on ${cfg.apex} and ${cfg.www}: hub marker on both /, /start, /report, ${cfg.healthPath} ok. Any failure rolls back on its own.`,
    ],
    [
      "stop-old",
      "Stop the old app (never delete it, D62); it stays on archive/marketing-site-v1 as the fallback.",
    ],
  ];
  return steps.map(([key, text], i) => ({ n: i + 1, key, text }));
}

// ---------------------------------------------------------------------------------------------
// Preflight (read-only)
// ---------------------------------------------------------------------------------------------

type RowBody = { status: CheckStatus; label: string; hint: string };

async function checkRow(
  id: string,
  name: string,
  hint: string,
  fn: () => Promise<RowBody>,
): Promise<CheckRow> {
  try {
    return { id, ...(await fn()) };
  } catch (e) {
    return {
      id,
      status: "FAIL",
      label: `${name}: check could not run (${errName(e)})`,
      hint,
    };
  }
}

/**
 * Read-only checks before apply. Calls only CoolifyApi.getApp/listEnvKeys, the resolver, the
 * HTTPS probe and the migrations reader. Env values are compared in memory and never appear
 * in a row (A4-Q2): rows name keys and match status only.
 */
export async function preflight(
  deps: CutoverDeps,
  opts: { expectSha?: string } = {},
): Promise<CheckRow[]> {
  const { cfg, coolify } = deps;
  assertCutoverConfig(cfg);
  const sslip = stripSlash(cfg.prodSslipUrl);
  const sslipHost = new URL(cfg.prodSslipUrl).hostname.toLowerCase();
  const rows: CheckRow[] = [];

  rows.push(
    await checkRow(
      "dns",
      "DNS",
      `Point the apex and www A records at ${cfg.edgeIpv4} (Hostinger zone), then wait for both resolvers.`,
      async () => {
        const bad: string[] = [];
        for (const host of [cfg.apex, cfg.www]) {
          for (const server of CUTOVER_RESOLVERS) {
            const answers = await deps.resolver.resolve4(host, server);
            if (
              answers.length === 0 ||
              answers.some((a) => a !== cfg.edgeIpv4)
            ) {
              bad.push(`${host} @${server}`);
            }
          }
        }
        return bad.length === 0
          ? {
              status: "PASS",
              label: `DNS: ${cfg.apex} and ${cfg.www} -> ${cfg.edgeIpv4} on 1.1.1.1 and 8.8.8.8`,
              hint: "",
            }
          : {
              status: "FAIL",
              label: `DNS: not ${cfg.edgeIpv4} for ${bad.join(", ")}`,
              hint: `Point the apex and www A records at ${cfg.edgeIpv4} (Hostinger zone), then wait for both resolvers.`,
            };
      },
    ),
  );

  const sourceHint =
    "prod is still the placeholder: switch it to the repo Dockerfile (HUMAN-CHECKS P1, GO-LIVE Launch)";
  rows.push(
    await checkRow("prod-source", "Prod source", sourceHint, async () => {
      const app = await coolify.getApp(cfg.prodAppUuid);
      const wrong: string[] = [];
      if (normalizeRepo(app.git_repository) !== cfg.expectedRepo)
        wrong.push(`repo (want ${cfg.expectedRepo})`);
      if (app.git_branch !== cfg.expectedBranch)
        wrong.push(`branch (want ${cfg.expectedBranch})`);
      if (app.dockerfile_location !== "/Dockerfile")
        wrong.push("dockerfile_location (want /Dockerfile)");
      if (String(app.ports_exposes).trim() !== cfg.expectedPort)
        wrong.push(`ports_exposes (want ${cfg.expectedPort})`);
      if (app.health_check_path !== cfg.healthPath)
        wrong.push(`health_check_path (want ${cfg.healthPath})`);
      return wrong.length === 0
        ? {
            status: "PASS",
            label: `Prod source: ${cfg.expectedRepo}@${cfg.expectedBranch}, /Dockerfile, port ${cfg.expectedPort}`,
            hint: "",
          }
        : {
            status: "FAIL",
            label: `Prod source: wrong ${wrong.join(", ")}`,
            hint: sourceHint,
          };
    }),
  );

  const envHint =
    "Set the missing or wrong keys on the prod app in Coolify (values never printed here); see docs/ops/hub-cutover.md.";
  rows.push(
    await checkRow("prod-env", "Prod env", envHint, async () => {
      const vars = (await coolify.listEnvKeys(cfg.prodAppUuid)).filter(
        (e) => !e.is_preview,
      );
      const get = (k: string) => vars.find((e) => e.key === k);
      const missing: string[] = [];
      const wrong: string[] = [];
      const need = (k: string, ok?: (e: CoolifyEnvVar) => boolean) => {
        const e = get(k);
        if (!e || e.value.trim() === "") missing.push(k);
        else if (ok && !ok(e)) wrong.push(k);
      };
      need("PLATFORM_HOSTS", (e) => {
        const hs = e.value.split(",").map((s) => s.trim().toLowerCase());
        return [cfg.apex, cfg.www, sslipHost].every((h) => hs.includes(h));
      });
      need(
        "CDS_PLATFORM_URL",
        (e) => stripSlash(e.value.trim()) === `https://${cfg.apex}`,
      );
      need("CDS_ENV", (e) => e.value.trim() === "production");
      need("APP_VERSION");
      need("PB_URL");
      need("PB_APP_KEY");
      need("CDS_JOB_TOKEN");
      need("NEXT_PUBLIC_TURNSTILE_SITE_KEY", (e) => e.is_buildtime);
      const secret = get("TURNSTILE_SECRET_KEY");
      const noSecret = !secret || secret.value.trim() === "";
      if (missing.length > 0 || wrong.length > 0) {
        const parts = [
          missing.length > 0 ? `missing ${missing.join(", ")}` : "",
          wrong.length > 0 ? `wrong ${wrong.join(", ")}` : "",
        ].filter(Boolean);
        return {
          status: "FAIL",
          label: `Prod env: ${parts.join("; ")}`,
          hint: envHint,
        };
      }
      if (noSecret) {
        return {
          status: "WARN",
          label: "Prod env: required keys match; TURNSTILE_SECRET_KEY absent",
          hint: "Without TURNSTILE_SECRET_KEY production forms fail closed (GO-LIVE Turnstile row).",
        };
      }
      return {
        status: "PASS",
        label: "Prod env: required keys present and matching",
        hint: "",
      };
    }),
  );

  const healthHint =
    "Deploy prod from main and check APP_VERSION matches the commit (or pass --expect-sha).";
  rows.push(
    await checkRow("prod-health", "Prod health", healthHint, async () => {
      const res = await deps.probe(`${sslip}${cfg.healthPath}`);
      if (res.status !== 200) {
        return {
          status: "FAIL",
          label: `Prod health: ${cfg.healthPath} answered ${res.status}`,
          hint: healthHint,
        };
      }
      let body: { status?: unknown; version?: unknown };
      try {
        body = JSON.parse(res.body) as typeof body;
      } catch {
        return {
          status: "FAIL",
          label: `Prod health: ${cfg.healthPath} is not JSON`,
          hint: healthHint,
        };
      }
      if (body.status !== "ok") {
        return {
          status: "FAIL",
          label: "Prod health: status is not ok",
          hint: healthHint,
        };
      }
      if (opts.expectSha && body.version !== opts.expectSha) {
        return {
          status: "FAIL",
          label: "Prod health: version does not match the expected commit",
          hint: healthHint,
        };
      }
      return {
        status: "PASS",
        label: opts.expectSha
          ? "Prod health: ok, version matches"
          : "Prod health: ok (no expected commit given)",
        hint: "",
      };
    }),
  );

  const markerHint =
    "Prod is not serving the hub yet: deploy main and add the sslip host to PLATFORM_HOSTS.";
  rows.push(
    await checkRow("hub-marker", "Hub marker", markerHint, async () => {
      const res = await deps.probe(`${sslip}/`);
      return res.status === 200 && res.body.includes(cfg.hubMarker)
        ? { status: "PASS", label: "Hub marker: present on prod /", hint: "" }
        : {
            status: "FAIL",
            label: `Hub marker: missing on prod / (HTTP ${res.status})`,
            hint: markerHint,
          };
    }),
  );

  const migHint =
    "Push the assembled migrations to production PocketBase (CLAUDE.md, npm run db:migrations:assemble).";
  rows.push(
    await checkRow("prod-migrations", "Prod migrations", migHint, async () => {
      const [expected, applied] = await Promise.all([
        deps.migrations.expected(),
        deps.migrations.applied(),
      ]);
      const have = new Set(applied);
      const missing = expected.filter((f) => !have.has(f));
      if (missing.length === 0) {
        return {
          status: "PASS",
          label: `Prod migrations: all ${expected.length} applied`,
          hint: "",
        };
      }
      const shown = missing.slice(0, 8).join(", ");
      const more = missing.length > 8 ? ` (+${missing.length - 8} more)` : "";
      return {
        status: "FAIL",
        label: `Prod migrations: ${missing.length} of ${expected.length} missing: ${shown}${more}`,
        hint: migHint,
      };
    }),
  );

  const oldHint =
    "The old app should still hold the apex before apply; if a cutover already ran, use the saved state.";
  rows.push(
    await checkRow("old-app", "Old app", oldHint, async () => {
      const app = await coolify.getApp(cfg.oldAppUuid);
      const holds = hostsIn(app.fqdn).includes(cfg.apex);
      return holds
        ? {
            status: "PASS",
            label: `Old app: ${app.status} · ${app.fqdn}`,
            hint: "",
          }
        : {
            status: "FAIL",
            label: `Old app: ${app.status} · does not hold ${cfg.apex}`,
            hint: oldHint,
          };
    }),
  );

  const r = deps.readiness;
  const ready = (
    id: string,
    ok: boolean,
    passLabel: string,
    warnLabel: string,
    hint: string,
  ): CheckRow =>
    ok
      ? { id, status: "PASS", label: passLabel, hint: "" }
      : { id, status: "WARN", label: warnLabel, hint };
  rows.push(
    ready(
      "ready-claims",
      r.claimsVerified >= 1,
      `Claims: ${r.claimsVerified} verified`,
      "Claims: none verified (comparison stays hidden)",
      "Verify the comparison claims (HUMAN-CHECKS P15).",
    ),
    ready(
      "ready-proof",
      r.proofConfirmed >= 1,
      `Proof: ${r.proofConfirmed} confirmed`,
      "Proof: none confirmed (production shows none)",
      "Confirm proof entries (HUMAN-CHECKS P15).",
    ),
    ready(
      "ready-parity",
      r.parityComplete,
      "Parity inventory: complete",
      "Parity inventory: incomplete",
      "Finish the old-site parity inventory before retiring it.",
    ),
    ready(
      "ready-mailboxes",
      r.mailboxes,
      "Mailboxes: ready",
      "Mailboxes: not confirmed",
      "Confirm hello@ and abuse@ receive mail (GO-LIVE).",
    ),
  );

  return rows;
}

// ---------------------------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------------------------

async function hubFailures(
  deps: CutoverDeps,
  expectSha: string | undefined,
): Promise<string[]> {
  const { cfg } = deps;
  const apex = `https://${cfg.apex}`;
  const checks: [string, string, (r: ProbeResponse) => boolean][] = [
    [
      "apex /",
      `${apex}/`,
      (r) => r.status === 200 && r.body.includes(cfg.hubMarker),
    ],
    [
      "www /",
      `https://${cfg.www}/`,
      (r) => r.status === 200 && r.body.includes(cfg.hubMarker),
    ],
    ["/start", `${apex}/start`, (r) => r.status === 200],
    ["/report", `${apex}/report?site=example.com`, (r) => r.status === 200],
    [
      cfg.healthPath,
      `${apex}${cfg.healthPath}`,
      (r) => {
        if (r.status !== 200) return false;
        try {
          const b = JSON.parse(r.body) as {
            status?: unknown;
            version?: unknown;
          };
          return b.status === "ok" && (!expectSha || b.version === expectSha);
        } catch {
          return false;
        }
      },
    ],
  ];
  const failed: string[] = [];
  for (const [name, url, ok] of checks) {
    try {
      if (!ok(await deps.probe(url))) failed.push(name);
    } catch (e) {
      failed.push(`${name} (${errName(e)})`);
    }
  }
  return failed;
}

/** Rollback verify: the apex answers 200 and is not the hub (any 200 could be prod itself). */
async function oldSiteFailures(deps: CutoverDeps): Promise<string[]> {
  const { cfg } = deps;
  try {
    const r = await deps.probe(`https://${cfg.apex}/`);
    if (r.status !== 200) return [`apex / ${r.status}`];
    return r.body.includes(cfg.hubMarker)
      ? ["apex / still serves the hub"]
      : [];
  } catch (e) {
    return [`apex / (${errName(e)})`];
  }
}

async function poll(
  deps: CutoverDeps,
  attempt: () => Promise<string[]>,
  what: string,
): Promise<void> {
  const attempts = Math.max(1, deps.verifyAttempts ?? 30);
  const interval = deps.verifyIntervalMs ?? 10_000;
  let last: string[] = [];
  for (let i = 1; i <= attempts; i++) {
    last = await attempt();
    if (last.length === 0) return;
    if (i < attempts) await deps.sleep(interval);
  }
  throw new CutoverStepFailed(`${what}: ${last.join(", ")}`);
}

const DEPLOY_DONE = "finished";
const isDeployFailed = (s: string) => s === "failed" || s.startsWith("cancel");

/**
 * Wait for one deployment to end. Resolves with its final status; throws only when it is
 * still running after the deploy window. A status read that fails counts as "not yet".
 */
async function waitDeployment(
  deps: CutoverDeps,
  deploymentId: string,
  what: string,
): Promise<string> {
  const attempts = Math.max(1, deps.deployAttempts ?? 90);
  const interval = deps.deployIntervalMs ?? 10_000;
  for (let i = 1; i <= attempts; i++) {
    let status = "";
    try {
      status = (
        await deps.coolify.deploymentStatus(deploymentId)
      ).toLowerCase();
    } catch {
      status = "";
    }
    if (status === DEPLOY_DONE || isDeployFailed(status)) return status;
    if (i < attempts) await deps.sleep(interval);
  }
  throw new CutoverStepFailed(`${what}: deployment still running`);
}

/**
 * Deploy (force=false) and wait until Coolify says the deployment finished: the proxy routes
 * the app's domains as of that deployment only once it is live (Pitfall 7 / A1). The id is
 * handed to `track` while it runs, so a rollback can wait for it rather than race it.
 */
async function deployAndWait(
  deps: CutoverDeps,
  uuid: string,
  what: string,
  track?: (id: string | null) => void,
): Promise<void> {
  const id = await deps.coolify.deploy(uuid, false);
  if (!id) throw new CutoverStepFailed(`${what}: no deployment id`);
  track?.(id);
  const status = await waitDeployment(deps, id, what);
  track?.(null);
  if (status !== DEPLOY_DONE) {
    throw new CutoverStepFailed(`${what}: deployment ${status}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Apply + rollback
// ---------------------------------------------------------------------------------------------

/**
 * The cutover (A4-Q3). Refuses unless `confirm` is the apex and preflight has no FAIL. Any
 * failure from freeing the old app's domains through verify rolls back on its own; the old
 * app is stopped (never deleted) only after verify passed.
 */
export async function applyCutover(
  deps: CutoverDeps,
  opts: { confirm: string; expectSha?: string },
): Promise<CutoverResult> {
  const { cfg, coolify } = deps;
  assertCutoverConfig(cfg);
  if (opts.confirm !== cfg.apex) {
    throw new CutoverRefused(`Type the apex (${cfg.apex}) exactly to confirm.`);
  }

  const rows = await preflight(deps, { expectSha: opts.expectSha });
  const fails = rows.filter((r) => r.status === "FAIL");
  if (fails.length > 0) {
    logStep(deps, "preflight", false);
    throw new CutoverRefused(
      `Preflight has ${fails.length} FAIL: ${fails.map((r) => r.id).join(", ")}.`,
    );
  }
  const steps: StepKey[] = ["preflight"];
  logStep(deps, "preflight", true);

  const oldApp = await coolify.getApp(cfg.oldAppUuid);
  const prodApp = await coolify.getApp(cfg.prodAppUuid);
  refuseForbiddenHosts(oldApp.fqdn, "old app fqdn");
  const saved: SavedCutoverState = {
    oldFqdn: oldApp.fqdn,
    prodFqdn: prodApp.fqdn,
    at: deps.now().toISOString(),
  };
  await deps.state.save(saved);
  steps.push("save-state");
  logStep(deps, "save-state", true);

  let current: StepKey = "free-old";
  // A deployment that is still running when a step fails (WR-B02): rollback waits for it.
  const flight: { id: string | null } = { id: null };
  const track = (id: string | null) => {
    flight.id = id;
  };
  try {
    await setDomainsSafe(deps, cfg.oldAppUuid, oldSslipUrl(cfg));
    steps.push(current);
    logStep(deps, current, true);

    // A domain change reaches the proxy only on deploy (Pitfall 7 / A1): until the old app is
    // redeployed its container keeps routing the apex and www, and once prod is deployed two
    // routers would claim one host. D62 allows the short gap this leaves.
    current = "redeploy-old";
    await deployAndWait(deps, cfg.oldAppUuid, current, track);
    steps.push(current);
    logStep(deps, current, true);

    current = "assign-prod";
    await setDomainsSafe(deps, cfg.prodAppUuid, prodDomains(cfg));
    steps.push(current);
    logStep(deps, current, true);

    current = "deploy-prod";
    await deployAndWait(deps, cfg.prodAppUuid, current, track);
    steps.push(current);
    logStep(deps, current, true);

    current = "verify";
    await poll(deps, () => hubFailures(deps, opts.expectSha), "verify");
    steps.push(current);
    logStep(deps, current, true);
  } catch {
    // Roll back first, log after: nothing may stand between a failed step and the rollback.
    const rollback = await rollbackCutover(deps, saved, {
      inFlight: flight.id ? [flight.id] : [],
    });
    logStep(deps, current, false);
    return {
      ok: false,
      rolledBack: true,
      failedStep: current,
      saved,
      steps,
      rollback,
    };
  }

  // Verify passed: the hub serves the apex. A failed stop leaves the old app running with
  // no public domain, which is harmless; report it, never roll back a working cutover.
  try {
    await coolify.stop(cfg.oldAppUuid);
  } catch {
    logStep(deps, "stop-old", false);
    return {
      ok: false,
      rolledBack: false,
      failedStep: "stop-old",
      saved,
      steps,
      rollback: null,
    };
  }
  steps.push("stop-old");
  logStep(deps, "stop-old", true);
  return { ok: true, rolledBack: false, saved, steps };
}

/**
 * Put both apps back: prod to its sslip URL and redeployed (a domain change reaches the proxy
 * only on deploy, Pitfall 7 / A1, so without it prod's running container keeps routing the
 * apex), the old app to its saved domains and redeployed, then verify the apex answers 200
 * from the old site: a page carrying the hub marker means prod still answers, which is a
 * failure. Every sub-step runs even if one fails.
 *
 * `inFlight` names deployments apply started that had not finished (WR-B02). Rollback waits
 * for them to end first; otherwise one could finish after the rollback and route the apex to
 * prod again. Each redeploy here is waited on too.
 */
export async function rollbackCutover(
  deps: CutoverDeps,
  saved: SavedCutoverState,
  opts: { inFlight?: readonly string[] } = {},
): Promise<RollbackResult> {
  const { cfg } = deps;
  assertCutoverConfig(cfg);
  refuseForbiddenHosts(saved.oldFqdn, "saved old fqdn");

  const failed: string[] = [];
  const run = async (step: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      logStep(deps, step, true);
    } catch {
      failed.push(step);
      logStep(deps, step, false);
    }
  };

  const inFlight = opts.inFlight ?? [];
  if (inFlight.length > 0) {
    // Finished or failed both count: only a deployment still running is a risk.
    await run("rollback-wait-deploys", async () => {
      for (const id of inFlight) {
        await waitDeployment(deps, id, "rollback-wait-deploys");
      }
    });
  }
  await run("rollback-prod-domains", () =>
    setDomainsSafe(deps, cfg.prodAppUuid, cfg.prodSslipUrl),
  );
  await run("rollback-redeploy-prod", () =>
    deployAndWait(deps, cfg.prodAppUuid, "rollback-redeploy-prod"),
  );
  await run("rollback-old-domains", () =>
    setDomainsSafe(deps, cfg.oldAppUuid, saved.oldFqdn),
  );
  await run("rollback-deploy-old", () =>
    deployAndWait(deps, cfg.oldAppUuid, "rollback-deploy-old"),
  );
  await run("rollback-verify-old", () =>
    poll(deps, () => oldSiteFailures(deps), "rollback verify"),
  );
  return { ok: failed.length === 0, failed };
}
