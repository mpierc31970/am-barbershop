import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assembleMigrationsDir } from "../scripts/migrations-dir.mjs";
import { getOrgStage } from "../src/org-stage";
import { bootSeededPb, type SeededPb } from "./seeded";

// P8 schema proofs on the real binary (08-02): organizations.stage gains being_built (D312,
// TMPL-04, CONTEXT A2-Q5) and org_intake.assembly holds the assembly ledger (TMPL-02,
// CONTEXT A2-Q3). The stage down migration moves being_built rows back to ready_for_build
// before shrinking the select (T-08-02-03).
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FETCH_SCRIPT = join(PKG_DIR, "scripts", "fetch-pocketbase.mjs");
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const FAILURE = /error|failed|panic/i;
const P8_STAGES = ["intake", "fit_review", "ready_for_build", "being_built"];
const P6_STAGES = ["intake", "fit_review", "ready_for_build"];
// P11 (11-03, migration 1790000820) widens the select with ready_for_review and live.
const CURRENT_STAGES = [...P8_STAGES, "ready_for_review", "live"];

type Json = Record<string, unknown>;

async function api(
  url: string,
  path: string,
  init: { method?: string; body?: unknown; auth?: string } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init.auth) headers.Authorization = init.auth;
  const res = await fetch(`${url}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Json) : {} };
}

async function token(url: string, email: string, password: string) {
  const res = await api(
    url,
    "/api/collections/_superusers/auth-with-password",
    {
      method: "POST",
      body: { identity: email, password },
    },
  );
  expect(res.status).toBe(200);
  return String(res.body.token);
}

const idOf = (res: { status: number; body: Json }) => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return String(res.body.id);
};

describe("P8 schema (throwaway PocketBase)", () => {
  let booted: SeededPb | null = null;
  let inst: SeededPb["inst"] | null = null;
  let su = "";

  beforeAll(async () => {
    booted = await bootSeededPb();
    if (!booted) return;
    inst = booted.inst;
    su = await token(inst.url, inst.email, inst.password);
  });

  afterAll(async () => {
    await inst?.stop();
  });

  const fieldsOf = async (name: string): Promise<Json[]> => {
    const res = await api(inst!.url, `/api/collections/${name}`, { auth: su });
    expect(res.status).toBe(200);
    return res.body.fields as Json[];
  };

  it("organizations.stage keeps the P8 values (plus P11 ones) and accepts being_built", async (ctx) => {
    if (!inst) return ctx.skip();
    const stage = (await fieldsOf("organizations")).find(
      (f) => f.name === "stage",
    );
    expect(stage?.values).toEqual(CURRENT_STAGES);
    const org = idOf(
      await api(inst.url, "/api/collections/organizations/records", {
        method: "POST",
        auth: su,
        body: { name: "P8 A", slug: "p8-a", status: "active" },
      }),
    );
    const upd = await api(
      inst.url,
      `/api/collections/organizations/records/${org}`,
      { method: "PATCH", auth: su, body: { stage: "being_built" } },
    );
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.stage).toBe("being_built");
  });

  it("getOrgStage returns being_built for an org at that stage", async (ctx) => {
    if (!inst || !booted) return ctx.skip();
    const { ctxA } = booted.seed;
    const upd = await api(
      inst.url,
      `/api/collections/organizations/records/${ctxA.orgId}`,
      { method: "PATCH", auth: su, body: { stage: "being_built" } },
    );
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect((await getOrgStage(ctxA)).stage).toBe("being_built");
  });

  it("org_intake.assembly is a json field that round-trips the ledger", async (ctx) => {
    if (!inst) return ctx.skip();
    const field = (await fieldsOf("org_intake")).find(
      (f) => f.name === "assembly",
    );
    expect(field?.type).toBe("json");
    expect(field?.maxSize).toBe(200000);
    const col = await api(inst.url, "/api/collections/org_intake", {
      auth: su,
    });
    for (const rule of [
      "listRule",
      "viewRule",
      "createRule",
      "updateRule",
      "deleteRule",
    ]) {
      expect(col.body[rule], `org_intake.${rule}`).toBeNull();
    }
    const org = idOf(
      await api(inst.url, "/api/collections/organizations/records", {
        method: "POST",
        auth: su,
        body: { name: "P8 C", slug: "p8-c", status: "active" },
      }),
    );
    const ledger = { status: "done", attempts: 1, pages: {} };
    const row = idOf(
      await api(inst.url, "/api/collections/org_intake/records", {
        method: "POST",
        auth: su,
        body: { organization: org, assembly: ledger },
      }),
    );
    const read = await api(
      inst.url,
      `/api/collections/org_intake/records/${row}`,
      { auth: su },
    );
    expect(read.status).toBe(200);
    expect(read.body.assembly).toEqual(ledger);
  });
});

// The down path needs a stopped server between steps, so it runs its own data dir.
describe("P8 stage down migration (being_built -> ready_for_build)", () => {
  let bin = "";
  let dir = "";
  let migrationsDir = "";
  const email = "p8-down@cds.test";
  const password = randomBytes(16).toString("hex");

  const cli = (args: string[], input?: string) => {
    const r = spawnSync(bin, args, {
      encoding: "utf8",
      input,
      timeout: 60_000,
    });
    if (r.error) throw r.error;
    return `${r.stdout ?? ""}\n${r.stderr ?? ""}`.replace(ANSI, "");
  };
  const migrate = (args: string[], input?: string) =>
    cli(
      [
        "migrate",
        ...args,
        `--dir=${dir}`,
        `--migrationsDir=${migrationsDir}`,
        "--automigrate=false",
      ],
      input,
    );

  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const a = s.address();
        const port = typeof a === "object" && a ? a.port : 0;
        s.close(() => resolve(port));
      });
    });

  // `serve` applies pending migrations on boot, so the read after the down boots from a
  // folder that holds only the pre-P8 files.
  async function serve(
    migrations = migrationsDir,
  ): Promise<{ url: string; stop: () => Promise<void> }> {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const child: ChildProcess = spawn(bin, [
      "serve",
      `--http=127.0.0.1:${port}`,
      `--dir=${dir}`,
      `--migrationsDir=${migrations}`,
      "--automigrate=false",
    ]);
    const deadline = Date.now() + 20_000;
    for (;;) {
      if (Date.now() > deadline) throw new Error("PocketBase did not boot");
      try {
        if ((await fetch(`${url}/api/health`)).ok) break;
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const stop = async () => {
      if (child.exitCode !== null) return;
      const exited = new Promise<void>((r) => child.once("exit", () => r()));
      child.kill();
      const late = await Promise.race([
        exited.then(() => false),
        new Promise<boolean>((r) => setTimeout(() => r(true), 5_000)),
      ]);
      if (late && child.pid !== undefined && process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      }
    };
    return { url, stop };
  }

  beforeAll(() => {
    const fetched = spawnSync(
      process.execPath,
      [FETCH_SCRIPT, "--print-path"],
      {
        encoding: "utf8",
      },
    );
    if (fetched.status !== 0 || !fetched.stdout.trim()) {
      if (process.env.CI) throw new Error("PocketBase binary not available");
      return;
    }
    bin = fetched.stdout.trim();
    dir = mkdtempSync(join(tmpdir(), "cds-pb-p8-down-"));
    migrationsDir = join(dir, "migrations");
    assembleMigrationsDir(migrationsDir);
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("moves a being_built org back to ready_for_build and restores the P6 list", async (ctx) => {
    if (!bin) return ctx.skip();
    const up = migrate(["up"]);
    expect(up).not.toMatch(FAILURE);
    expect(up).toContain("Applied 1790000650_update_organizations_stage_p8.js");
    expect(up).toContain("Applied 1790000660_update_org_intake_assembly.js");
    expect(
      cli(["superuser", "upsert", email, password, `--dir=${dir}`]),
    ).toContain("Successfully saved superuser");

    let pb = await serve();
    let org = "";
    try {
      const su = await token(pb.url, email, password);
      org = idOf(
        await api(pb.url, "/api/collections/organizations/records", {
          method: "POST",
          auth: su,
          body: {
            name: "P8 Down",
            slug: "p8-down",
            status: "active",
            stage: "being_built",
          },
        }),
      );
    } finally {
      await pb.stop();
    }

    // Revert every migration after 1790000640 (the P8 ones, plus any later), down to P7.
    const all = assembleMigrationsDir(join(dir, "count"));
    const after = all.filter(
      (f) => basename(f).split("_")[0]! >= "1790000650",
    ).length;
    const down = migrate(["down", String(after)], "y\n");
    expect(down).not.toMatch(FAILURE);
    expect(down).toContain(
      "Reverted 1790000650_update_organizations_stage_p8.js",
    );

    const preP8 = join(dir, "pre-p8");
    mkdirSync(preP8);
    for (const f of all) {
      if (basename(f).split("_")[0]! < "1790000650") {
        copyFileSync(f, join(preP8, basename(f)));
      }
    }
    pb = await serve(preP8);
    try {
      const su = await token(pb.url, email, password);
      const read = await api(
        pb.url,
        `/api/collections/organizations/records/${org}`,
        { auth: su },
      );
      expect(read.status).toBe(200);
      expect(read.body.stage).toBe("ready_for_build");
      const col = await api(pb.url, "/api/collections/organizations", {
        auth: su,
      });
      const stage = (col.body.fields as Json[]).find((f) => f.name === "stage");
      expect(stage?.values).toEqual(P6_STAGES);
    } finally {
      await pb.stop();
    }
  });
});
