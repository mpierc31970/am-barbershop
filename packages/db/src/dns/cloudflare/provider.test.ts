// 14-11 (DOM-03, D55, D289; T-14-11-01..03): the Cloudflare v4 adapter against recorded
// v4-shaped fixtures only. Never live: every test injects `fetch`; an unmatched call fails.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DNS_PROVIDER_METHODS } from "../ports";
import { CloudflareError } from "./client";
import { cloudflareDnsProvider, type CfImportLock } from "./provider";
import zoneCreate from "./__fixtures__/zone-create-pending.json";
import zoneActive from "./__fixtures__/zone-get-active.json";
import page1 from "./__fixtures__/records-page-1.json";
import page2 from "./__fixtures__/records-page-2.json";
import recordCreate from "./__fixtures__/record-create.json";
import importResult from "./__fixtures__/import-result.json";
import scanReview from "./__fixtures__/scan-review.json";
import err1061 from "./__fixtures__/error-1061-exists.json";
import errRate from "./__fixtures__/error-rate-limit.json";

const HERE = dirname(fileURLToPath(import.meta.url));
const exportTxt = readFileSync(
  join(HERE, "__fixtures__", "export.txt"),
  "utf8",
);

const TOKEN = "cf_test_token_DO_NOT_LOG_7f3a";
const ACCOUNT = "01a7362d577a6c3019a474fd6f485823";
const ZONE = "023e105f4ecef8ad9ca31a8372d0c353";
const BASE = "https://api.cloudflare.com/client/v4";

type Call = { method: string; path: string; init: RequestInit };
type Route = {
  method: string;
  path: string | RegExp;
  status?: number;
  body: unknown;
  text?: boolean;
};

function fakeFetch(routes: Route[]) {
  const calls: Call[] = [];
  const fn = vi.fn(
    async (url: string | URL | Request, init: RequestInit = {}) => {
      const u = String(url);
      expect(u.startsWith(BASE)).toBe(true);
      const path = u.slice(BASE.length);
      const method = init.method ?? "GET";
      calls.push({ method, path, init });
      const route = routes.find(
        (r) =>
          r.method === method &&
          (typeof r.path === "string" ? r.path === path : r.path.test(path)),
      );
      if (!route) throw new Error(`unexpected ${method} ${path}`);
      const status = route.status ?? 200;
      const body = route.text ? String(route.body) : JSON.stringify(route.body);
      return new Response(body, {
        status,
        headers: {
          "Content-Type": route.text ? "text/plain" : "application/json",
        },
      });
    },
  );
  return { fn: fn as unknown as typeof globalThis.fetch, calls };
}

const passLock: CfImportLock = (fn) => fn();

function provider(routes: Route[], lock: CfImportLock = passLock) {
  const f = fakeFetch(routes);
  return {
    p: cloudflareDnsProvider({
      token: TOKEN,
      accountId: ACCOUNT,
      fetch: f.fn,
      lock,
    }),
    calls: f.calls,
  };
}

const ZONE_GET: Route = {
  method: "GET",
  path: `/zones/${ZONE}`,
  body: zoneActive,
};
const LIST_P1: Route = {
  method: "GET",
  path: `/zones/${ZONE}/dns_records?per_page=100&page=1`,
  body: page1,
};
const LIST_P2: Route = {
  method: "GET",
  path: `/zones/${ZONE}/dns_records?per_page=100&page=2`,
  body: page2,
};

function bodyOf(c: Call): Record<string, unknown> {
  return JSON.parse(String(c.init.body)) as Record<string, unknown>;
}

const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(vi.spyOn(console, m).mockImplementation(() => {}));
  }
});
afterEach(() => {
  // T-14-11-01: the adapter never writes anything (token included) to the console.
  for (const s of consoleSpies) expect(s).not.toHaveBeenCalled();
  for (const s of consoleSpies.splice(0)) s.mockRestore();
});

