// packages/db/src/ops/fake-coolify.ts (P15, HUB-04). Owner: 15-24.
//
// In-memory CoolifyApi for the cutover tests: apps and env rows in memory, every call
// recorded, and Coolify's domain-conflict rule enforced (PATCH answers 409 when another app
// already holds one of the hosts). The real API only skips that check when asked to
// override it; this fake has no such option, so a 409 here always means a skipped step.
//
// Proxy labels (RESEARCH Pitfall 7 / A1): a domain change only reaches the proxy when the
// app is deployed. The fake keeps the fqdn each app had at its last deploy (`labels`), and
// `routes(host)` answers from those labels, never from the current fqdn: an app routes a host
// until it is redeployed without it or stopped.
//
// Deployments are asynchronous like Coolify's: `deploy` returns an id at once. By default a
// deployment finishes immediately; `queueDeploy` makes the next one stay `in_progress` for N
// `deploymentStatus` reads and/or end `failed`. Labels change only when one finishes.
import type { CoolifyApi, CoolifyApp, CoolifyEnvVar } from "./hub-cutover";

export type FakeCoolifyCall = {
  method: keyof CoolifyApi;
  uuid: string;
  arg?: string | boolean;
};

/** Make one method fail (for one app, or every app when `uuid` is left out). */
export type FakeCoolifyFailure = {
  method: keyof CoolifyApi;
  uuid?: string;
  error?: Error;
  /** Fail the next matching call only. */
  once?: boolean;
};

export type FakeCoolifySeed = {
  apps: CoolifyApp[];
  envs?: Record<string, CoolifyEnvVar[]>;
  failures?: FakeCoolifyFailure[];
};

