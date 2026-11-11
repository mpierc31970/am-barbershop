// HUB-04 (D62): the cutover planner proven against a fake Coolify, fake DNS, fake HTTPS and a
// fake migrations reader. No network, no Coolify writes (RESEARCH anti-pattern).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COOLIFY_API_METHODS,
  COOLIFY_WRITE_METHODS,
  CutoverRefused,
  HUB_CUTOVER_DEFAULTS,
  applyCutover,
  assertCutoverConfig,
  cutoverPlan,
  preflight,
  rollbackCutover,
  type CoolifyApp,
  type CoolifyEnvVar,
  type CutoverDeps,
  type CutoverReadiness,
  type ProbeResponse,
  type SavedCutoverState,
} from "./hub-cutover";
import { fakeCoolify, fqdnHosts, type FakeCoolify } from "./fake-coolify";

const cfg = HUB_CUTOVER_DEFAULTS;
const OLD = cfg.oldAppUuid;
const PROD = cfg.prodAppUuid;
const SSLIP_HOST = new URL(cfg.prodSslipUrl).hostname;
const OLD_FQDN =
  "https://www.connectionsdesignstudios.com,https://connectionsdesignstudios.com";
const SHA = "0123456789abcdef0123456789abcdef01234567";

// Distinctive env values: none of them may appear in any row, label, hint or log line.
const SECRET_VALUES = {
  PB_URL: "https://pb-VALUE-LEAK-CHECK-1.example",
  PB_APP_KEY: "pbkey-VALUE-LEAK-CHECK-2",
  CDS_JOB_TOKEN: "jobtoken-VALUE-LEAK-CHECK-3",
  APP_VERSION: "appversion-VALUE-LEAK-CHECK-4",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "sitekey-VALUE-LEAK-CHECK-5",
  TURNSTILE_SECRET_KEY: "secretkey-VALUE-LEAK-CHECK-6",
} as const;

function env(key: string, value: string, is_buildtime = false): CoolifyEnvVar {
  return { key, value, is_preview: false, is_buildtime };
}

const oldApp: CoolifyApp = {
  uuid: OLD,
  fqdn: OLD_FQDN,
  status: "running:healthy",
  git_repository: "git@github.com:mpierc31970/cds-website.git",
  git_branch: "archive/marketing-site-v1",
  build_pack: "nixpacks",
  ports_exposes: "3000",
  dockerfile_location: null,
  health_check_path: "/",
};

const goodProd: CoolifyApp = {
  uuid: PROD,
  fqdn: cfg.prodSslipUrl,
  status: "running:healthy",
  git_repository: "git@github.com:mpierc31970/cds-website.git",
  git_branch: "main",
  build_pack: "dockerfile",
  ports_exposes: "3000",
  dockerfile_location: "/Dockerfile",
  health_check_path: "/api/health",
};

const placeholderProd: CoolifyApp = {
  uuid: PROD,
  fqdn: cfg.prodSslipUrl,
  status: "running:healthy",
  git_repository: "coollabsio/coolify",
  git_branch: "main",
  build_pack: "dockerfile",
  ports_exposes: "80",
  dockerfile_location: null,
  health_check_path: "/",
};

const goodEnvs: CoolifyEnvVar[] = [
  env("PLATFORM_HOSTS", `${cfg.apex},${cfg.www},${SSLIP_HOST}`),
  env("CDS_PLATFORM_URL", `https://${cfg.apex}`),
  env("CDS_ENV", "production"),
  env("APP_VERSION", SECRET_VALUES.APP_VERSION),
  env("PB_URL", SECRET_VALUES.PB_URL),
  env("PB_APP_KEY", SECRET_VALUES.PB_APP_KEY),
  env("CDS_JOB_TOKEN", SECRET_VALUES.CDS_JOB_TOKEN),
  env(
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    SECRET_VALUES.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    true,
  ),
  env("TURNSTILE_SECRET_KEY", SECRET_VALUES.TURNSTILE_SECRET_KEY),
];

