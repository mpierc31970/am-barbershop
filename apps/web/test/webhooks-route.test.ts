// POST /api/webhooks/stripe and /api/webhooks/stripe-connect (10-24; PAY-01; RESEARCH
// Pitfall 2; T-10-24-01/02/04): the raw body (req.text(), never req.json()) and the
// stripe-signature header go to the right processor; the processor's status is the
// response; an applied event revalidates the org's add-on cache; a throw is a 500 that
// logs the message only; GET reads as absent.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { status: 200 | 400 | 500; orgId: string | null };

const m = vi.hoisted(() => ({
  processCdsWebhook: vi.fn<(raw: string, sig: string) => Promise<Result>>(),
  processConnectWebhook: vi.fn<(raw: string, sig: string) => Promise<Result>>(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  ensurePaymentAddonDeps: vi.fn(),
}));

vi.mock("@cds/addon-registry/server", () => ({}));
vi.mock("../lib/payment-deps", () => ({
  ensurePaymentAddonDeps: m.ensurePaymentAddonDeps,
}));
vi.mock("next/cache", () => ({
  revalidateTag: m.revalidateTag,
  revalidatePath: m.revalidatePath,
}));
vi.mock("@cds/db", () => ({
  processCdsWebhook: (raw: string, sig: string) =>
    m.processCdsWebhook(raw, sig),
  processConnectWebhook: (raw: string, sig: string) =>
    m.processConnectWebhook(raw, sig),
}));

const { MAX_WEBHOOK_BYTES } = await import("../lib/capped-body");
const cds = await import("../app/api/webhooks/stripe/route");
const connect = await import("../app/api/webhooks/stripe-connect/route");

const BODY = '{"id":"evt_1","type":"invoice.paid","data":{"secret":"payload"}}';

function post(path: string, sig?: string, body: string = BODY): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (sig !== undefined) headers.set("stripe-signature", sig);
  return new Request(`https://cds.test${path}`, {
    method: "POST",
    headers,
    body,
  });
}

const ROUTES = [
  {
    name: "CDS",
    path: "/api/webhooks/stripe",
    mod: cds,
    file: "app/api/webhooks/stripe/route.ts",
    proc: m.processCdsWebhook,
    other: m.processConnectWebhook,
  },
  {
    name: "Connect",
    path: "/api/webhooks/stripe-connect",
    mod: connect,
    file: "app/api/webhooks/stripe-connect/route.ts",
    proc: m.processConnectWebhook,
    other: m.processCdsWebhook,
  },
] as const;

describe.each(ROUTES)("$name webhook route", (r) => {
  beforeEach(() => {
    vi.clearAllMocks();
    r.proc.mockResolvedValue({ status: 200, orgId: null });
  });

  it("is a force-dynamic nodejs route", () => {
    expect(r.mod.dynamic).toBe("force-dynamic");
    expect(r.mod.runtime).toBe("nodejs");
  });

  it("passes the raw body and signature to its own processor", async () => {
    const res = await r.mod.POST(post(r.path, "t=1,v1=abc"));
    expect(res.status).toBe(200);
    expect(r.proc).toHaveBeenCalledWith(BODY, "t=1,v1=abc");
    expect(r.other).not.toHaveBeenCalled();
    expect(m.ensurePaymentAddonDeps).toHaveBeenCalled();
    expect(await res.text()).toBe("");
  });

  it("WR-D01: a missing signature is a 400 before the body is read", async () => {
    const req = post(r.path);
    const read = vi.spyOn(req.body!, "getReader");
    const res = await r.mod.POST(req);
    expect(res.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
    expect(r.proc).not.toHaveBeenCalled();
  });

  it("WR-D01: a body over 1 MB is a 413 and never reaches the processor", async () => {
    // Declared too large.
    const big = new Request(`https://cds.test${r.path}`, {
      method: "POST",
      headers: {
        "stripe-signature": "sig",
        "content-length": String(MAX_WEBHOOK_BYTES + 1),
      },
      body: "x",
    });
    expect((await r.mod.POST(big)).status).toBe(413);
    // No length declared (chunked): the real bytes are counted and the read stops.
    const chunk = new Uint8Array(256 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 1;
        if (sent > 8) c.close();
        else c.enqueue(chunk);
      },
    });
    const chunked = new Request(`https://cds.test${r.path}`, {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await r.mod.POST(chunked)).status).toBe(413);
    expect(sent).toBeLessThanOrEqual(6);
    expect(r.proc).not.toHaveBeenCalled();
  });

  it("never parses the body before verification", async () => {
    const req = post(r.path, "sig");
    const json = vi.spyOn(req, "json");
    await r.mod.POST(req);
    expect(json).not.toHaveBeenCalled();
    const src = readFileSync(join(__dirname, "..", r.file), "utf8");
    expect(src).not.toContain("req.json()");
    expect(src).not.toContain("req.text()");
    expect(src.match(/readCappedText\(req, MAX_WEBHOOK_BYTES\)/g)).toHaveLength(
      1,
    );
  });

  it("an applied event revalidates the org's add-on cache", async () => {
    r.proc.mockResolvedValue({ status: 200, orgId: "x" });
    const res = await r.mod.POST(post(r.path, "sig"));
    expect(res.status).toBe(200);
    expect(m.revalidateTag).toHaveBeenCalledWith("org:x:addons");
    expect(m.revalidatePath).toHaveBeenCalledWith("/hub", "layout");
  });

  it("a duplicate or ignored event (no org) revalidates nothing", async () => {
    await r.mod.POST(post(r.path, "sig"));
    expect(m.revalidateTag).not.toHaveBeenCalled();
  });

  it("a failed handler answers 500 so Stripe retries", async () => {
    r.proc.mockResolvedValue({ status: 500, orgId: null });
    expect((await r.mod.POST(post(r.path, "sig"))).status).toBe(500);
    expect(m.revalidateTag).not.toHaveBeenCalled();
  });

  it("a thrown error is a 500 that logs only the message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    r.proc.mockRejectedValue(new Error("pb down"));
    const res = await r.mod.POST(post(r.path, "sig"));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("");
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("pb down");
    expect(logged).not.toContain("secret");
    spy.mockRestore();
  });

  it("GET reads as absent", () => {
    expect(r.mod.GET().status).toBe(404);
  });
});
