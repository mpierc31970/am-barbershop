import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidInput } from "@cds/core";
import {
  assertValidKey,
  devMailKey,
  tenantMediaKey,
  describeObjectStore,
  describePublicMediaStore,
  getObjectStore,
  getPublicMediaStore,
  tenantPublicMediaKey,
  platformDbPrefix,
  tenantAddonBackupKey,
  tenantExportKey,
  tenantExportPrefix,
  tenantPublishedPageKey,
  tenantSiteManifestKey,
  tenantSiteIndexKey,
  tenantVersionKey,
  tenantVersionPrefix,
  SITE_HISTORY_PARTS,
  tenantSitePartVersionKey,
  tenantSitePartVersionPrefix,
  tenantAgreementKey,
  tenantAgreementPrefix,
  getAgreementStore,
} from "./index";
import { LocalDiskStore } from "./local-disk";
import { S3Store } from "./s3";

const AT = new Date("2026-09-26T04:10:00.000Z");
const ENV_KEYS = [
  "CDS_ENV",
  "WASABI_ACCESS_KEY_ID",
  "WASABI_SECRET_ACCESS_KEY",
  "WASABI_REGION",
  "WASABI_BUCKET",
  "CDS_STORAGE_DIR",
  "WASABI_MEDIA_BUCKET",
  "CDS_PUBLIC_STORAGE_DIR",
  "WASABI_AGREEMENTS_BUCKET",
];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

describe("key layout (D171, D187, TEN-12)", () => {
  it("prefixes dev/ unless CDS_ENV=production", () => {
    expect(tenantExportKey("abc123", AT)).toBe(
      "dev/tenants/abc123/exports/2026-09-26T04-10-00-000Z.json",
    );
    expect(tenantExportPrefix("abc123")).toBe("dev/tenants/abc123/exports/");
    expect(platformDbPrefix()).toBe("dev/platform/db/");
    process.env.CDS_ENV = "production";
    expect(tenantExportKey("abc123", AT)).toBe(
      "tenants/abc123/exports/2026-09-26T04-10-00-000Z.json",
    );
    expect(platformDbPrefix()).toBe("platform/db/");
  });

  it("builds version and add-on backup keys", () => {
    expect(tenantVersionKey("abc123", "page_1", AT)).toBe(
      "dev/tenants/abc123/versions/pages/page_1/2026-09-26T04-10-00-000Z.json",
    );
    expect(tenantVersionPrefix("abc123", "page_1")).toBe(
      "dev/tenants/abc123/versions/pages/page_1/",
    );
    expect(tenantAddonBackupKey("abc123", "studio-booking", AT)).toBe(
      "dev/tenants/abc123/backups/studio-booking/2026-09-26T04-10-00-000Z.json",
    );
  });

  it("builds published page and site manifest keys (D187, D253)", () => {
    expect(tenantPublishedPageKey("abc123", "page_1")).toBe(
      "dev/tenants/abc123/published/pages/page_1.json",
    );
    expect(tenantSiteManifestKey("abc123")).toBe(
      "dev/tenants/abc123/published/site.json",
    );
    process.env.CDS_ENV = "production";
    expect(tenantVersionKey("abc123", "page_1", AT)).toBe(
      "tenants/abc123/versions/pages/page_1/2026-09-26T04-10-00-000Z.json",
    );
    expect(tenantPublishedPageKey("abc123", "page_1")).toBe(
      "tenants/abc123/published/pages/page_1.json",
    );
    expect(tenantSiteManifestKey("abc123")).toBe(
      "tenants/abc123/published/site.json",
    );
  });

  it("builds the site index key under published/ (07-31, D277)", () => {
    expect(tenantSiteIndexKey("abc123")).toBe(
      "dev/tenants/abc123/published/index.json",
    );
    process.env.CDS_ENV = "production";
    expect(tenantSiteIndexKey("abc123")).toBe(
      "tenants/abc123/published/index.json",
    );
    for (const bad of ["../x", "..", "a/b", ""]) {
      expect(() => tenantSiteIndexKey(bad)).toThrow(InvalidInput);
    }
  });

  it("rejects traversal in every page key helper (T-03-10)", () => {
    for (const bad of ["../x", "..", "a/b", ""]) {
      expect(() => tenantVersionKey("abc", bad, AT)).toThrow(InvalidInput);
      expect(() => tenantVersionPrefix("abc", bad)).toThrow(InvalidInput);
      expect(() => tenantPublishedPageKey("abc", bad)).toThrow(InvalidInput);
      expect(() => tenantVersionKey(bad, "page_1", AT)).toThrow(InvalidInput);
      expect(() => tenantPublishedPageKey(bad, "page_1")).toThrow(InvalidInput);
      expect(() => tenantSiteManifestKey(bad)).toThrow(InvalidInput);
    }
  });

  it("rejects unsafe ids", () => {
    expect(() => tenantExportKey("../x", AT)).toThrow(InvalidInput);
    expect(() => tenantExportPrefix("a/b")).toThrow(InvalidInput);
    expect(() => tenantVersionKey("abc", "..", AT)).toThrow(InvalidInput);
    expect(() => tenantAddonBackupKey("abc", "", AT)).toThrow(InvalidInput);
  });

  it("devMailKey is a valid dev/mail/ key (06-06, PD-17)", () => {
    const key = devMailKey(AT, "quote.saved", "message.html");
    expect(key).toBe("dev/mail/20260926T041000Z-quote.saved/message.html");
    expect(() => assertValidKey(key)).not.toThrow();
    expect(() => devMailKey(AT, "../x", "message.txt")).toThrow(InvalidInput);
    expect(() =>
      devMailKey(AT, "quote.saved", "evil.sh" as "message.txt"),
    ).toThrow(InvalidInput);
  });

  it("tenantMediaKey builds tenants/<org>/media/<asset>/<variant> (06-13)", () => {
    expect(tenantMediaKey("org1", "asset1", "web.webp")).toBe(
      "dev/tenants/org1/media/asset1/web.webp",
    );
    process.env.CDS_ENV = "production";
    expect(tenantMediaKey("org1", "asset1", "thumb.webp")).toBe(
      "tenants/org1/media/asset1/thumb.webp",
    );
    expect(() =>
      tenantMediaKey("org1", "asset1", "x.exe" as "web.webp"),
    ).toThrow(InvalidInput);
    expect(() => tenantMediaKey("org1", "../a", "web.webp")).toThrow(
      InvalidInput,
    );
    expect(() => tenantMediaKey("../o", "a", "web.webp")).toThrow(InvalidInput);
  });
});

