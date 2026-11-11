// 11-22: the installable hub (DASH-34, D63; T-11-22-02, T-11-22-03, T-11-22-05). The manifest
// is per session org (signed out → 404, private no-store, never a CDS mark); the service worker
// is served as JavaScript with Service-Worker-Allowed /hub/ and opens only /hub/ links; icons
// are session-scoped; savePushSubscriptionAction refuses malformed subscriptions before
// @cds/db and refuses impersonation.
import { createECDH, randomBytes } from "node:crypto";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  requireHubSession: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const db = vi.hoisted(() => ({
  readOwnSiteIcons: vi.fn(),
  readOwnSiteIconFile: vi.fn(),
  savePushSubscription: vi.fn(),
  removePushSubscription: vi.fn(),
  markSeen: vi.fn(),
  validatePushSubscription: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const real = await vi.importActual<typeof import("@cds/db")>("@cds/db");

const { GET: manifestGET } =
  await import("../app/(platform)/hub/manifest.webmanifest/route");
const { GET: swGET } = await import("../app/(platform)/hub/sw.js/route");
const { GET: iconGET } =
  await import("../app/(platform)/hub/icon/[file]/route");
const {
  savePushSubscriptionAction,
  removePushDeviceAction,
  dismissPhoneAlertsAction,
} = await import("../app/actions/push");
const { buildHubManifest, monogramSvg, shortNameOf, HUB_SERVICE_WORKER } =
  await import("../lib/hub-pwa");

const OWNER = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const IMPERSONATING = { ...OWNER, impersonator: "s1" };

function signIn(ctx: object = OWNER, name = "Rivera Family Bakery") {
  const session = {
    ctx,
    email: "a@b.co",
    org: { id: "org1", name, primaryHost: "rivera.example.com" },
    orgs: [],
    staleOrg: false,
  };
  sess.getHubSession.mockResolvedValue(session);
  sess.requireHubSession.mockResolvedValue(session);
}

function validSub() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
    uaFamily: "android",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sess.getHubSession.mockResolvedValue(null);
  sess.agreementBlocks.mockResolvedValue(false);
  db.readOwnSiteIcons.mockResolvedValue(null);
  db.readOwnSiteIconFile.mockResolvedValue(null);
  db.validatePushSubscription.mockImplementation(real.validatePushSubscription);
  db.savePushSubscription.mockResolvedValue({ id: "abcdefghijklmno" });
});

describe("/hub/manifest.webmanifest", () => {
  it("signed out → 404, no org data", async () => {
    const res = await manifestGET();
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("signed in → the org's manifest (scope /hub/, start /hub/today, no CDS)", async () => {
    signIn();
    const res = await manifestGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/manifest+json");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      name: "Rivera Family Bakery",
      short_name: "Rivera",
      start_url: "/hub/alerts",
      scope: "/hub/",
      display: "standalone",
      background_color: "#FFFFFF",
      theme_color: "#F2F2EF",
    });
    expect(body.short_name.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(body)).not.toMatch(/CDS|Connections Design/i);
    expect(body.icons.map((i: { src: string }) => i.src)).toEqual([
      "/hub/icon/monogram.svg",
      "/hub/icon/monogram.svg",
    ]);
  });

  it("uses the generated site icons when they exist (512 any + maskable)", async () => {
    signIn();
    db.readOwnSiteIcons.mockResolvedValue({
      v: "0123456789ab",
      source: "logo",
    });
    const body = await (await manifestGET()).json();
    expect(body.icons).toEqual([
      expect.objectContaining({
        src: "/hub/icon/icon-512.png?v=0123456789ab",
        sizes: "512x512",
        purpose: "any",
      }),
      expect.objectContaining({ purpose: "maskable", sizes: "512x512" }),
      expect.objectContaining({ src: "/hub/icon/icon-180.png?v=0123456789ab" }),
    ]);
  });

  it("an icon read failure still serves the manifest with the monogram", async () => {
    signIn();
    db.readOwnSiteIcons.mockRejectedValue(new Error("store down"));
    const res = await manifestGET();
    expect(res.status).toBe(200);
    expect((await res.json()).icons[0].src).toBe("/hub/icon/monogram.svg");
  });

  it("short names stay ≤ 12 characters", () => {
    expect(shortNameOf("Bloom")).toBe("Bloom");
    expect(shortNameOf("Supercalifragilistic Spa")).toBe("Supercalifra");
    expect(shortNameOf("   ")).toBe("Your site");
    expect(buildHubManifest({ name: "A B", iconVersion: null }).name).toBe(
      "A B",
    );
  });
});

describe("/hub/sw.js", () => {
  it("serves JavaScript with Service-Worker-Allowed /hub/ and no caching", async () => {
    const res = swGET();
    expect(res.headers.get("Content-Type")).toMatch(/^application\/javascript/);
    expect(res.headers.get("Service-Worker-Allowed")).toBe("/hub/");
    expect(res.headers.get("Cache-Control")).toBe(
      "no-cache, no-store, must-revalidate",
    );
    const body = await res.text();
    expect(body).toContain("notificationclick");
    expect(body).toContain('"/hub/"');
    expect(body).not.toContain('addEventListener("fetch"');
  });

  it("push shows the payload; a click opens only same-origin /hub/ links", async () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const shown: { title: string; options: Record<string, unknown> }[] = [];
    const opened: string[] = [];
    const waits: Promise<unknown>[] = [];
    const self = {
      location: { origin: "https://cds.example.com" },
      addEventListener: (t: string, fn: (e: unknown) => void) => {
        listeners[t] = fn;
      },
      skipWaiting: () => undefined,
      registration: {
        showNotification: (title: string, options: Record<string, unknown>) => {
          shown.push({ title, options });
          return Promise.resolve();
        },
      },
      clients: {
        claim: () => Promise.resolve(),
        matchAll: () => Promise.resolve([]),
        openWindow: (u: string) => {
          opened.push(u);
          return Promise.resolve(null);
        },
      },
    };
    runInNewContext(HUB_SERVICE_WORKER, { self, URL });
    const push = (data: unknown) =>
      listeners.push!({
        data: { json: () => data },
        waitUntil: (p: Promise<unknown>) => waits.push(p),
      });
    push({
      title: "Bakery",
      body: "New message",
      href: "/hub/inbox",
      tag: "form.message",
    });
    expect(shown[0]).toMatchObject({
      title: "Bakery",
      options: { body: "New message", tag: "form.message", renotify: false },
    });
    const click = (href: unknown) =>
      listeners.notificationclick!({
        notification: { close: () => undefined, data: { href } },
        waitUntil: (p: Promise<unknown>) => waits.push(p),
      });
    for (const href of [
      "/hub/inbox?tab=messages",
      "https://evil.example.com/hub/",
      "//evil.example.com/hub/x",
      "/hub//evil.example.com",
      "javascript:alert(1)",
      "/sign-in",
      "/hub/../api/jobs/alerts",
      "/hub/%2e%2e/sign-out",
      "/hub/..%2fapi",
    ]) {
      click(href);
    }
    await Promise.all(waits);
    expect(opened).toEqual([
      "https://cds.example.com/hub/inbox?tab=messages",
      "https://cds.example.com/hub/today",
      "https://cds.example.com/hub/today",
      "https://cds.example.com/hub/today",
      "https://cds.example.com/hub/today",
      "https://cds.example.com/hub/today",
      "https://cds.example.com/hub/today",
      "https://cds.example.com/hub/today",
      "https://cds.example.com/hub/today",
    ]);

    // WR-C01: an alert names its org; the tag is per site and the click goes through
    // /hub/switch, which opens the link in that site. A malformed org is ignored.
    push({
      title: "Bakery",
      org: "aaaaaaaaaaaaaaa",
      body: "New message",
      href: "/hub/inbox/m1",
      tag: "form.message",
    });
    expect(shown[1]!.options).toMatchObject({
      tag: "aaaaaaaaaaaaaaa:form.message",
      data: { href: "/hub/inbox/m1", org: "aaaaaaaaaaaaaaa" },
    });
    opened.length = 0;
    const clickWith = (data: unknown) =>
      listeners.notificationclick!({
        notification: { close: () => undefined, data },
        waitUntil: (p: Promise<unknown>) => waits.push(p),
      });
    clickWith(shown[1]!.options.data);
    clickWith({ href: "/hub/inbox", org: "../evil" });
    clickWith({ href: "/hub/../api", org: "aaaaaaaaaaaaaaa" });
    await Promise.all(waits);
    expect(opened).toEqual([
      "https://cds.example.com/hub/switch?org=aaaaaaaaaaaaaaa&next=%2Fhub%2Finbox%2Fm1",
      "https://cds.example.com/hub/inbox",
      "https://cds.example.com/hub/switch?org=aaaaaaaaaaaaaaa&next=%2Fhub%2Ftoday",
    ]);
  });
});

