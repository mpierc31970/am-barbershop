// 12-07 Task 3: /hub/api/support-file/<id> (COMM-04; choice 9; T-12-07-01..03). Needs BOTH a
// hub session with support:read and a live signed link. Impersonating staff, a foreign id, a
// tampered link or missing params get the same 404; a genuine but expired link goes to the
// expired page. Images inline, everything else an attachment; nosniff, private, no-store.
// The HMAC, org, visibility and scan checks live in openSupportFile (unit + integration
// tests); here the mock stands in for them.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "sfaaaaaaaaaaaa1";
const GOOD = { exp: "1791000000000", sig: "goodsig" };

const state = vi.hoisted(() => ({
  session: null as null | { ctx: Record<string, unknown> },
}));

const db = vi.hoisted(() => {
  class SupportLinkExpired extends Error {
    override name = "SupportLinkExpired";
  }
  class NotFound extends Error {
    override name = "NotFound";
  }
  const files: Record<
    string,
    { mime: string; filename: string; inline: boolean }
  > = {
    sfaaaaaaaaaaaa1: {
      mime: "application/pdf",
      filename: 'Quote "final".pdf',
      inline: false,
    },
    sfimageaaaaaaa1: { mime: "image/png", filename: "shot.png", inline: true },
  };
  const openSupportFile = vi.fn(
    async (
      ctx: { orgId: string },
      id: string,
      link: { exp: unknown; sig: unknown },
    ) => {
      if (link.sig === "expiredsig") throw new SupportLinkExpired("expired");
      if (link.sig === "boom") throw new Error("s3 key tenants/x/support");
      const f = files[id];
      if (!f || ctx.orgId !== "orgaaaaaaaaaaa1" || link.sig !== "goodsig") {
        throw new NotFound();
      }
      const bytes = new TextEncoder().encode("%PDF-1.7");
      return {
        stream: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
        size: bytes.length,
        ...f,
      };
    },
  );
  return { SupportLinkExpired, NotFound, openSupportFile };
});

vi.mock("@cds/db", () => db);
vi.mock("../lib/session", () => ({
  getHubSession: async () => state.session,
}));

const { GET } =
  await import("../app/(platform)/hub/api/support-file/[id]/route");

function ctx(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orgId: "orgaaaaaaaaaaa1",
    actor: "useraaaaaaaaaa1",
    role: "viewer",
    grants: [],
    ip: "",
    ...over,
  };
}

function get(id = ID, q: Record<string, string> = GOOD): Promise<Response> {
  const qs = new URLSearchParams(q).toString();
  return GET(
    new Request(`https://cds.example/hub/api/support-file/${id}?${qs}`),
    { params: Promise.resolve({ id }) },
  );
}

function expectSafe(res: Response) {
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
}

beforeEach(() => {
  state.session = { ctx: ctx() };
  db.openSupportFile.mockClear();
});

describe("support file route (12-07)", () => {
  it("redirects a signed-out visitor to sign-in", async () => {
    state.session = null;
    const res = await get();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/sign-in");
    expect(db.openSupportFile).not.toHaveBeenCalled();
  });

  it("streams a PDF to a viewer as an attachment with a cleaned filename", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expectSafe(res);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-length")).toBe("8");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/^attachment; filename="[A-Za-z0-9._ -]+"; filename\*=/);
    expect(cd).toContain('filename="Quote -final.pdf"');
    expect(cd).not.toContain('"final"');
    expect(db.openSupportFile).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "orgaaaaaaaaaaa1" }),
      ID,
      { exp: GOOD.exp, sig: GOOD.sig },
    );
  });

  it("serves an image inline", async () => {
    const res = await get("sfimageaaaaaaa1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; /);
    expectSafe(res);
  });

  it("impersonating staff get the 404 without opening anything", async () => {
    state.session = { ctx: ctx({ role: "owner", impersonator: "staff1" }) };
    const res = await get();
    expect(res.status).toBe(404);
    expectSafe(res);
    expect(db.openSupportFile).not.toHaveBeenCalled();
  });

  it("a role without support:read gets the 404", async () => {
    state.session = { ctx: ctx({ role: "renter" }) };
    const res = await get();
    expect(res.status).toBe(404);
    expect(db.openSupportFile).not.toHaveBeenCalled();
  });

  it("a foreign org, a tampered link and missing params are the same 404", async () => {
    state.session = { ctx: ctx({ orgId: "orgbbbbbbbbbbb1" }) };
    const foreign = await get();
    state.session = { ctx: ctx() };
    const tampered = await get(ID, { exp: GOOD.exp, sig: "tampered" });
    const missing = await get(ID, { exp: GOOD.exp });
    const badId = await get("../etc");
    const bodies = await Promise.all(
      [foreign, tampered, missing, badId].map((r) => r.text()),
    );
    for (const r of [foreign, tampered, missing, badId]) {
      expect(r.status).toBe(404);
      expectSafe(r);
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain("We couldn&#x27;t open this file");
  });

  it("a genuine but expired link redirects to the expired page", async () => {
    const res = await get(ID, { exp: GOOD.exp, sig: "expiredsig" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/support-file-expired");
    expectSafe(res);
  });

  it("an unexpected error is a 404 and logs the class name only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get(ID, { exp: GOOD.exp, sig: "boom" });
    expect(res.status).toBe(404);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("tenants/");
    spy.mockRestore();
  });
});