describe("site-part history keys (07-29, CONT-36, D187)", () => {
  it("lists exactly the four parts", () => {
    expect([...SITE_HISTORY_PARTS]).toEqual([
      "nav",
      "footer",
      "banner",
      "settings",
    ]);
  });

  it("builds tenants/<org>/versions/site/<part>/<stamp>.json", () => {
    const at = new Date("2026-09-28T14:14:00.000Z");
    expect(tenantSitePartVersionKey("org1", "nav", at)).toBe(
      "dev/tenants/org1/versions/site/nav/2026-09-28T14-14-00-000Z.json",
    );
    expect(tenantSitePartVersionPrefix("org1", "settings")).toBe(
      "dev/tenants/org1/versions/site/settings/",
    );
    process.env.CDS_ENV = "production";
    expect(tenantSitePartVersionKey("org1", "footer", at)).toBe(
      "tenants/org1/versions/site/footer/2026-09-28T14-14-00-000Z.json",
    );
  });

  it("rejects an unknown part or traversal (T-07-29-02)", () => {
    for (const bad of ["pages", "../x", "", "nav/x"]) {
      expect(() => tenantSitePartVersionPrefix("org1", bad)).toThrow(
        InvalidInput,
      );
      expect(() => tenantSitePartVersionKey("org1", bad, AT)).toThrow(
        InvalidInput,
      );
    }
    expect(() => tenantSitePartVersionPrefix("../o", "nav")).toThrow(
      InvalidInput,
    );
  });
});