const WRONG_URL_VALUE = "https://WRONG-VALUE-LEAK-CHECK-7.example";
const placeholderEnvs: CoolifyEnvVar[] = [
  env("CDS_ENV", "production"),
  env("PB_URL", SECRET_VALUES.PB_URL),
  env("TRUSTED_PROXY_HOPS", "1"),
  env("PB_APP_KEY", SECRET_VALUES.PB_APP_KEY),
  env("CDS_PLATFORM_URL", WRONG_URL_VALUE),
];

const MIGRATIONS = [
  "1790000001_core.js",
  "1790000870_p13.js",
  "1790000900_p15.js",
];

const NO_READINESS: CutoverReadiness = {
  claimsVerified: 0,
  proofConfirmed: 0,
  parityComplete: false,
  mailboxes: false,
};
const FULL_READINESS: CutoverReadiness = {
  claimsVerified: 3,
  proofConfirmed: 2,
  parityComplete: true,
  mailboxes: true,
};

type World = {
  fake: FakeCoolify;
  deps: CutoverDeps;
  logs: string[];
  saved: SavedCutoverState[];
  sleeps: number[];
  probed: string[];
  /** Hosts that two running apps' proxy labels claimed at once, as probed. */
  conflicts: string[];
};

/**
 * A small simulated edge: a host is served by the running app whose proxy labels (its fqdn
 * at its last deploy, Pitfall 7 / A1) hold it. Prod serves the hub; the old app serves the
 * archive site. When both claim one host the proxy's choice is undefined: the edge records a
 * conflict and answers from prod (the worst case for a rollback). `hub: "placeholder"` is
 * today's nginx page; `"broken"` answers 502.
 */
function world(
  opts: {
    prod?: CoolifyApp;
    envs?: CoolifyEnvVar[];
    hub?: "ok" | "placeholder" | "broken";
    applied?: string[];
    readiness?: CutoverReadiness;
    dns?: Record<string, string[]>;
  } = {},
): World {
  const fake = fakeCoolify({
    apps: [oldApp, opts.prod ?? goodProd],
    envs: { [PROD]: opts.envs ?? goodEnvs },
  });
  const logs: string[] = [];
  const saved: SavedCutoverState[] = [];
  const sleeps: number[] = [];
  const probed: string[] = [];
  const conflicts: string[] = [];
  const hub = opts.hub ?? "ok";

  const respond = (status: number, body = ""): ProbeResponse => ({
    status,
    body,
    headers: {},
  });

  const probe = async (url: string): Promise<ProbeResponse> => {
    probed.push(url);
    const u = new URL(url);
    const host = u.hostname;
    const holders = fake.routes(host);
    if (holders.length === 0) return respond(404, "no available server");
    if (holders.length > 1) conflicts.push(host);
    const holder = holders.includes(PROD) ? PROD : holders[0];
    if (holder === OLD) return respond(200, "<html>archive site</html>");
    if (hub === "broken") return respond(502, "bad gateway");
    if (hub === "placeholder") {
      return u.pathname === "/"
        ? respond(200, "<html>Welcome to nginx</html>")
        : respond(404, "not found");
    }
    switch (u.pathname) {
      case "/":
        return respond(
          200,
          `<html><head>${cfg.hubMarker}></head><body>CDS</body></html>`,
        );
      case "/start":
      case "/report":
        return respond(200, "<html>ok</html>");
      case cfg.healthPath:
        return respond(200, JSON.stringify({ status: "ok", version: SHA }));
      default:
        return respond(404, "not found");
    }
  };

  const deps: CutoverDeps = {
    cfg,
    coolify: fake,
    resolver: {
      resolve4: async (host) => opts.dns?.[host] ?? [cfg.edgeIpv4],
    },
    probe,
    migrations: {
      applied: async () => opts.applied ?? MIGRATIONS,
      expected: async () => MIGRATIONS,
    },
    state: {
      save: async (s) => {
        saved.push(s);
      },
      load: async () => saved.at(-1) ?? null,
    },
    log: (line) => logs.push(line),
    now: () => new Date("2026-10-17T14:05:09Z"),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    readiness: opts.readiness ?? FULL_READINESS,
    verifyAttempts: 3,
    verifyIntervalMs: 1000,
    deployAttempts: 3,
    deployIntervalMs: 500,
  };
  return { fake, deps, logs, saved, sleeps, probed, conflicts };
}

