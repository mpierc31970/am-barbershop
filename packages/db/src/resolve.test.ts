// 14-14 (DOM-06, P14-P5, choice 1): host kinds, redirectTo, live, forgetHost. PocketBase is
// mocked: withSuperuser hands the callback a fake client whose org_hosts rows live in `rows`.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  hostname: string;
  kind: string;
  primary: boolean;
  redirect_to?: string;
  organization: string;
};

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  orgs: new Map<string, Record<string, unknown>>(),
  lookups: 0,
}));

vi.mock("./client", async () => {
  const { ClientResponseError } = await import("pocketbase");
  const miss = () =>
    new ClientResponseError({ status: 404, response: {}, url: "" });
  const pb = {
    filter: (expr: string, params: Record<string, string>) => ({
      expr,
      params,
    }),
    collection: () => ({
      getFirstListItem: (f: {
        expr: string;
        params: Record<string, string>;
      }) => {
        if (f.expr.startsWith("hostname")) {
          state.lookups += 1;
          const row = state.rows.find((r) => r.hostname === f.params.h);
          if (!row) return Promise.reject(miss());
          return Promise.resolve({
            ...row,
            expand: { organization: state.orgs.get(row.organization) },
          });
        }
        const row = state.rows.find(
          (r) => r.organization === f.params.org && r.primary,
        );
        return row ? Promise.resolve(row) : Promise.reject(miss());
      },
    }),
  };
  return {
    withSuperuser: vi.fn((fn: (p: unknown) => unknown) =>
      Promise.resolve(fn(pb)),
    ),
  };
});

import { clearResolverCache, forgetHost, resolveOrganization } from "./resolve";

const ORG = "org000000000001";

beforeEach(() => {
  clearResolverCache();
  state.lookups = 0;
  state.orgs = new Map([
    [ORG, { id: ORG, slug: "crumb", status: "active", stage: "live" }],
  ]);
  state.rows = [
    {
      hostname: "crumb.sites.localhost",
      kind: "preview",
      primary: false,
      organization: ORG,
    },
    {
      hostname: "crumb.example",
      kind: "custom",
      primary: true,
      organization: ORG,
    },
    {
      hostname: "old-crumb.example",
      kind: "redirect",
      primary: false,
      redirect_to: "Crumb.Example",
      organization: ORG,
    },
  ];
});

describe("resolveOrganization host kinds (14-14)", () => {
  it("a redirect row resolves as redirect with a normalised redirectTo", async () => {
    const r = await resolveOrganization("old-crumb.example");
    expect(r?.hostKind).toBe("redirect");
    expect(r?.redirectTo).toBe("crumb.example");
    expect(r?.primaryHost).toBe("crumb.example");
  });

  it("preview and custom rows are unchanged and carry no redirectTo", async () => {
    const p = await resolveOrganization("crumb.sites.localhost");
    expect(p?.hostKind).toBe("preview");
    expect(p?.redirectTo).toBeNull();
    const c = await resolveOrganization("crumb.example");
    expect(c?.hostKind).toBe("custom");
    expect(c?.redirectTo).toBeNull();
  });

  it("live follows the org stage", async () => {
    expect((await resolveOrganization("crumb.example"))?.live).toBe(true);
    clearResolverCache();
    state.orgs.set(ORG, {
      id: ORG,
      slug: "crumb",
      status: "active",
      stage: "build",
    });
    expect((await resolveOrganization("crumb.example"))?.live).toBe(false);
  });

  it("an unknown kind is treated as preview", async () => {
    state.rows[0]!.kind = "weird";
    const r = await resolveOrganization("crumb.sites.localhost");
    expect(r?.hostKind).toBe("preview");
  });
});

describe("forgetHost (14-14)", () => {
  it("drops only that host from the cache", async () => {
    await resolveOrganization("crumb.example");
    await resolveOrganization("old-crumb.example");
    expect(state.lookups).toBe(2);

    forgetHost("CRUMB.example");
    await resolveOrganization("crumb.example");
    expect(state.lookups).toBe(3);
    await resolveOrganization("old-crumb.example");
    expect(state.lookups).toBe(3);
  });

  it("a changed row applies at once after forgetHost", async () => {
    expect((await resolveOrganization("crumb.example"))?.hostKind).toBe(
      "custom",
    );
    state.rows[1]!.kind = "redirect";
    state.rows[1]!.redirect_to = "www.crumb.example";
    expect((await resolveOrganization("crumb.example"))?.hostKind).toBe(
      "custom",
    );
    forgetHost("crumb.example");
    const r = await resolveOrganization("crumb.example");
    expect(r?.hostKind).toBe("redirect");
    expect(r?.redirectTo).toBe("www.crumb.example");
  });
});