describe("LocalDiskStore", () => {
  let root: string;
  let store: LocalDiskStore;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cds-store-"));
    store = new LocalDiskStore(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("round-trips bytes and strings", async () => {
    await store.put("dev/tenants/a/exports/x.json", '{"a":1}');
    const got = await store.get("dev/tenants/a/exports/x.json");
    expect(new TextDecoder().decode(got!)).toBe('{"a":1}');
    const bytes = new Uint8Array([0, 1, 2, 255]);
    await store.put("b.bin", bytes);
    expect(Array.from((await store.get("b.bin"))!)).toEqual([0, 1, 2, 255]);
  });

  it("returns null for a missing key", async () => {
    expect(await store.get("nope/x.json")).toBeNull();
  });

  it("lists only keys under the prefix, sorted, with Dates", async () => {
    await store.put("dev/tenants/a/exports/2.json", "2");
    await store.put("dev/tenants/a/exports/1.json", "1");
    await store.put("dev/tenants/b/exports/1.json", "x");
    const list = await store.list("dev/tenants/a/");
    expect(list.map((o) => o.key)).toEqual([
      "dev/tenants/a/exports/1.json",
      "dev/tenants/a/exports/2.json",
    ]);
    expect(list[0]!.lastModified).toBeInstanceOf(Date);
    expect(await store.list("dev/tenants/zzz/")).toEqual([]);
  });

  it("deletes, and leaves no temp files behind", async () => {
    await store.put("k/x.json", "1");
    await store.delete("k/x.json");
    expect(await store.get("k/x.json")).toBeNull();
    await store.delete("k/x.json");
    await store.put("k/y.json", "1");
    expect(readdirSync(join(root, "k"))).toEqual(["y.json"]);
  });

  it("putIfAbsent creates once and never overwrites (AGR-04)", async () => {
    const key = "dev/tenants/a/agreements/s1.html";
    expect(await store.putIfAbsent(key, "a")).toBe("created");
    expect(await store.putIfAbsent(key, "b")).toBe("exists");
    expect(new TextDecoder().decode((await store.get(key))!)).toBe("a");
    expect(readdirSync(join(root, "dev/tenants/a/agreements"))).toEqual([
      "s1.html",
    ]);
    await expect(store.putIfAbsent("../x", "a")).rejects.toThrow(InvalidInput);
  });

  it("putIfAbsent: concurrent calls yield exactly one created", async () => {
    const key = "dev/tenants/a/agreements/race.json";
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => store.putIfAbsent(key, `v${i}`)),
    );
    expect(results.filter((r) => r === "created")).toHaveLength(1);
    expect(results.filter((r) => r === "exists")).toHaveLength(7);
    expect(readdirSync(join(root, "dev/tenants/a/agreements"))).toEqual([
      "race.json",
    ]);
  });

  it.each(["../x", "a/../b", "/abs", "a\\b", "a//b", "", ".hidden"])(
    "rejects key %j before touching disk",
    async (key) => {
      await expect(store.put(key, "x")).rejects.toThrow(InvalidInput);
      await expect(store.get(key)).rejects.toThrow(InvalidInput);
    },
  );
});

function xml(body: string) {
  return new Response(body, { status: 200 });
}