const writes = (fake: FakeCoolify) =>
  fake.calls.filter((c) =>
    (COOLIFY_WRITE_METHODS as readonly string[]).includes(c.method),
  );

describe("cutoverPlan", () => {
  it("lists the apply steps in the A4-Q3 order", () => {
    const steps = cutoverPlan(cfg);
    expect(steps.map((s) => s.key)).toEqual([
      "preflight",
      "save-state",
      "free-old",
      "redeploy-old",
      "assign-prod",
      "deploy-prod",
      "verify",
      "stop-old",
    ]);
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const stop = steps.find((s) => s.key === "stop-old");
    expect(stop?.text).toMatch(/never delete/i);
    for (const s of steps) expect(s.text.length).toBeGreaterThan(10);
  });
});

describe("preflight", () => {
  it("passes on a ready prod app (readiness gaps are WARN only)", async () => {
    const w = world({ readiness: NO_READINESS });
    const rows = await preflight(w.deps, { expectSha: SHA });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(byId).toMatchObject({
      dns: "PASS",
      "prod-source": "PASS",
      "prod-env": "PASS",
      "prod-health": "PASS",
      "hub-marker": "PASS",
      "prod-migrations": "PASS",
      "old-app": "PASS",
    });
    expect(rows.filter((r) => r.status === "FAIL")).toEqual([]);
    const readiness = rows.filter((r) => r.id.startsWith("ready-"));
    expect(readiness.length).toBe(4);
    for (const r of readiness) expect(r.status).toBe("WARN");
  });

  it("fails on today's placeholder prod app, with fix hints", async () => {
    const w = world({
      prod: placeholderProd,
      envs: placeholderEnvs,
      hub: "placeholder",
      applied: MIGRATIONS.slice(0, 1),
    });
    const rows = await preflight(w.deps, { expectSha: SHA });
    const row = (id: string) => rows.find((r) => r.id === id)!;
    expect(row("prod-source").status).toBe("FAIL");
    expect(row("prod-source").hint).toMatch(/placeholder/);
    expect(row("prod-source").hint).toMatch(/HUMAN-CHECKS P1/);
    expect(row("prod-env").status).toBe("FAIL");
    expect(row("prod-env").label).toMatch(/PLATFORM_HOSTS/);
    expect(row("prod-env").label).toMatch(/CDS_JOB_TOKEN/);
    expect(row("prod-env").label).toMatch(/CDS_PLATFORM_URL/);
    expect(row("prod-health").status).toBe("FAIL");
    expect(row("hub-marker").status).toBe("FAIL");
    expect(row("prod-migrations").status).toBe("FAIL");
    expect(row("prod-migrations").label).toMatch(/1790000900_p15\.js/);
    expect(row("dns").status).toBe("PASS");
  });

  it("fails dns when a public resolver answers another address", async () => {
    const w = world({ dns: { [cfg.www]: ["31.220.21.126"] } });
    const rows = await preflight(w.deps, { expectSha: SHA });
    const dns = rows.find((r) => r.id === "dns")!;
    expect(dns.status).toBe("FAIL");
    expect(dns.label).toMatch(/www\.connectionsdesignstudios\.com/);
  });

  it("never puts an env value in a row", async () => {
    for (const w of [
      world(),
      world({
        prod: placeholderProd,
        envs: placeholderEnvs,
        hub: "placeholder",
      }),
    ]) {
      const rows = await preflight(w.deps, { expectSha: SHA });
      const text = JSON.stringify(rows) + w.logs.join("\n");
      for (const v of [...Object.values(SECRET_VALUES), WRONG_URL_VALUE]) {
        expect(text).not.toContain(v);
      }
    }
  });

  it("is read-only: only getApp and listEnvKeys reach Coolify", async () => {
    const w = world({ prod: placeholderProd, envs: placeholderEnvs });
    await preflight(w.deps, { expectSha: SHA });
    expect(writes(w.fake)).toEqual([]);
    for (const c of w.fake.calls) {
      expect(["getApp", "listEnvKeys"]).toContain(c.method);
    }
  });

  it("turns a throwing port into a FAIL row naming the error class only", async () => {
    const w = world();
    w.fake.fail({
      method: "listEnvKeys",
      uuid: PROD,
      error: new TypeError(`leaked ${SECRET_VALUES.PB_APP_KEY}`),
    });
    const rows = await preflight(w.deps, { expectSha: SHA });
    const envRow = rows.find((r) => r.id === "prod-env")!;
    expect(envRow.status).toBe("FAIL");
    expect(envRow.label).toMatch(/TypeError/);
    expect(JSON.stringify(rows)).not.toContain(SECRET_VALUES.PB_APP_KEY);
  });
});

