// Review 11 WR-C01: /hub/switch opens a push notification's link in the site that raised it.
// The org is honoured only when it is one of the person's own memberships; `next` must pass
// isHubHref. next/headers, next/cache, next/navigation and @cds/db are mocked the way
// org-switch.test.ts does.
import { Forbidden } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sets: [] as { name: string; value: string }[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: (name: string, value: string) => {
      state.sets.push({ name, value });
      state.jar.set(name, value);
    },
    delete: (arg: unknown) => {
      const name =
        typeof arg === "string" ? arg : (arg as { name: string }).name;
      state.jar.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`REDIRECT:${to}`), {
      digest: `NEXT_REDIRECT;replace;${to};307;`,
    });
  },
}));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const { GET } = await import("../app/(platform)/hub/switch/route");

const A = "aaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbb";
const FOREIGN = "fffffffffffffff";

function member(): void {
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "a@b.c",
    organizations: [
      { id: A, name: "A", role: "owner", status: "active", primaryHost: null },
      { id: B, name: "B", role: "editor", status: "active", primaryHost: null },
    ],
  });
}

/** Where the route redirected to. */
async function go(query: string): Promise<string> {
  const err = await GET(
    new Request(`https://cds.example.com/hub/switch?${query}`),
  ).catch((e: unknown) => e);
  const msg = (err as Error).message;
  expect(msg).toMatch(/^REDIRECT:/);
  return msg.slice("REDIRECT:".length);
}

const next = (href: string) => encodeURIComponent(href);

beforeEach(() => {
  state.jar.clear();
  state.sets.length = 0;
  revalidatePath.mockReset();
  db.listMemberOrganizations.mockReset();
});

describe("/hub/switch (WR-C01)", () => {
  it("switches to a member org and opens the link in it, with the switched toast", async () => {
    member();
    state.jar.set("cds_org", B);
    expect(await go(`org=${A}&next=${next("/hub/inbox/m1")}`)).toBe(
      "/hub/inbox/m1?flash=switched",
    );
    expect(state.sets).toEqual([{ name: "cds_org", value: A }]);
    expect(revalidatePath).toHaveBeenCalledWith("/hub", "layout");
  });

  it("already in that org: opens the link without switching", async () => {
    member();
    state.jar.set("cds_org", A);
    expect(await go(`org=${A}&next=${next("/hub/settings?tab=billing")}`)).toBe(
      "/hub/settings?tab=billing",
    );
    expect(state.sets).toEqual([]);
  });

  it("an org that is not the person's own lands on Today, cookie untouched", async () => {
    member();
    state.jar.set("cds_org", B);
    for (const org of [FOREIGN, "../x", ""]) {
      expect(await go(`org=${org}&next=${next("/hub/inbox")}`)).toBe(
        "/hub/today",
      );
    }
    expect(state.sets).toEqual([]);
  });

  it("a refused membership lookup lands on Today", async () => {
    state.jar.set("cds_session", "tok");
    db.listMemberOrganizations.mockRejectedValue(new Forbidden());
    expect(await go(`org=${A}&next=${next("/hub/inbox")}`)).toBe("/hub/today");
    expect(state.sets).toEqual([]);
  });

  it("next must be a hub link (open-redirect guard)", async () => {
    member();
    for (const bad of [
      "https://evil.example.com",
      "//evil.example.com",
      "/hub/../api/jobs/alerts",
      "/sign-out",
    ]) {
      state.jar.set("cds_org", A);
      expect(await go(`org=${A}&next=${next(bad)}`)).toBe("/hub/today");
    }
  });

  it("signed out: the link opens as is (the hub asks to sign in)", async () => {
    expect(await go(`org=${A}&next=${next("/hub/inbox")}`)).toBe("/hub/inbox");
    expect(db.listMemberOrganizations).not.toHaveBeenCalled();
    expect(state.sets).toEqual([]);
  });
});
