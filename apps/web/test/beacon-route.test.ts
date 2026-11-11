// 11-31 Task 2: POST /api/m on tenant hosts (DASH-11, DASH-15, DASH-32; T-11-31-01..04).
// The site comes only from the middleware tenant header (siteForRoute, mocked here); bots,
// oversize or malformed bodies, rate-limited IPs, preview hosts and non-live orgs are dropped
// with a silent 204; only real, live-site traffic reaches ingestBeacon.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  site: null as null | Record<string, unknown>,
  ip: "203.0.113.9",
}));

vi.mock("../lib/tenant", () => ({
  siteForRoute: async () => state.site,
}));
vi.mock("../lib/session", () => ({
  clientIp: async () => state.ip,
}));

const db = vi.hoisted(() => ({
  orgIsLive: vi.fn(),
  ingestBeacon: vi.fn(),
  startBeaconFlusher: vi.fn(),
}));
vi.mock("@cds/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@cds/db")>()),
  ...db,
}));

const { resetBeaconLimitForTests } = await import("@cds/db");
const route = await import("../app/tenant/[host]/api/m/route");

const HOST = "palm.example.com";
const SITE = {
  orgId: "org000000000001",
  host: HOST,
  hostKind: "custom",
  primaryHost: HOST,
};
const UA_CHROME =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

function post(
  body: string,
  {
    type = "text/plain;charset=UTF-8",
    ua = UA_CHROME,
  }: { type?: string; ua?: string } = {},
) {
  return route.POST(
    new Request(`https://${HOST}/api/m`, {
      method: "POST",
      headers: { "content-type": type, "user-agent": ua },
      body,
    }),
    { params: Promise.resolve({ host: HOST }) },
  );
}

const VIEW = JSON.stringify({
  t: "v",
  p: "/services",
  us: "instagram",
  um: "social",
  d: "m",
});

beforeEach(() => {
  vi.clearAllMocks();
  resetBeaconLimitForTests();
  state.site = { ...SITE };
  state.ip = "203.0.113.9";
  db.orgIsLive.mockResolvedValue(true);
  db.ingestBeacon.mockResolvedValue(true);
});

describe("POST /api/m (tenant beacon)", () => {
  it("is a force-dynamic nodejs route with no GET", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });

  it("ingests a valid view on a live org with its utm source", async () => {
    const res = await post(VIEW);
    expect(res.status).toBe(204);
    expect(db.ingestBeacon).toHaveBeenCalledTimes(1);
    const [site, ev] = db.ingestBeacon.mock.calls[0]!;
    expect(site).toBe(state.site);
    expect(ev).toMatchObject({
      t: "v",
      p: "/services",
      us: "instagram",
      d: "m",
    });
    expect(db.orgIsLive).toHaveBeenCalledWith(SITE.orgId);
    expect(db.startBeaconFlusher).toHaveBeenCalled();
  });

  it("accepts application/json too", async () => {
    expect((await post(VIEW, { type: "application/json" })).status).toBe(204);
    expect(db.ingestBeacon).toHaveBeenCalledTimes(1);
  });

  it("404s an unknown host", async () => {
    state.site = null;
    expect((await post(VIEW)).status).toBe(404);
    expect(db.ingestBeacon).not.toHaveBeenCalled();
  });

  it("drops Lighthouse and other bots with 204", async () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Chrome-Lighthouse";
    expect((await post(VIEW, { ua })).status).toBe(204);
    expect((await post(VIEW, { ua: "" })).status).toBe(204);
    expect(db.ingestBeacon).not.toHaveBeenCalled();
  });

  it("refuses a 3 KB body before parsing", async () => {
    const big = JSON.stringify({ t: "v", p: "/", pad: "x".repeat(3000) });
    const res = await post(big);
    expect([204, 413]).toContain(res.status);
    expect(db.ingestBeacon).not.toHaveBeenCalled();
  });

  it("drops malformed payloads and other content types", async () => {
    expect((await post("not json")).status).toBe(204);
    expect((await post(JSON.stringify({ t: "v", p: "x" }))).status).toBe(204);
    expect((await post(VIEW, { type: "multipart/form-data" })).status).toBe(
      415,
    );
    expect(db.ingestBeacon).not.toHaveBeenCalled();
  });

  it("counts nothing before launch (DASH-32)", async () => {
    db.orgIsLive.mockResolvedValue(false);
    expect((await post(VIEW)).status).toBe(204);
    expect(db.ingestBeacon).not.toHaveBeenCalled();
  });

  it("drops preview-host traffic (D170)", async () => {
    state.site = { ...SITE, hostKind: "preview" };
    expect((await post(VIEW)).status).toBe(204);
    expect(db.ingestBeacon).not.toHaveBeenCalled();
  });

  it("drops the 61st request in a minute from one IP, silently", async () => {
    for (let i = 0; i < 60; i++) {
      expect((await post(VIEW)).status).toBe(204);
    }
    expect(db.ingestBeacon).toHaveBeenCalledTimes(60);
    expect((await post(VIEW)).status).toBe(204);
    expect(db.ingestBeacon).toHaveBeenCalledTimes(60);
    // Another address still counts.
    state.ip = "198.51.100.7";
    await post(VIEW);
    expect(db.ingestBeacon).toHaveBeenCalledTimes(61);
  });

  it("answers 204 and logs only the error class when ingest fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.ingestBeacon.mockRejectedValue(new TypeError("boom 203.0.113.9"));
    expect((await post(VIEW)).status).toBe(204);
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("203.0.113.9");
    spy.mockRestore();
  });
});