describe("applyCutover", () => {
  it("refuses a wrong confirmation and writes nothing", async () => {
    const w = world();
    await expect(
      applyCutover(w.deps, { confirm: "www.connectionsdesignstudios.com" }),
    ).rejects.toBeInstanceOf(CutoverRefused);
    expect(writes(w.fake)).toEqual([]);
    expect(w.saved).toEqual([]);
  });

  it("refuses while preflight has a FAIL, even with the apex typed", async () => {
    const w = world({
      prod: placeholderProd,
      envs: placeholderEnvs,
      hub: "placeholder",
    });
    await expect(
      applyCutover(w.deps, { confirm: cfg.apex, expectSha: SHA }),
    ).rejects.toBeInstanceOf(CutoverRefused);
    expect(writes(w.fake)).toEqual([]);
  });

  it("happy path: free, assign, deploy, verify, then stop (never delete)", async () => {
    const w = world();
    const result = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    expect(result.ok).toBe(true);
    expect(result.rolledBack).toBe(false);
    expect(w.saved).toEqual([
      {
        oldFqdn: OLD_FQDN,
        prodFqdn: cfg.prodSslipUrl,
        at: "2026-10-17T14:05:09.000Z",
      },
    ]);
    expect(writes(w.fake)).toEqual([
      {
        method: "setDomains",
        uuid: OLD,
        arg: `http://${OLD}.82.180.132.176.sslip.io`,
      },
      { method: "deploy", uuid: OLD, arg: false },
      {
        method: "setDomains",
        uuid: PROD,
        arg: `https://${cfg.apex},https://${cfg.www}`,
      },
      { method: "deploy", uuid: PROD, arg: false },
      { method: "stop", uuid: OLD },
    ]);
    expect(w.fake.app(PROD).fqdn).toBe(
      "https://connectionsdesignstudios.com,https://www.connectionsdesignstudios.com",
    );
    expect(w.fake.app(OLD).status).toBe("exited");
    // WR-B01: the old app was redeployed off the names, so no host had two routers.
    expect(w.conflicts).toEqual([]);
    expect(fqdnHosts(w.fake.labels(OLD))).not.toContain(cfg.apex);
    // verify covered both names, the marker page, /start, /report and health.
    for (const url of [
      `https://${cfg.apex}/`,
      `https://${cfg.www}/`,
      `https://${cfg.apex}/start`,
      `https://${cfg.apex}/report?site=example.com`,
      `https://${cfg.apex}/api/health`,
    ]) {
      expect(w.probed).toContain(url);
    }
    expect(w.logs.length).toBeGreaterThanOrEqual(7);
    for (const line of w.logs) {
      expect(line).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC · [a-z-]+ · (ok|failed)$/,
      );
    }
    expect(w.logs[0]).toBe("2026-10-17 14:05 UTC · preflight · ok");
    expect(w.logs.at(-1)).toBe("2026-10-17 14:05 UTC · stop-old · ok");
  });

  it("the 409 rule: assigning before freeing conflicts; our order never does", async () => {
    const w = world();
    await expect(
      w.fake.setDomains(PROD, `https://${cfg.apex},https://${cfg.www}`),
    ).rejects.toMatchObject({ status: 409 });

    const ok = world();
    await applyCutover(ok.deps, { confirm: cfg.apex, expectSha: SHA });
    expect(ok.fake.app(PROD).fqdn).toContain(cfg.apex);
  });

  it("a deploy failure rolls back: old app holds its saved fqdn again", async () => {
    const w = world();
    w.fake.fail({ method: "deploy", uuid: PROD, once: true });
    const result = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    if (result.ok) throw new Error("unreachable");
    expect(result.failedStep).toBe("deploy-prod");
    expect(result.rollback?.ok).toBe(true);
    expect(w.fake.app(OLD).fqdn).toBe(OLD_FQDN);
    expect(w.fake.app(PROD).fqdn).toBe(cfg.prodSslipUrl);
    // redeploy-old during apply, then rollback-deploy-old.
    expect(w.fake.deploys(OLD)).toBe(2);
    expect(w.fake.calls.some((c) => c.method === "stop")).toBe(false);
    expect(w.logs).toContain("2026-10-17 14:05 UTC · deploy-prod · failed");
  });

  it("a verify failure rolls back after polling", async () => {
    const w = world({ hub: "ok" });
    // Healthy on the sslip address at preflight; broken once on the real names.
    const healthy = w.deps.probe;
    w.deps.probe = async (url) =>
      new URL(url).hostname === SSLIP_HOST
        ? healthy(url)
        : w.fake.app(PROD).fqdn.includes(cfg.apex)
          ? { status: 502, body: "bad gateway", headers: {} }
          : healthy(url);
    const result = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failedStep).toBe("verify");
    expect(result.rolledBack).toBe(true);
    expect(result.rollback?.ok).toBe(true);
    expect(w.sleeps.length).toBeGreaterThanOrEqual(2);
    expect(w.fake.app(OLD).fqdn).toBe(OLD_FQDN);
    expect(w.fake.app(OLD).status.startsWith("running")).toBe(true);
    expect(w.fake.app(PROD).fqdn).toBe(cfg.prodSslipUrl);
    expect(w.fake.calls.some((c) => c.method === "stop")).toBe(false);
  });
});