describe("cloudflareDnsProvider", () => {
  it("has the DnsProvider surface and name cloudflare", () => {
    const { p } = provider([]);
    expect(p.name).toBe("cloudflare");
    expect(Object.keys(p).sort()).toEqual(
      ["name", ...DNS_PROVIDER_METHODS].sort(),
    );
  });

  it("sends the bearer token on every call", async () => {
    const { p, calls } = provider([ZONE_GET]);
    await p.zoneStatus(ZONE);
    const h = new Headers(calls[0]?.init.headers);
    expect(h.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    // WR-A10: a timeout signal (the move runner holds the org lock).
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("createZone posts name + account id + full, maps initializing -> pending", async () => {
    const { p, calls } = provider([
      { method: "POST", path: "/zones", body: zoneCreate },
    ]);
    const z = await p.createZone("Rivera-Bakery.example.");
    expect(z).toEqual({
      zoneId: ZONE,
      nameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      status: "pending",
    });
    expect(bodyOf(calls[0] as Call)).toEqual({
      name: "rivera-bakery.example",
      account: { id: ACCOUNT },
      type: "full",
    });
  });

  it("createZone: 1061 -> CloudflareError zone_exists (not retryable, no host in message)", async () => {
    const { p } = provider([
      { method: "POST", path: "/zones", status: 400, body: err1061 },
      // Not in CDS's account (WR-A04 lookup finds nothing): still zone_exists.
      {
        method: "GET",
        path: `/zones?name=rivera-bakery.example&account.id=${ACCOUNT}`,
        body: { success: true, errors: [], messages: [], result: [] },
      },
    ]);
    const err = await p
      .createZone("rivera-bakery.example")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudflareError);
    expect((err as CloudflareError).code).toBe("zone_exists");
    expect((err as CloudflareError).retryable).toBe(false);
    expect((err as Error).message).not.toContain("rivera-bakery");
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it("createZone: 1061 for CDS's own orphan zone returns that zone (WR-A04)", async () => {
    const { p, calls } = provider([
      { method: "POST", path: "/zones", status: 400, body: err1061 },
      {
        method: "GET",
        path: `/zones?name=rivera-bakery.example&account.id=${ACCOUNT}`,
        body: { ...zoneCreate, result: [zoneCreate.result] },
      },
    ]);
    const z = await p.createZone("rivera-bakery.example");
    expect(z).toEqual({
      zoneId: ZONE,
      nameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      status: "pending",
    });
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
  });

  it("zoneStatus maps active", async () => {
    const { p } = provider([ZONE_GET]);
    expect(await p.zoneStatus(ZONE)).toBe("active");
  });

  it("listRecords follows two pages; TXT chunks joined; MX priority, SRV and CAA from data", async () => {
    const { p, calls } = provider([LIST_P1, LIST_P2]);
    const rs = await p.listRecords(ZONE);
    expect(calls.map((c) => c.path)).toEqual([LIST_P1.path, LIST_P2.path]);
    // HTTPS is not a port type: skipped.
    expect(rs).toHaveLength(6);
    const byType = Object.fromEntries(rs.map((r) => [r.type, r]));
    expect(byType.TXT?.value).toBe("v=spf1 include:_spf.google.example ~all");
    expect(byType.MX).toMatchObject({
      value: "smtp.google.example",
      priority: 1,
      ttl: 3600,
    });
    expect(byType.SRV).toMatchObject({
      name: "_sip._tcp.rivera-bakery.example",
      value: "5 5060 sip.rivera-bakery.example",
      priority: 10,
    });
    expect(byType.CAA?.value).toBe('0 issue "letsencrypt.org"');
    expect(byType.A).toMatchObject({
      id: "372e67954025e0ba6aaa6d586b9e0b59",
      ttl: 300,
    });
  });

  it("upsertRecord POSTs when absent, proxied:false, ttl 3600 off apex/www", async () => {
    const { p, calls } = provider([
      ZONE_GET,
      LIST_P1,
      LIST_P2,
      {
        method: "POST",
        path: `/zones/${ZONE}/dns_records`,
        body: recordCreate,
      },
    ]);
    const r = await p.upsertRecord(ZONE, {
      type: "A",
      name: "shop.rivera-bakery.example",
      value: "198.51.100.4",
    });
    expect(r.id).toBe("372e67954025e0ba6aaa6d586b9e0b70");
    const post = calls.find((c) => c.method === "POST") as Call;
    expect(bodyOf(post)).toEqual({
      type: "A",
      name: "shop.rivera-bakery.example",
      content: "198.51.100.4",
      ttl: 3600,
      proxied: false,
    });
  });

  it("upsertRecord PUTs when present (CNAME by name), apex/www ttl 300, proxied:false", async () => {
    const put = `/zones/${ZONE}/dns_records/372e67954025e0ba6aaa6d586b9e0b60`;
    const { p, calls } = provider([
      ZONE_GET,
      LIST_P1,
      LIST_P2,
      {
        method: "PUT",
        path: put,
        body: { ...recordCreate, result: page1.result[1] },
      },
    ]);
    await p.upsertRecord(ZONE, {
      type: "CNAME",
      name: "www.rivera-bakery.example",
      value: "edge.cds.example",
    });
    const c = calls.find((x) => x.method === "PUT") as Call;
    expect(c.path).toBe(put);
    expect(bodyOf(c)).toMatchObject({
      type: "CNAME",
      ttl: 300,
      proxied: false,
    });
    expect(calls.some((x) => x.method === "POST")).toBe(false);
  });

  it("upsertRecord: every body shape (TXT, MX, SRV, CAA) is proxied:false", async () => {
    const records = [
      {
        type: "TXT",
        name: "_dmarc.rivera-bakery.example",
        value: 'v=DMARC1; p=none; x="q"',
      },
      {
        type: "MX",
        name: "rivera-bakery.example",
        value: "mx2.example",
        priority: 5,
      },
      {
        type: "SRV",
        name: "_x._tcp.rivera-bakery.example",
        value: "1 443 t.example",
        priority: 2,
      },
      { type: "CAA", name: "rivera-bakery.example", value: '0 issuewild ";"' },
    ] as const;
    for (const rec of records) {
      const { p, calls } = provider([
        ZONE_GET,
        LIST_P1,
        LIST_P2,
        {
          method: "POST",
          path: `/zones/${ZONE}/dns_records`,
          body: recordCreate,
        },
      ]);
      await p.upsertRecord(ZONE, { ...rec });
      const b = bodyOf(calls.find((c) => c.method === "POST") as Call);
      expect(b.proxied).toBe(false);
      if (rec.type === "TXT")
        expect(b.content).toBe('"v=DMARC1; p=none; x=\\"q\\""');
      if (rec.type === "MX")
        expect(b).toMatchObject({ content: "mx2.example", priority: 5 });
      if (rec.type === "SRV")
        expect(b.data).toEqual({
          priority: 2,
          weight: 1,
          port: 443,
          target: "t.example",
        });
      if (rec.type === "CAA")
        expect(b.data).toEqual({ flags: 0, tag: "issuewild", value: ";" });
    }
  });

  it("upsertRecord refuses apex NS, SOA and out-of-zone names before writing", async () => {
    const { p, calls } = provider([ZONE_GET]);
    await expect(
      p.upsertRecord(ZONE, {
        type: "NS",
        name: "rivera-bakery.example",
        value: "ns.x.example",
      }),
    ).rejects.toThrow(/apex NS/);
    await expect(
      p.upsertRecord(ZONE, {
        type: "A",
        name: "other.example",
        value: "198.51.100.1",
      }),
    ).rejects.toThrow(/outside the zone/);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("deleteRecord DELETEs; a 404 is a no-op", async () => {
    const path = `/zones/${ZONE}/dns_records/abc`;
    const ok = provider([
      {
        method: "DELETE",
        path,
        body: { success: true, errors: [], result: { id: "abc" } },
      },
    ]);
    await ok.p.deleteRecord(ZONE, "abc");
    expect(ok.calls[0]?.method).toBe("DELETE");
    const gone = provider([
      {
        method: "DELETE",
        path,
        status: 404,
        body: { success: false, errors: [{ code: 81044 }], result: null },
      },
    ]);
    await expect(gone.p.deleteRecord(ZONE, "abc")).resolves.toBeUndefined();
  });

  it("importBind sends multipart file + proxied=false under the lock, trailing dots on targets", async () => {
    const lock = vi.fn<CfImportLock>((fn) => fn());
    const { p, calls } = provider(
      [
        ZONE_GET,
        {
          method: "POST",
          path: `/zones/${ZONE}/dns_records/import`,
          body: importResult,
        },
      ],
      lock as unknown as CfImportLock,
    );
    const res = await p.importBind(
      ZONE,
      "$ORIGIN rivera-bakery.example.\n@ 3600 IN MX 10 mail.rivera-bakery.example\nwww 300 IN CNAME rivera-bakery.example.\n",
    );
    expect(res).toEqual({ added: 5, skipped: 1 });
    expect(lock).toHaveBeenCalledTimes(1);
    const c = calls.find((x) => x.path.endsWith("/import")) as Call;
    const form = c.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("proxied")).toBe("false");
    const file = await (form.get("file") as Blob).text();
    expect(file).toMatch(/MX\s+10\s+mail\.rivera-bakery\.example\./);
    expect(file).toMatch(/CNAME\s+rivera-bakery\.example\./);
    expect(new Headers(c.init.headers).get("Content-Type")).toBeNull();
  });

  it("importBind refuses more than 256 KiB before any fetch", async () => {
    const { p, calls } = provider([]);
    const big = `; ${"x".repeat(300 * 1024)}\n`;
    const err = await p.importBind(ZONE, big).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudflareError);
    expect((err as CloudflareError).code).toBe("too_large");
    expect(calls).toHaveLength(0);
  });

  it("importBind: a busy lock surfaces as retryable, no import call", async () => {
    const busy: CfImportLock = () =>
      Promise.reject(new CloudflareError("import_busy", null, true));
    const { p, calls } = provider([ZONE_GET], busy);
    const err = await p
      .importBind(
        ZONE,
        "$ORIGIN rivera-bakery.example.\n@ 300 IN A 198.51.100.4\n",
      )
      .catch((e: unknown) => e);
    expect((err as CloudflareError).retryable).toBe(true);
    expect(calls.some((c) => c.path.endsWith("/import"))).toBe(false);
  });

  it("exportBind returns the BIND text", async () => {
    const { p } = provider([
      {
        method: "GET",
        path: `/zones/${ZONE}/dns_records/export`,
        body: exportTxt,
        text: true,
      },
    ]);
    expect(await p.exportBind(ZONE)).toBe(exportTxt);
  });

  it("scanRecords triggers then reads the review list, sources scan", async () => {
    const { p, calls } = provider([
      {
        method: "POST",
        path: `/zones/${ZONE}/dns_records/scan/trigger`,
        body: { success: true, errors: [], result: null },
      },
      {
        method: "GET",
        path: `/zones/${ZONE}/dns_records/scan/review`,
        body: scanReview,
      },
    ]);
    const rs = await p.scanRecords(ZONE);
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    expect(rs).toHaveLength(3);
    expect(rs.every((r) => r.sources?.[0] === "scan" && !("id" in r))).toBe(
      true,
    );
    expect(rs[2]?.value).toBe("google-site-verification=abc123");
  });

  it("deleteZone DELETEs the zone", async () => {
    const { p, calls } = provider([
      {
        method: "DELETE",
        path: `/zones/${ZONE}`,
        body: { success: true, errors: [], result: { id: ZONE } },
      },
    ]);
    await p.deleteZone(ZONE);
    expect(calls[0]?.method).toBe("DELETE");
  });

  it("429 -> retryable; 500 -> retryable; 400 -> not; no token in the message", async () => {
    for (const [status, retryable] of [
      [429, true],
      [503, true],
      [400, false],
    ] as const) {
      const { p } = provider([{ ...ZONE_GET, status, body: errRate }]);
      const err = await p.zoneStatus(ZONE).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CloudflareError);
      expect((err as CloudflareError).retryable).toBe(retryable);
      expect((err as CloudflareError).code).toBe("10000");
      expect(String((err as Error).message)).not.toContain(TOKEN);
    }
  });

  it("a network failure is retryable and never echoes the cause", async () => {
    const boom = vi.fn(async () => {
      throw new Error(`connect failed ${BASE}/zones/${ZONE} Bearer ${TOKEN}`);
    }) as unknown as typeof globalThis.fetch;
    const p = cloudflareDnsProvider({
      token: TOKEN,
      accountId: ACCOUNT,
      fetch: boom,
      lock: passLock,
    });
    const err = await p.zoneStatus(ZONE).catch((e: unknown) => e);
    expect((err as CloudflareError).code).toBe("network");
    expect((err as CloudflareError).retryable).toBe(true);
    expect((err as Error).message).not.toContain(TOKEN);
    expect((err as Error).message).not.toContain(ZONE);
  });

  it("refuses a malformed zone id before fetching", async () => {
    const { p, calls } = provider([]);
    await expect(p.zoneStatus("../accounts")).rejects.toThrow(/invalid id/);
    expect(calls).toHaveLength(0);
  });

  it("needs a token and an account id", () => {
    expect(() =>
      cloudflareDnsProvider({ token: "", accountId: ACCOUNT }),
    ).toThrow(/CLOUDFLARE_API_TOKEN/);
    expect(() =>
      cloudflareDnsProvider({ token: TOKEN, accountId: "" }),
    ).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
  });
});