describe("S3Store (Wasabi, SigV4)", () => {
  const cfg = {
    accessKeyId: "AKIDTEST",
    secretAccessKey: "supersecretvalue",
    region: "us-east-1",
    bucket: "cds-platform",
  };

  it("PUTs path-style to wasabisys with a SigV4 Authorization header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, { status: 200 });
      }),
    );
    await new S3Store(cfg).put("dev/tenants/a/exports/x.json", "{}");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://s3.us-east-1.wasabisys.com/cds-platform/dev/tenants/a/exports/x.json",
    );
    expect(calls[0]!.init.method).toBe("PUT");
    const auth = new Headers(calls[0]!.init.headers).get("authorization");
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(auth).not.toContain("supersecretvalue");
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("lists across continuation pages and decodes entities", async () => {
    const urls: string[] = [];
    const pages = [
      `<ListBucketResult><Contents><Key>dev/a/1.json</Key><LastModified>2026-09-26T04:10:00.000Z</LastModified></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;1</NextContinuationToken></ListBucketResult>`,
      `<ListBucketResult><Contents><Key>dev/a/b&amp;c.json</Key><LastModified>2026-09-26T05:00:00.000Z</LastModified></Contents><IsTruncated>false</IsTruncated></ListBucketResult>`,
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return xml(pages[urls.length - 1]!);
      }),
    );
    const list = await new S3Store(cfg).list("dev/a/");
    expect(list.map((o) => o.key)).toEqual(["dev/a/1.json", "dev/a/b&c.json"]);
    expect(list[1]!.lastModified.toISOString()).toBe(
      "2026-09-26T05:00:00.000Z",
    );
    expect(urls[0]).toContain("list-type=2");
    expect(urls[0]).toContain("prefix=dev%2Fa%2F");
    expect(urls[1]).toContain("continuation-token=tok%261");
  });

  it("get: 404 -> null, other errors carry status only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("NoSuchKey", { status: 404 })),
    );
    expect(await new S3Store(cfg).get("x/y.json")).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<Error/>", { status: 403 })),
    );
    const err = await new S3Store(cfg).get("x/y.json").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).toContain("403");
    expect(String(err.message)).not.toContain("supersecretvalue");
    expect(String(err.message)).not.toContain("AKIDTEST");
  });

  describe("putIfAbsent (AGR-04)", () => {
    const KEY = "dev/tenants/a/agreements/s1.html";
    function fake(statuses: number[]) {
      const calls: { method: string; headers: Headers }[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          calls.push({
            method: String(init.method),
            headers: new Headers(init.headers),
          });
          const status = statuses[calls.length - 1] ?? 500;
          return new Response(null, { status });
        }),
      );
      return calls;
    }

    it("HEAD 200 -> exists, no PUT", async () => {
      const calls = fake([200]);
      expect(await new S3Store(cfg).putIfAbsent(KEY, "x")).toBe("exists");
      expect(calls.map((c) => c.method)).toEqual(["HEAD"]);
    });

    it("HEAD 404, PUT 200 -> created with if-none-match: *", async () => {
      const calls = fake([404, 200]);
      expect(await new S3Store(cfg).putIfAbsent(KEY, "x", "text/html")).toBe(
        "created",
      );
      expect(calls.map((c) => c.method)).toEqual(["HEAD", "PUT"]);
      expect(calls[1]!.headers.get("if-none-match")).toBe("*");
      expect(calls[1]!.headers.get("content-type")).toBe("text/html");
      // Object Lock buckets want an integrity header on PUT (WR-A04).
      expect(calls[1]!.headers.get("content-md5")).toBe(
        createHash("md5").update("x").digest("base64"),
      );
      expect(calls[1]!.headers.get("authorization")).toContain("content-md5");
    });

    it("HEAD 404, PUT 412 -> exists", async () => {
      fake([404, 412]);
      expect(await new S3Store(cfg).putIfAbsent(KEY, "x")).toBe("exists");
    });

    it("HEAD 404, PUT 500 -> throws with status only", async () => {
      fake([404, 500]);
      const err = await new S3Store(cfg).putIfAbsent(KEY, "x").catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(String(err.message)).toBe(
        "object store putIfAbsent failed: HTTP 500",
      );
    });

    it("HEAD 403 -> throws", async () => {
      fake([403]);
      await expect(new S3Store(cfg).putIfAbsent(KEY, "x")).rejects.toThrow(
        /HTTP 403/,
      );
    });
  });

  it("validates keys before any request", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(new S3Store(cfg).put("../x", "1")).rejects.toThrow(
      InvalidInput,
    );
    expect(f).not.toHaveBeenCalled();
  });
});