describe("applyCutover verify (WR-B01)", () => {
  it("never deploys prod while the old app's labels still claim the names", async () => {
    const w = world();
    const deployPhase: string[][] = [];
    const deploy = w.fake.deploy.bind(w.fake);
    w.fake.deploy = async (uuid, force) => {
      if (uuid === PROD) deployPhase.push(w.fake.routes(cfg.apex));
      return deploy(uuid, force);
    };
    const result = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    expect(result.ok).toBe(true);
    expect(deployPhase).toEqual([[]]);
  });

  it("www serving anything but the hub fails verify and rolls back", async () => {
    const w = world();
    const real = w.deps.probe;
    w.deps.probe = async (url) =>
      new URL(url).hostname === cfg.www
        ? { status: 200, body: "<html>archive site</html>", headers: {} }
        : real(url);
    const result = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failedStep).toBe("verify");
    expect(result.rolledBack).toBe(true);
  });
});

describe("applyCutover waits for deployments (WR-B02)", () => {
  it("verify starts only after prod's deployment reports finished", async () => {
    const w = world();
    w.fake.queueDeploy(PROD, { polls: 2 });
    const apexProbedEarly: boolean[] = [];
    const real = w.deps.probe;
    w.deps.probe = async (url) => {
      if (new URL(url).hostname === cfg.apex) {
        apexProbedEarly.push(w.fake.inFlight(PROD) > 0);
      }
      return real(url);
    };
    const result = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    expect(result.ok).toBe(true);
    expect(apexProbedEarly.length).toBeGreaterThan(0);
    expect(apexProbedEarly.every((early) => !early)).toBe(true);
    expect(
      w.fake.calls.filter(
        (c) => c.method === "deploymentStatus" && c.uuid === PROD,
      ).length,
    ).toBe(2);
    expect(w.sleeps).toContain(500);
  });

  it("a deployment still running after the window rolls back, and rollback waits for it first", async () => {
    const w = world();
    // 3 status reads during apply (still running), finishes on the 5th: during rollback.
    w.fake.queueDeploy(PROD, { polls: 5 });
    const result = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failedStep).toBe("deploy-prod");
    expect(result.rollback).toEqual({ ok: true, failed: [] });
    expect(w.fake.inFlight(PROD)).toBe(0);
    // The late apply deployment finished before the rollback redeploy, so prod ends on sslip.
    expect(fqdnHosts(w.fake.labels(PROD))).toEqual([SSLIP_HOST]);
    expect(w.fake.routes(cfg.apex)).toEqual([OLD]);
    const steps = w.logs.map((l) => l.split(" · ")[1]);
    expect(steps).toContain("rollback-wait-deploys");
    expect(steps.indexOf("rollback-wait-deploys")).toBeLessThan(
      steps.indexOf("rollback-redeploy-prod"),
    );
  });

  it("a failed deployment fails the step and rolls back", async () => {
    const w = world();
    w.fake.queueDeploy(PROD, { outcome: "failed" });
    const result = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failedStep).toBe("deploy-prod");
    expect(result.rollback?.ok).toBe(true);
    expect(w.fake.routes(cfg.apex)).toEqual([OLD]);
  });

  it("a rollback redeploy that never finishes is named as failed", async () => {
    const w = world();
    const applied = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    expect(applied.ok).toBe(true);
    w.fake.queueDeploy(OLD, { polls: 99 });
    const r = await rollbackCutover(w.deps, applied.saved);
    expect(r.ok).toBe(false);
    expect(r.failed).toContain("rollback-deploy-old");
  });
});