export class CoolifyHttpError extends Error {
  override name = "CoolifyHttpError";
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type FakeCoolify = CoolifyApi & {
  readonly calls: FakeCoolifyCall[];
  app(uuid: string): CoolifyApp;
  deploys(uuid: string): number;
  /** The fqdn the proxy routes for this app: its fqdn at the last deploy. */
  labels(uuid: string): string;
  /** The running apps whose proxy labels claim `host` (more than one = a routing conflict). */
  routes(host: string): string[];
  /** Deployments of this app not yet finished or failed. */
  inFlight(uuid: string): number;
  /** Shape the next deployment of `uuid`. */
  queueDeploy(uuid: string, behaviour: FakeDeployBehaviour): void;
  fail(failure: FakeCoolifyFailure): void;
};

export type FakeDeployBehaviour = {
  /** `deploymentStatus` reads that answer `in_progress` before it ends. Default 0. */
  polls?: number;
  /** How it ends. Default `finished`. */
  outcome?: "finished" | "failed";
};

type FakeDeployment = {
  uuid: string;
  fqdn: string;
  pollsLeft: number;
  outcome: "finished" | "failed";
  done: boolean;
};

/** Hostnames in a Coolify fqdn string (comma-separated URLs). */
export function fqdnHosts(fqdn: string): string[] {
  return fqdn
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

export function fakeCoolify(seed: FakeCoolifySeed): FakeCoolify {
  const apps = new Map<string, CoolifyApp>(
    seed.apps.map((a) => [a.uuid, { ...a }]),
  );
  const envs = new Map<string, CoolifyEnvVar[]>(
    Object.entries(seed.envs ?? {}).map(([k, v]) => [
      k,
      v.map((e) => ({ ...e })),
    ]),
  );
  const failures: FakeCoolifyFailure[] = [...(seed.failures ?? [])];
  const deployCount = new Map<string, number>();
  const deployed = new Map<string, string>(
    seed.apps.map((a) => [a.uuid, a.fqdn]),
  );
  const calls: FakeCoolifyCall[] = [];
  const deployments = new Map<string, FakeDeployment>();
  const queued = new Map<string, FakeDeployBehaviour[]>();

  function finish(d: FakeDeployment): void {
    d.done = true;
    if (d.outcome !== "finished") return;
    deployed.set(d.uuid, d.fqdn);
    must(d.uuid).status = "running";
  }

  function must(uuid: string): CoolifyApp {
    const app = apps.get(uuid);
    if (!app) throw new CoolifyHttpError(404, `no application ${uuid}`);
    return app;
  }

  function maybeFail(method: keyof CoolifyApi, uuid: string): void {
    const i = failures.findIndex(
      (f) => f.method === method && (f.uuid === undefined || f.uuid === uuid),
    );
    if (i < 0) return;
    const hit = failures[i]!;
    if (hit.once) failures.splice(i, 1);
    throw hit.error ?? new CoolifyHttpError(500, `${method} failed`);
  }

  return {
    calls,
    app: (uuid) => ({ ...must(uuid) }),
    deploys: (uuid) => deployCount.get(uuid) ?? 0,
    labels: (uuid) => deployed.get(must(uuid).uuid) ?? "",
    routes: (host) =>
      [...apps.values()]
        .filter(
          (a) =>
            a.status.startsWith("running") &&
            fqdnHosts(deployed.get(a.uuid) ?? "").includes(host.toLowerCase()),
        )
        .map((a) => a.uuid),
    inFlight: (uuid) =>
      [...deployments.values()].filter((d) => d.uuid === uuid && !d.done)
        .length,
    queueDeploy: (uuid, behaviour) => {
      queued.set(uuid, [...(queued.get(uuid) ?? []), behaviour]);
    },
    fail: (failure) => {
      failures.push(failure);
    },

    async getApp(uuid) {
      calls.push({ method: "getApp", uuid });
      maybeFail("getApp", uuid);
      return { ...must(uuid) };
    },

    async listEnvKeys(uuid) {
      calls.push({ method: "listEnvKeys", uuid });
      maybeFail("listEnvKeys", uuid);
      must(uuid);
      return (envs.get(uuid) ?? []).map((e) => ({ ...e }));
    },

    async setDomains(uuid, domains) {
      calls.push({ method: "setDomains", uuid, arg: domains });
      maybeFail("setDomains", uuid);
      const app = must(uuid);
      const wanted = fqdnHosts(domains);
      for (const other of apps.values()) {
        if (other.uuid === uuid) continue;
        const clash = fqdnHosts(other.fqdn).filter((h) => wanted.includes(h));
        if (clash.length > 0) {
          throw new CoolifyHttpError(
            409,
            `domain conflict: ${clash.join(", ")} is used by another application`,
          );
        }
      }
      app.fqdn = domains;
    },

    async deploy(uuid, force) {
      calls.push({ method: "deploy", uuid, arg: force });
      maybeFail("deploy", uuid);
      const app = must(uuid);
      const n = (deployCount.get(uuid) ?? 0) + 1;
      deployCount.set(uuid, n);
      const id = `deployment-${uuid.slice(0, 4)}-${n}`;
      const behaviour = queued.get(uuid)?.shift() ?? {};
      const d: FakeDeployment = {
        uuid,
        fqdn: app.fqdn,
        pollsLeft: behaviour.polls ?? 0,
        outcome: behaviour.outcome ?? "finished",
        done: false,
      };
      deployments.set(id, d);
      if (d.pollsLeft === 0) finish(d);
      return id;
    },

    async deploymentStatus(deploymentId) {
      const d = deployments.get(deploymentId);
      calls.push({ method: "deploymentStatus", uuid: d?.uuid ?? "" });
      if (!d) throw new CoolifyHttpError(404, `no deployment ${deploymentId}`);
      maybeFail("deploymentStatus", d.uuid);
      if (!d.done) {
        d.pollsLeft -= 1;
        if (d.pollsLeft <= 0) finish(d);
      }
      return d.done ? d.outcome : "in_progress";
    },

    async stop(uuid) {
      calls.push({ method: "stop", uuid });
      maybeFail("stop", uuid);
      must(uuid).status = "exited";
    },

    async start(uuid) {
      calls.push({ method: "start", uuid });
      maybeFail("start", uuid);
      must(uuid).status = "running";
    },
  };
}