describe("/hub/icon/<file>", () => {
  const call = (file: string) =>
    iconGET(new Request("https://x/hub/icon/" + file), {
      params: Promise.resolve({ file }),
    });

  it("signed out or an unknown file → 404", async () => {
    expect((await call("monogram.svg")).status).toBe(404);
    signIn();
    expect((await call("share.png")).status).toBe(404);
    expect((await call("../x")).status).toBe(404);
  });

  it("monogram is the business initials, escaped, never a CDS mark", async () => {
    signIn(OWNER, "Rivera <Bakery>");
    const res = await call("monogram.svg");
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    const svg = await res.text();
    expect(svg).toContain(">RB<");
    expect(svg).not.toContain("<Bakery>");
    expect(svg).not.toMatch(/CDS/);
    expect(monogramSvg("&&&")).toContain(">S<");
  });

  it("a generated PNG is served; a missing one redirects to the monogram", async () => {
    signIn();
    db.readOwnSiteIconFile.mockResolvedValueOnce(new Uint8Array([137, 80]));
    const png = await call("icon-512.png");
    expect(png.headers.get("Content-Type")).toBe("image/png");
    expect(db.readOwnSiteIconFile).toHaveBeenCalledWith(OWNER, "icon-512.png");
    const missing = await call("icon-180.png");
    expect(missing.status).toBe(302);
    expect(missing.headers.get("Location")).toBe("/hub/icon/monogram.svg");
  });

  it("unversioned icon URLs revalidate; a ?v= URL may be cached (IN-E01)", async () => {
    signIn();
    expect((await call("monogram.svg")).headers.get("Cache-Control")).toBe(
      "private, no-cache",
    );
    db.readOwnSiteIconFile.mockResolvedValueOnce(new Uint8Array([137, 80]));
    expect((await call("icon-180.png")).headers.get("Cache-Control")).toBe(
      "private, no-cache",
    );
    db.readOwnSiteIconFile.mockResolvedValueOnce(new Uint8Array([137, 80]));
    const versioned = await iconGET(
      new Request("https://x/hub/icon/icon-512.png?v=0123456789ab"),
      { params: Promise.resolve({ file: "icon-512.png" }) },
    );
    expect(versioned.headers.get("Cache-Control")).toBe(
      "private, max-age=3600",
    );
  });
});