describe("a throwing log sink (WR-B03)", () => {
  const throwingLog = () => {
    throw Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" });
  };

  it("never fails a step: the cutover completes", async () => {
    const w = world();
    w.deps.log = throwingLog;
    const result = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    expect(result.ok).toBe(true);
    expect(result.steps).toContain("stop-old");
  });

  it("never skips the rollback after a failed step", async () => {
    const w = world();
    w.deps.log = throwingLog;
    w.fake.fail({ method: "deploy", uuid: PROD, once: true });
    const result = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.rolledBack).toBe(true);
    expect(result.rollback).toEqual({ ok: true, failed: [] });
    expect(w.fake.app(OLD).fqdn).toBe(OLD_FQDN);
    expect(w.fake.routes(cfg.apex)).toEqual([OLD]);
  });

  it("rolls back before it logs the failed step", async () => {
    const w = world();
    w.fake.fail({ method: "deploy", uuid: PROD, once: true });
    await applyCutover(w.deps, { confirm: cfg.apex, expectSha: SHA });
    const steps = w.logs.map((l) => l.split(" · ")[1]);
    expect(steps.indexOf("rollback-prod-domains")).toBeLessThan(
      steps.indexOf("deploy-prod"),
    );
  });

  it("runs every rollback step even when each log write throws", async () => {
    const w = world();
    const applied = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    w.deps.log = throwingLog;
    const r = await rollbackCutover(w.deps, applied.saved);
    expect(r).toEqual({ ok: true, failed: [] });
    expect(w.fake.routes(cfg.apex)).toEqual([OLD]);
  });
});