describe("getObjectStore", () => {
  it("defaults to the local-disk stand-in", () => {
    process.env.CDS_STORAGE_DIR = join(tmpdir(), "cds-store-default");
    expect(getObjectStore()).toBeInstanceOf(LocalDiskStore);
  });

  it("selects Wasabi when all three WASABI_* vars and CDS_ENV are set", () => {
    process.env.WASABI_ACCESS_KEY_ID = "a";
    process.env.WASABI_SECRET_ACCESS_KEY = "SECRETVALUE";
    process.env.WASABI_REGION = "us-east-1";
    process.env.CDS_ENV = "dev";
    expect(getObjectStore()).toBeInstanceOf(S3Store);
    expect(describeObjectStore()).toBe(
      "wasabi bucket cds-platform (us-east-1), prefix dev/",
    );
    expect(describeObjectStore()).not.toContain("SECRETVALUE");
  });

  it("throws on a partial Wasabi config instead of falling back (WR-07)", () => {
    process.env.CDS_ENV = "production";
    process.env.WASABI_ACCESS_KEY_ID = "a";
    process.env.WASABI_SECRET_ACCESS_KEY = "b";
    expect(() => getObjectStore()).toThrow(/WASABI_REGION/);
    delete process.env.WASABI_ACCESS_KEY_ID;
    delete process.env.WASABI_SECRET_ACCESS_KEY;
    process.env.WASABI_BUCKET = "x";
    expect(() => getObjectStore()).toThrow(/partly configured/);
  });

  it("throws when Wasabi is configured but CDS_ENV is not (WR-07)", () => {
    process.env.WASABI_ACCESS_KEY_ID = "a";
    process.env.WASABI_SECRET_ACCESS_KEY = "b";
    process.env.WASABI_REGION = "us-east-1";
    expect(() => getObjectStore()).toThrow(/CDS_ENV/);
  });

  it("accepts only dev or production for CDS_ENV (IN-05)", () => {
    process.env.CDS_STORAGE_DIR = join(tmpdir(), "cds-store-env");
    process.env.CDS_ENV = "dev";
    expect(tenantExportPrefix("abc123")).toBe("dev/tenants/abc123/exports/");
    for (const bad of ["prod", "Production", "staging", " production"]) {
      process.env.CDS_ENV = bad;
      expect(() => tenantExportPrefix("abc123"), bad).toThrow(/CDS_ENV/);
      expect(() => getObjectStore(), bad).toThrow(/CDS_ENV/);
      expect(() => describeObjectStore(), bad).toThrow(/CDS_ENV/);
    }
    process.env.WASABI_ACCESS_KEY_ID = "a";
    process.env.WASABI_SECRET_ACCESS_KEY = "b";
    process.env.WASABI_REGION = "us-east-1";
    process.env.CDS_ENV = "prod";
    expect(() => getObjectStore()).toThrow(/CDS_ENV/);
  });

  it("describes the local stand-in and its prefix", () => {
    process.env.CDS_STORAGE_DIR = join(tmpdir(), "cds-store-desc");
    expect(describeObjectStore()).toBe(
      `local disk ${join(tmpdir(), "cds-store-desc")}, prefix dev/`,
    );
  });
});