describe("push actions", () => {
  it("savePushSubscriptionAction validates the endpoint and key shapes before @cds/db", async () => {
    signIn();
    const ok = validSub();
    for (const bad of [
      null,
      "x",
      { ...ok, endpoint: "http://fcm.googleapis.com/x" },
      { ...ok, endpoint: "https://127.0.0.1/x" },
      { ...ok, keys: { ...ok.keys, p256dh: "short" } },
      { ...ok, keys: { ...ok.keys, auth: "!!" } },
    ]) {
      const r = await savePushSubscriptionAction(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
    expect(db.savePushSubscription).not.toHaveBeenCalled();
    const r = await savePushSubscriptionAction(ok);
    expect(r).toEqual({ ok: true, data: { id: "abcdefghijklmno" } });
    expect(db.savePushSubscription).toHaveBeenCalledWith(OWNER, {
      endpoint: ok.endpoint,
      keys: ok.keys,
      uaFamily: "android",
    });
  });

  it("refuses impersonation; dismiss is a no-op there", async () => {
    signIn(IMPERSONATING);
    const r = await savePushSubscriptionAction(validSub());
    expect(r.ok).toBe(false);
    expect(db.savePushSubscription).not.toHaveBeenCalled();
    expect(await dismissPhoneAlertsAction()).toEqual({
      ok: true,
      data: { dismissed: false },
    });
    expect(db.markSeen).not.toHaveBeenCalled();
  });

  it("dismiss saves the phone_alerts seen flag; device removal checks the id", async () => {
    signIn();
    await dismissPhoneAlertsAction();
    expect(db.markSeen).toHaveBeenCalledWith(OWNER, "phone_alerts");
    expect((await removePushDeviceAction("../x")).ok).toBe(false);
    expect(db.removePushSubscription).not.toHaveBeenCalled();
    expect(await removePushDeviceAction("abcdefghijklmno")).toEqual({
      ok: true,
      data: { removed: true },
    });
  });
});
