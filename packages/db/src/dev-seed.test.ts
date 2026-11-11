// WR-A05: the dev seed fails closed. bootstrapDevTenant runs only when CDS_ENV is exactly
// "dev", and it is not reachable from the @cds/db root that apps/web imports.
// 11-42: setDevTenantStage (tenants:seed-dev -- --stage) over a fake superuser client and a
// spied setOrgStage: forward moves go through setOrgStage with a system context.
import { InvalidInput } from "@cds/core";
import { NEUTRAL_DESIGN } from "@cds/core/theme";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  org: null as Record<string, unknown> | null,
  reads: 0,
  batch: [] as { collection: string; op: string; id?: string; body: unknown }[],
  stageCalls: [] as { ctx: unknown; orgId: string; to: string }[],
  stageAlerts: [] as { id: string }[],
}));

vi.mock("./client", async (orig) => {
  const real = await orig<typeof import("./client")>();
  const { ClientResponseError } = await import("pocketbase");
  const pb = {
    filter: (expr: string, params: Record<string, unknown>) =>
      `${expr} ${JSON.stringify(params)}`,
    collection: (name: string) => ({
      getFirstListItem: async () => {
        fake.reads++;
        if (name !== "organizations" || !fake.org) {
          throw new ClientResponseError({ status: 404 });
        }
        return fake.org;
      },
      getFullList: async () => (name === "alerts" ? fake.stageAlerts : []),
    }),
    createBatch: () => {
      const ops: typeof fake.batch = [];
      return {
        collection: (c: string) => ({
          update: (id: string, body: unknown) =>
            ops.push({ collection: c, op: "update", id, body }),
          create: (body: unknown) =>
            ops.push({ collection: c, op: "create", body }),
          delete: (id: string) =>
            ops.push({ collection: c, op: "delete", id, body: null }),
        }),
        send: async () => {
          fake.batch.push(...ops);
        },
      };
    },
  };
  return {
    ...real,
    withSuperuser: async (fn: (p: typeof pb) => unknown) => fn(pb),
  };
});

vi.mock("./org-stage", async (orig) => {
  const real = await orig<typeof import("./org-stage")>();
  return {
    ...real,
    setOrgStage: async (ctx: unknown, orgId: string, to: string) => {
      fake.stageCalls.push({ ctx, orgId, to });
      return {
        changed: true,
        launchedAt: to === "live" ? "2026-10-12 08:00:00.000Z" : null,
      };
    },
  };
});

const {
  assertDevEnvironment,
  bootstrapDevTenant,
  REFUSE_NOT_DEV,
  REFUSE_PRODUCTION,
  setDevTenantStage,
} = await import("./dev-seed");
const { assertSystemContext } = await import("./context");
const root = await import("./index");

const saved = process.env.CDS_ENV;

afterEach(() => {
  if (saved === undefined) delete process.env.CDS_ENV;
  else process.env.CDS_ENV = saved;
});

const input = {
  slug: "demo",
  name: "Demo",
  host: "demo.example.com",
  ownerEmail: "owner@demo.test",
  ownerPassword: "a-long-enough-password",
};

describe("dev seed guard (WR-A05)", () => {
  it.each([
    [undefined, REFUSE_NOT_DEV],
    ["", REFUSE_NOT_DEV],
    ["prod", REFUSE_NOT_DEV],
    ["Dev", REFUSE_NOT_DEV],
    ["production", REFUSE_PRODUCTION],
  ])("CDS_ENV=%s refuses before any database call", async (env, message) => {
    if (env === undefined) delete process.env.CDS_ENV;
    else process.env.CDS_ENV = env;
    expect(() => assertDevEnvironment()).toThrow(message);
    await expect(bootstrapDevTenant(input)).rejects.toThrow(message);
  });

  it('CDS_ENV="dev" passes the guard', () => {
    process.env.CDS_ENV = "dev";
    expect(() => assertDevEnvironment()).not.toThrow();
  });

  it("rejects an invalid design with InvalidInput before any database call", async () => {
    process.env.CDS_ENV = "dev";
    const bad = { ...structuredClone(NEUTRAL_DESIGN), schemaVersion: 1 };
    await expect(bootstrapDevTenant({ ...input, design: bad })).rejects.toThrow(
      InvalidInput,
    );
    await expect(
      bootstrapDevTenant({ ...input, design: "not a design" }),
    ).rejects.toThrow(InvalidInput);
  });

  it("rejects an unknown hostKind before any database call (07-33)", async () => {
    process.env.CDS_ENV = "dev";
    await expect(
      bootstrapDevTenant({ ...input, hostKind: "apex" as never }),
    ).rejects.toThrow("host kind must be preview or custom");
  });

  it("is not exported from the @cds/db root", () => {
    const names = Object.keys(root);
    expect(names).not.toContain("bootstrapDevTenant");
    expect(names).not.toContain("assertDevEnvironment");
  });
});