describe("getPublicMediaStore (07-09, CONT-33)", () => {
  function creds(): void {
    process.env.WASABI_ACCESS_KEY_ID = "a";
    process.env.WASABI_SECRET_ACCESS_KEY = "SECRETVALUE";
    process.env.WASABI_REGION = "us-east-1";
  }

  it("defaults to local disk at <repo>/.storage-public", () => {
    expect(describePublicMediaStore()).toMatch(
      /^public media: local disk .*\.storage-public, prefix dev\/$/,
    );
  });

  it("honours CDS_PUBLIC_STORAGE_DIR and refuses the private folder", () => {
    process.env.CDS_PUBLIC_STORAGE_DIR = join(tmpdir(), "cds-pub-desc");
    expect(describePublicMediaStore()).toBe(
      `public media: local disk ${join(tmpdir(), "cds-pub-desc")}, prefix dev/`,
    );
    process.env.CDS_STORAGE_DIR = join(tmpdir(), "cds-pub-desc");
    expect(() => getPublicMediaStore()).toThrow(/CDS_PUBLIC_STORAGE_DIR/);
    delete process.env.CDS_PUBLIC_STORAGE_DIR;
    delete process.env.CDS_STORAGE_DIR;
    process.env.CDS_STORAGE_DIR = join(
      process.cwd(),
      "x",
      "..",
      ".storage-public",
    );
    // only equality with the resolved private dir matters
    process.env.CDS_PUBLIC_STORAGE_DIR = join(process.cwd(), ".storage-public");
    expect(() => getPublicMediaStore()).toThrow(/CDS_PUBLIC_STORAGE_DIR/);
  });

  it("selects its own Wasabi bucket and never prints a secret", async () => {
    creds();
    process.env.CDS_ENV = "dev";
    process.env.WASABI_MEDIA_BUCKET = "cds-platform-media";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(null, { status: 404 });
      }),
    );
    const store = getPublicMediaStore();
    await store.stat(tenantPublicMediaKey("orga", "image", "abc", "w960"));
    expect(calls[0]).toContain("/cds-platform-media/");
    expect(describePublicMediaStore()).toBe(
      "public media: wasabi bucket cds-platform-media (us-east-1), prefix dev/",
    );
    expect(describePublicMediaStore()).not.toContain("SECRETVALUE");
  });

  it("throws on partial, same-bucket, no-CDS_ENV and production-without-bucket configs", () => {
    process.env.WASABI_MEDIA_BUCKET = "cds-platform-media";
    process.env.WASABI_ACCESS_KEY_ID = "a";
    process.env.CDS_ENV = "dev";
    expect(() => getPublicMediaStore()).toThrow(/WASABI_SECRET_ACCESS_KEY/);
    creds();
    delete process.env.CDS_ENV;
    expect(() => getPublicMediaStore()).toThrow(/CDS_ENV/);
    process.env.CDS_ENV = "dev";
    process.env.WASABI_MEDIA_BUCKET = "cds-platform";
    expect(() => getPublicMediaStore()).toThrow(/own bucket/);
    process.env.WASABI_BUCKET = "mine";
    process.env.WASABI_MEDIA_BUCKET = "mine";
    expect(() => getPublicMediaStore()).toThrow(/own bucket/);
    delete process.env.WASABI_MEDIA_BUCKET;
    process.env.CDS_ENV = "production";
    expect(() => getPublicMediaStore()).toThrow(/WASABI_MEDIA_BUCKET/);
    process.env.CDS_ENV = "prod";
    expect(() => getPublicMediaStore()).toThrow(/CDS_ENV/);
  });

  it("refuses private keys and non-media prefixes, round-trips a public key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cds-pub-"));
    try {
      process.env.CDS_PUBLIC_STORAGE_DIR = dir;
      const store = getPublicMediaStore();
      const priv = tenantExportKey("orga", AT);
      await expect(store.put(priv, "{}")).rejects.toThrow(InvalidInput);
      await expect(store.get(priv)).rejects.toThrow(InvalidInput);
      await expect(store.stat(priv)).rejects.toThrow(InvalidInput);
      await expect(store.readRange(priv, null)).rejects.toThrow(InvalidInput);
      await expect(store.delete(priv)).rejects.toThrow(InvalidInput);
      await expect(store.list("dev/tenants/orga/")).rejects.toThrow(
        InvalidInput,
      );
      expect(readdirSync(dir)).toEqual([]);
      const key = tenantPublicMediaKey("orga", "image", "abc", "w960");
      await store.put(key, new Uint8Array([1, 2, 3]), "image/webp");
      expect([...(await store.get(key))!]).toEqual([1, 2, 3]);
      expect((await store.stat(key))!.size).toBe(3);
      expect(
        (await store.list("dev/tenants/orga/media/")).map((o) => o.key),
      ).toEqual([key]);
      await store.delete(key);
      expect(await store.get(key)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("agreement keys and getAgreementStore (09-02, AGR-04, AGR-05)", () => {
  it("builds tenants/<org>/agreements/<sig>.<ext> with the env prefix", () => {
    expect(
      tenantAgreementKey("abcdefghijklmno", "sig123456789012", "html"),
    ).toBe("dev/tenants/abcdefghijklmno/agreements/sig123456789012.html");
    expect(
      tenantAgreementKey("abcdefghijklmno", "sig123456789012", "json"),
    ).toBe("dev/tenants/abcdefghijklmno/agreements/sig123456789012.json");
    expect(tenantAgreementPrefix("abcdefghijklmno")).toBe(
      "dev/tenants/abcdefghijklmno/agreements/",
    );
    process.env.CDS_ENV = "production";
    expect(tenantAgreementKey("abc", "sig", "html")).toBe(
      "tenants/abc/agreements/sig.html",
    );
  });

  it.each(["", "a/b", "..", "../x", "a.b"])("rejects id %j", (bad) => {
    expect(() => tenantAgreementKey(bad, "sig", "html")).toThrow(InvalidInput);
    expect(() => tenantAgreementKey("org", bad, "html")).toThrow(InvalidInput);
    expect(() => tenantAgreementPrefix(bad)).toThrow(InvalidInput);
  });

  it("rejects an extension outside html/json", () => {
    expect(() =>
      tenantAgreementKey("org", "sig", "pdf" as unknown as "html"),
    ).toThrow(InvalidInput);
  });

  it("local disk: writes once under the private store dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cds-agr-"));
    try {
      process.env.CDS_STORAGE_DIR = dir;
      const store = getAgreementStore();
      expect(store).toBeInstanceOf(LocalDiskStore);
      const key = tenantAgreementKey("org1", "sig1", "html");
      expect(await store.putIfAbsent(key, "<p>a</p>", "text/html")).toBe(
        "created",
      );
      expect(await store.putIfAbsent(key, "<p>b</p>", "text/html")).toBe(
        "exists",
      );
      expect(readdirSync(join(dir, "dev/tenants/org1/agreements"))).toEqual([
        "sig1.html",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function creds(): void {
    process.env.WASABI_ACCESS_KEY_ID = "a";
    process.env.WASABI_SECRET_ACCESS_KEY = "SECRETVALUE";
    process.env.WASABI_REGION = "us-east-1";
    process.env.CDS_ENV = "dev";
  }

  async function bucketOf(store: unknown): Promise<string> {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(null, { status: 200 });
      }),
    );
    await (store as S3Store).putIfAbsent("dev/x/y.json", "{}");
    return new URL(urls[0]!).pathname.split("/")[1]!;
  }

  it("Wasabi without WASABI_AGREEMENTS_BUCKET reuses the private bucket", async () => {
    creds();
    process.env.WASABI_BUCKET = "cds-private";
    const store = getAgreementStore();
    expect(store).toBeInstanceOf(S3Store);
    expect(await bucketOf(store)).toBe("cds-private");
  });

  it("refuses WASABI_AGREEMENTS_BUCKET equal to the private bucket", () => {
    creds();
    process.env.WASABI_BUCKET = "cds-private";
    process.env.WASABI_AGREEMENTS_BUCKET = "cds-private";
    expect(() => getAgreementStore()).toThrow(
      /WASABI_AGREEMENTS_BUCKET must be its own bucket/,
    );
    delete process.env.WASABI_BUCKET;
    process.env.WASABI_AGREEMENTS_BUCKET = "cds-platform";
    expect(() => getAgreementStore()).toThrow(
      /WASABI_AGREEMENTS_BUCKET must be its own bucket/,
    );
  });

  it("a distinct WASABI_AGREEMENTS_BUCKET gets its own bucket for writes", async () => {
    creds();
    process.env.WASABI_AGREEMENTS_BUCKET = "cds-agreements";
    const store = getAgreementStore();
    expect(await bucketOf(store)).toBe("cds-agreements");
  });

  it("production Wasabi without WASABI_AGREEMENTS_BUCKET throws (WR-A03)", () => {
    creds();
    process.env.CDS_ENV = "production";
    expect(() => getAgreementStore()).toThrow(
      /set WASABI_AGREEMENTS_BUCKET: production signed agreements/,
    );
    // The local-disk stand-in (no Wasabi at all) still works in production.
    delete process.env.WASABI_ACCESS_KEY_ID;
    delete process.env.WASABI_SECRET_ACCESS_KEY;
    delete process.env.WASABI_REGION;
    expect(getAgreementStore()).toBeInstanceOf(LocalDiskStore);
  });

  it("reads fall back to the private bucket for copies written before the bucket was set (WR-A03)", async () => {
    creds();
    process.env.WASABI_BUCKET = "cds-private";
    process.env.WASABI_AGREEMENTS_BUCKET = "cds-agreements";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = new URL(url);
        const bucket = u.pathname.split("/")[1]!;
        calls.push(`${init?.method ?? "GET"} ${bucket}`);
        if ((init?.method ?? "GET") === "GET" && bucket === "cds-private") {
          return new Response("legacy", { status: 200 });
        }
        if ((init?.method ?? "GET") === "GET") {
          return new Response(null, { status: 404 });
        }
        return new Response(null, { status: 204 });
      }),
    );
    const store = getAgreementStore();
    const bytes = await store.get("dev/tenants/o/agreements/s.html");
    expect(new TextDecoder().decode(bytes!)).toBe("legacy");
    expect(calls).toEqual(["GET cds-agreements", "GET cds-private"]);
    calls.length = 0;
    await store.delete("dev/tenants/o/agreements/s.html");
    expect(calls).toEqual(["DELETE cds-agreements", "DELETE cds-private"]);
  });

  it("WASABI_AGREEMENTS_BUCKET without credentials throws (partial config)", () => {
    process.env.CDS_ENV = "dev";
    process.env.WASABI_AGREEMENTS_BUCKET = "cds-agreements";
    expect(() => getAgreementStore()).toThrow(/partly configured/);
  });
});