describe("rollbackCutover", () => {
  it("restores both apps and verifies the old apex", async () => {
    const w = world();
    await w.fake.setDomains(OLD, `http://${OLD}.82.180.132.176.sslip.io`);
    await w.fake.setDomains(PROD, `https://${cfg.apex},https://${cfg.www}`);
    const r = await rollbackCutover(w.deps, {
      oldFqdn: OLD_FQDN,
      prodFqdn: cfg.prodSslipUrl,
      at: "2026-10-17T14:05:09.000Z",
    });
    expect(r).toEqual({ ok: true, failed: [] });
    expect(w.fake.app(OLD).fqdn).toBe(OLD_FQDN);
    expect(w.fake.app(PROD).fqdn).toBe(cfg.prodSslipUrl);
    expect(w.probed).toContain(`https://${cfg.apex}/`);
  });

  it("CR-B01: after a full cutover, rollback redeploys prod so its labels drop the apex", async () => {
    const w = world();
    const applied = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    expect(applied.ok).toBe(true);
    expect(w.fake.labels(PROD)).toContain(cfg.apex);
    const prodDeploys = w.fake.deploys(PROD);

    const r = await rollbackCutover(w.deps, applied.saved);
    expect(r).toEqual({ ok: true, failed: [] });
    expect(w.fake.deploys(PROD)).toBe(prodDeploys + 1);
    expect(fqdnHosts(w.fake.labels(PROD))).not.toContain(cfg.apex);
    expect(w.fake.routes(cfg.apex)).toEqual([OLD]);
    expect(w.fake.routes(cfg.www)).toEqual([OLD]);
    const probe = await w.deps.probe(`https://${cfg.apex}/`);
    expect(probe.body).not.toContain(cfg.hubMarker);
    const steps = w.logs.map((l) => l.split(" · ")[1]);
    expect(steps.indexOf("rollback-redeploy-prod")).toBeLessThan(
      steps.indexOf("rollback-deploy-old"),
    );
  });

  it("CR-B01: rollback verify fails while prod still answers the apex with the hub", async () => {
    const w = world();
    const applied = await applyCutover(w.deps, {
      confirm: cfg.apex,
      expectSha: SHA,
    });
    expect(applied.ok).toBe(true);
    // The prod redeploy fails: its running container keeps the apex labels.
    w.fake.fail({ method: "deploy", uuid: PROD });
    const r = await rollbackCutover(w.deps, applied.saved);
    expect(r.ok).toBe(false);
    expect(r.failed).toEqual(["rollback-redeploy-prod", "rollback-verify-old"]);
    expect(w.conflicts).toContain(cfg.apex);
  });

  it("refuses a saved fqdn naming the api. or pb. records", async () => {
    const w = world();
    await expect(
      rollbackCutover(w.deps, {
        oldFqdn: "https://api.connectionsdesignstudios.com",
        prodFqdn: cfg.prodSslipUrl,
        at: "x",
      }),
    ).rejects.toThrow(/api\.connectionsdesignstudios\.com/);
    expect(writes(w.fake)).toEqual([]);
  });
});

describe("config guard and hard limits", () => {
  it("accepts the defaults", () => {
    expect(() => assertCutoverConfig(cfg)).not.toThrow();
  });

  it.each([
    ["apex", "pb.connectionsdesignstudios.com"],
    ["www", "api.connectionsdesignstudios.com"],
    ["www", "x.api.connectionsdesignstudios.com"],
    ["prodSslipUrl", "https://pb.connectionsdesignstudios.com"],
  ] as const)("refuses %s = %s", (field, value) => {
    expect(() => assertCutoverConfig({ ...cfg, [field]: value })).toThrow();
  });

  it.each([
    "/root/pocketbase-cds/pb_data/data.db",
    "/root/pocketbase-cdsp/pb_data/data.db",
    "/tmp/data.db",
  ])("refuses prodPbDataPath %s", (p) => {
    expect(() => assertCutoverConfig({ ...cfg, prodPbDataPath: p })).toThrow();
  });

  it("applyCutover runs the guard before anything else", async () => {
    const w = world();
    w.deps.cfg = { ...cfg, www: "api.connectionsdesignstudios.com" };
    await expect(
      applyCutover(w.deps, { confirm: cfg.apex, expectSha: SHA }),
    ).rejects.toThrow();
    expect(w.fake.calls).toEqual([]);
  });

  it("the Coolify port has no delete and the planner never overrides a conflict", () => {
    expect([...COOLIFY_API_METHODS]).toEqual([
      "getApp",
      "listEnvKeys",
      "setDomains",
      "deploy",
      "deploymentStatus",
      "stop",
      "start",
    ]);
    const src = readFileSync(
      fileURLToPath(new URL("./hub-cutover.ts", import.meta.url)),
      "utf8",
    );
    expect(src).not.toMatch(/force_domain_override/);
    expect(src).not.toMatch(/\.delete\w*\(/);
    expect(src).toContain("/root/pocketbase-cdsp-prod/");
  });
});