describe("setDevTenantStage (11-42, tenants:seed-dev -- --stage)", () => {
  beforeEach(() => {
    process.env.CDS_ENV = "dev";
    fake.org = { id: "orgdemo00000001", slug: "demo", stage: "being_built" };
    fake.reads = 0;
    fake.batch = [];
    fake.stageCalls = [];
  });

  it("--stage live moves demo forward through setOrgStage with a system context", async () => {
    const r = await setDevTenantStage("live");
    expect(fake.stageCalls).toHaveLength(1);
    expect(fake.stageCalls[0]).toMatchObject({
      orgId: "orgdemo00000001",
      to: "live",
    });
    expect(() => assertSystemContext(fake.stageCalls[0]!.ctx)).not.toThrow();
    expect(r).toEqual({
      orgId: "orgdemo00000001",
      from: "being_built",
      to: "live",
      moved: "forward",
      launchedAt: "2026-10-12 08:00:00.000Z",
    });
    expect(fake.batch).toEqual([]);
  });

  it("--stage bogus fails before any database call", async () => {
    await expect(setDevTenantStage("bogus")).rejects.toThrow(InvalidInput);
    await expect(setDevTenantStage("bogus")).rejects.toThrow(
      "stage must be one of intake, fit_review",
    );
    expect(fake.reads).toBe(0);
  });

  it("refuses outside CDS_ENV=dev (T-11-42-03)", async () => {
    process.env.CDS_ENV = "production";
    await expect(setDevTenantStage("live")).rejects.toThrow(REFUSE_PRODUCTION);
    expect(fake.reads).toBe(0);
  });

  it("a backward move is the dev-only reset: stage, launched_at cleared, audited", async () => {
    fake.org = {
      id: "orgdemo00000001",
      slug: "demo",
      stage: "live",
      launched_at: "2026-10-01 10:00:00.000Z",
    };
    const r = await setDevTenantStage("being_built");
    expect(fake.stageCalls).toEqual([]);
    expect(r.moved).toBe("back");
    expect(r.launchedAt).toBeNull();
    expect(fake.batch[0]).toEqual({
      collection: "organizations",
      op: "update",
      id: "orgdemo00000001",
      body: { stage: "being_built", launched_at: "" },
    });
    expect(fake.batch[1]).toMatchObject({
      collection: "audit_log",
      op: "create",
      body: {
        action: "org.stage_dev_reset",
        meta: { from: "live", to: "being_built" },
      },
    });
  });

  it("a backward reset clears the site.stage alerts, so walking forward alerts again (IN-A05)", async () => {
    fake.org = {
      id: "orgdemo00000001",
      slug: "demo",
      stage: "ready_for_review",
      launched_at: "",
    };
    fake.stageAlerts = [{ id: "alrt00000000001" }, { id: "alrt00000000002" }];
    await setDevTenantStage("intake");
    expect(
      fake.batch.filter((o) => o.op === "delete").map((o) => o.id),
    ).toEqual(["alrt00000000001", "alrt00000000002"]);
    expect(fake.batch.map((o) => o.collection)).toEqual([
      "organizations",
      "alerts",
      "alerts",
      "audit_log",
    ]);
    fake.stageAlerts = [];
  });

  it("the same stage writes nothing; a missing demo tenant says to seed first", async () => {
    const r = await setDevTenantStage("being_built");
    expect(r.moved).toBe("same");
    expect(fake.stageCalls).toEqual([]);
    expect(fake.batch).toEqual([]);
    fake.org = null;
    await expect(setDevTenantStage("live")).rejects.toThrow(
      'no "demo" dev tenant: run npm run tenants:seed-dev first',
    );
  });

  it("is not exported from the @cds/db root", () => {
    expect(Object.keys(root)).not.toContain("setDevTenantStage");
  });
});
