// 13-37 Task 1: POST /staff/api/catalog/upload (choice 1; P13-P21; T-13-37-01, T-13-37-02) and
// the /_catalog/<slug>/<file> screenshot routes (13-20 carry). @cds/db and the staff session
// are mocked; the real same-origin check, capped body reader and matrix run.
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({
  getStaffSession: vi.fn(),
  staffCan: vi.fn(),
}));
const db = vi.hoisted(() => ({
  CATALOG_SCREENSHOT_MAX_BYTES: 2 * 1024 * 1024,
  staffAddScreenshot: vi.fn(),
  readCatalogScreenshot: vi.fn(),
  publicCatalogView: vi.fn(),
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock("@cds/addon-registry/server", () => ({
  ADDON_REGISTRY: {
    list: () => [
      {
        slug: "builder-pro",
        name: "Builder Pro",
        summary: "More blocks.",
        visibility: "public",
        paths: ["standard"],
      },
    ],
    get: () => undefined,
  },
}));

const route = await import("../app/(platform)/staff/api/catalog/upload/route");
const platformMedia =
  await import("../app/(platform)/%5Fcatalog/[slug]/[file]/route");
const tenantMedia =
  await import("../app/tenant/[host]/%5Fcatalog/[slug]/[file]/route");

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
]);

function session(role: "super_admin" | "support_agent") {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh: false,
    name: "Lee Admin",
    role,
    maskedEmail: "l•••@example.test",
  };
}

