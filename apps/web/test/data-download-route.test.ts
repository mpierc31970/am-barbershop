// 11-41 (LIFE-04; D285; T-11-41-01..04): /hub/api/data-download/<id> needs BOTH the Owner
// session of the org and a live signed link. Any other role, impersonating staff, a foreign
// id or a tampered link is the same 404 (never a storage error); a genuine but expired link
// goes to the expired page. The zip streams as an attachment, private and no-store. The HMAC,
// row ownership and expiry checks themselves live in openDataDownload (11-40 unit and
// integration tests, incl. the cross-org attack); here they are stood in by the mock.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "dlaaaaaaaaaaaa1";
const GOOD = { exp: "1791000000000", sig: "goodsig" };

const state = vi.hoisted(() => ({
  session: null as null | { ctx: Record<string, unknown> },
  sessionThrows: false,
}));

const db = vi.hoisted(() => {
  class DownloadLinkExpired extends Error {
    override name = "DownloadLinkExpired";
  }
  class NotFound extends Error {
    override name = "NotFound";
  }
  const openDataDownload = vi.fn(
    async (
      ctx: { orgId: string },
      id: string,
      link: { exp: unknown; sig: unknown },
    ) => {
      if (link.sig === "expiredsig") throw new DownloadLinkExpired("expired");
      if (link.sig === "boom") throw new Error("s3 key tenants/x/exports");
      if (ctx.orgId !== "orgaaaaaaaaaaa1" || link.sig !== "goodsig") {
        throw new NotFound();
      }
      const bytes = new TextEncoder().encode("PK\u0003\u0004zip");
      return {
        stream: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
        size: bytes.length,
        filename: `acme "co"-data-2026-10-12.zip`,
      };
    },
  );
  return { DownloadLinkExpired, NotFound, openDataDownload };
});

vi.mock("@cds/db", () => db);
vi.mock("../lib/session", () => ({
  getHubSession: async () => {
    if (state.sessionThrows) throw new Error("pb down");
    return state.session;
  },
}));

const { GET } =
  await import("../app/(platform)/hub/api/data-download/[id]/route");

function ctx(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orgId: "orgaaaaaaaaaaa1",
    actor: "useraaaaaaaaaa1",
    role: "owner",
    grants: [],
    ip: "",
    ...over,
  };
}

function get(id = ID, q: Record<string, string> = GOOD): Promise<Response> {
  const qs = new URLSearchParams(q).toString();
  return GET(
    new Request(`https://cds.example/hub/api/data-download/${id}?${qs}`),
    {
      params: Promise.resolve({ id }),
    },
  );
}

function expectSafe(res: Response) {
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
}

beforeEach(() => {
  state.session = { ctx: ctx() };
  state.sessionThrows = false;
  db.openDataDownload.mockClear();
});

describe("data download route (11-41)", () => {
  it("streams the zip to the Owner with a valid link", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expectSafe(res);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-length")).toBe("7");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.zip"$/);
    expect(cd).toContain("acme-co-data-2026-10-12.zip");
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x50);
    expect(db.openDataDownload).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "orgaaaaaaaaaaa1" }),
      ID,
      { exp: GOOD.exp, sig: GOOD.sig },
    );
  });

  it.each(["admin", "editor", "viewer"])(
    "a valid link with a %s session is a 404 (never opened)",
    async (role) => {
      state.session = { ctx: ctx({ role }) };
      const res = await get();
      expect(res.status).toBe(404);
      expectSafe(res);
      expect(db.openDataDownload).not.toHaveBeenCalled();
    },
  );

  it("impersonating staff get a 404 (T-11-41-03)", async () => {
    state.session = { ctx: ctx({ impersonator: "staffaaaaaaaaa1" }) };
    const res = await get();
    expect(res.status).toBe(404);
    expect(db.openDataDownload).not.toHaveBeenCalled();
  });

  it("another org's Owner session is a 404", async () => {
    state.session = { ctx: ctx({ orgId: "orgbbbbbbbbbbb1" }) };
    const res = await get();
    expect(res.status).toBe(404);
    expectSafe(res);
    expect(await res.text()).toContain("We couldn&#x27;t open this download");
  });

  it("a tampered signature is a 404", async () => {
    const res = await get(ID, { exp: GOOD.exp, sig: "tampered" });
    expect(res.status).toBe(404);
  });

  it("a genuine but expired link redirects to the expired page", async () => {
    const res = await get(ID, { exp: GOOD.exp, sig: "expiredsig" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/download-expired");
    expectSafe(res);
  });

  it("missing exp/sig or a malformed id never reaches storage", async () => {
    expect((await get(ID, {})).status).toBe(404);
    expect((await get("../etc/passwd")).status).toBe(404);
    expect((await get("ABC")).status).toBe(404);
    expect(db.openDataDownload).not.toHaveBeenCalled();
  });

  it("a storage error is a plain 404, logged by class name only (T-11-41-04)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get(ID, { exp: GOOD.exp, sig: "boom" });
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain("tenants/");
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("Error");
    expect(logged).not.toContain("tenants/");
    spy.mockRestore();
  });

  it("signed out goes to sign-in", async () => {
    state.session = null;
    const res = await get();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/sign-in");
  });

  it("a session outage is a 404, not a crash", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.sessionThrows = true;
    expect((await get()).status).toBe(404);
    spy.mockRestore();
  });
});