function upload(
  opts: {
    origin?: string;
    bytes?: Uint8Array<ArrayBuffer>;
    slug?: string;
    alt?: string;
  } = {},
): Request {
  const form = new FormData();
  form.set("slug", opts.slug ?? "builder-pro");
  form.set("alt", opts.alt ?? "The block picker");
  form.set(
    "file",
    new File([opts.bytes ?? PNG], "secret-name.png", { type: "image/png" }),
  );
  return new Request("http://console.test/staff/api/catalog/upload", {
    method: "POST",
    headers: {
      host: "console.test",
      ...(opts.origin ? { origin: opts.origin } : {}),
    },
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sess.getStaffSession.mockResolvedValue(session("support_agent"));
  sess.staffCan.mockImplementation((role: string, feature: string) => {
    try {
      authorizeStaff(role as "super_admin", feature);
      return true;
    } catch {
      return false;
    }
  });
  db.staffAddScreenshot.mockResolvedValue({
    id: "shot00000000001",
    url: "/_catalog/builder-pro/shot00000000001.png",
    alt: "The block picker",
    w: 1,
    h: 1,
  });
});

describe("POST /staff/api/catalog/upload", () => {
  it("cross-origin → 403, the session is never read", async () => {
    const res = await route.POST(upload({ origin: "https://evil.test" }));
    expect(res.status).toBe(403);
    expect(sess.getStaffSession).not.toHaveBeenCalled();
    expect(db.staffAddScreenshot).not.toHaveBeenCalled();
  });

  it("no staff session → 401 SESSION-ENDED", async () => {
    sess.getStaffSession.mockResolvedValue(null);
    const res = await route.POST(upload({ origin: "http://console.test" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: P13_COPY.SESSION_ENDED });
  });

  it("a 3 MB body → 413 before the db is called", async () => {
    const res = await route.POST(
      upload({ bytes: new Uint8Array(3 * 1024 * 1024) }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: "Screenshots must be 2 MB or smaller.",
    });
    expect(db.staffAddScreenshot).not.toHaveBeenCalled();
  });

  it("a valid png → 200 with the screenshot entry; manifests from the registry", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await route.POST(upload({ origin: "http://console.test" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      screenshot: {
        id: "shot00000000001",
        url: "/_catalog/builder-pro/shot00000000001.png",
        alt: "The block picker",
        w: 1,
        h: 1,
      },
    });
    const [ctx, input, manifests] = db.staffAddScreenshot.mock.calls[0]!;
    expect(ctx).toMatchObject({ kind: "platform" });
    expect(input.slug).toBe("builder-pro");
    expect(input.alt).toBe("The block picker");
    expect(input.contentType).toBe("image/png");
    expect(Array.from(input.bytes as Uint8Array)).toEqual(Array.from(PNG));
    expect(manifests[0]).toMatchObject({
      slug: "builder-pro",
      path: "standard",
    });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("db refusals answer their copy; unknown errors log the class name only", async () => {
    db.staffAddScreenshot.mockRejectedValueOnce(
      new InvalidInput("An add-on has at most 6 screenshots."),
    );
    let res = await route.POST(upload());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "An add-on has at most 6 screenshots.",
    });

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.staffAddScreenshot.mockRejectedValueOnce(
      new TypeError("secret-name.png"),
    );
    res = await route.POST(upload());
    expect(res.status).toBe(500);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-name");
    expect(log.mock.calls[0]).toEqual([
      "[staff] catalog upload failed",
      "TypeError",
    ]);
    log.mockRestore();
  });

  it("a role without catalog_listings → 403", async () => {
    sess.getStaffSession.mockResolvedValue({
      ...session("support_agent"),
      role: "",
    });
    const res = await route.POST(upload());
    expect(res.status).toBe(403);
    expect(db.staffAddScreenshot).not.toHaveBeenCalled();
  });
});

describe("GET /_catalog/<slug>/<file>", () => {
  const params = (slug: string, file: string) => ({
    params: Promise.resolve({ slug, file }),
  });

  const listing = (ids: string[]) => [
    {
      slug: "builder-pro",
      sort: 1,
      pickable: true,
      screenshots: ids.map((id) => ({
        id,
        url: `/_catalog/builder-pro/${id}.png`,
        alt: "",
      })),
    },
  ];

  it("a publicly listed screenshot: nosniff and a day of cache, never immutable, on platform and tenant hosts (WR-D10)", async () => {
    sess.getStaffSession.mockResolvedValue(null);
    db.publicCatalogView.mockResolvedValue(listing(["shot00000000001"]));
    db.readCatalogScreenshot.mockResolvedValue({
      bytes: PNG,
      contentType: "image/png",
    });
    for (const res of [
      await platformMedia.GET(
        new Request("http://x/"),
        params("builder-pro", "shot00000000001.png"),
      ),
      await tenantMedia.GET(new Request("http://x/"), {
        params: Promise.resolve({
          host: "rivera.test",
          slug: "builder-pro",
          file: "shot00000000001.png",
        }),
      }),
    ]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    }
  });

  it("a screenshot in no public listing (hidden, private, removed) is a 404 for the public, never read", async () => {
    sess.getStaffSession.mockResolvedValue(null);
    db.publicCatalogView.mockResolvedValue(listing([]));
    const res = await platformMedia.GET(
      new Request("http://x/"),
      params("builder-pro", "shot00000000001.png"),
    );
    expect(res.status).toBe(404);
    expect(db.readCatalogScreenshot).not.toHaveBeenCalled();
  });

  it("staff still see an unlisted screenshot (editor preview), never cached", async () => {
    db.publicCatalogView.mockResolvedValue(listing([]));
    db.readCatalogScreenshot.mockResolvedValue({
      bytes: PNG,
      contentType: "image/png",
    });
    const res = await platformMedia.GET(
      new Request("http://x/"),
      params("builder-pro", "shot00000000001.png"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("a bad name or a missing object is a bare 404", async () => {
    db.readCatalogScreenshot.mockRejectedValueOnce(new NotFound("nope"));
    let res = await platformMedia.GET(
      new Request("http://x/"),
      params("builder-pro", "../../etc"),
    );
    expect(res.status).toBe(404);
    db.readCatalogScreenshot.mockResolvedValueOnce(null);
    res = await platformMedia.HEAD(
      new Request("http://x/"),
      params("builder-pro", "shot00000000001.png"),
    );
    expect(res.status).toBe(404);
  });
});
