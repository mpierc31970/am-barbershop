// 11-22: Web Push (DASH-34, DASH-36). The confined web-push adapter maps push-service answers
// to ok / gone / error, getPushSender() picks it only when VAPID env is complete, devices are
// saved per person (never under impersonation), and a 404/410 deletes the subscription.
// `web-push` is mocked at the module boundary here only; nothing leaves the machine.
import { createECDH, randomBytes } from "node:crypto";
import { ImpersonationDenied, InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const sendNotification = vi.hoisted(() => vi.fn());
vi.mock("web-push", () => ({
  default: { sendNotification },
  sendNotification,
}));

import {
  createFakePushSender,
  getPushSender,
  isPushServiceEndpoint,
  pushTopic,
  setPushSenderForTests,
  validVapidSubject,
  vapidFromEnv,
  webPushSender,
  type PushPayload,
} from "../src/alerts/push";
import { raiseAlert } from "../src/alerts/raise";
import {
  listMyDevices,
  MAX_PUSH_DEVICES,
  removePushSubscription,
  savePushSubscription,
  validatePushSubscription,
} from "../src/alerts/subscriptions";
import { forgetPushDeviceForSession, signInMember } from "../src/auth";
import { resetClientForTests, superuser } from "../src/client";
import {
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
} from "../src/context";
import { captureTransport } from "../src/email/transport";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;

const tag = () => randomBytes(4).toString("hex");
const AT_1000 = "2026-10-12T15:00:00.000Z"; // 10:00 America/Chicago

const VAPID = {
  subject: "mailto:alerts@cds.test",
  publicKey: "BPublicKeyForTests",
  privateKey: "private-key-for-tests",
};

function keys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

function device(host = "fcm.googleapis.com") {
  return {
    endpoint: `https://${host}/fcm/send/${tag()}${tag()}`,
    keys: keys(),
    uaFamily: "android",
  };
}

function pushError(statusCode: number) {
  return Object.assign(new Error("push failed"), { statusCode });
}

const PAYLOAD: PushPayload = {
  title: "Bakery",
  org: "orgaaaaaaaaaaaa",
  body: "New message",
  href: "/hub/inbox",
  tag: "form.message",
  urgency: "normal",
};

type Org = {
  org: string;
  owner: string;
  admin: string;
  ctx: (user: string, extra?: { impersonator?: string }) => OrgContext;
};

const USER_PASSWORD = randomBytes(18).toString("hex");
const emailOf = new Map<string, string>();

async function newUser(): Promise<string> {
  const email = `push-${tag()}@cds.test`;
  const id = (
    await pb.collection("users").create({
      email,
      password: USER_PASSWORD,
      passwordConfirm: USER_PASSWORD,
    })
  ).id;
  emailOf.set(id, email);
  return id;
}

async function endpointRows(endpoint: string) {
  return pb.collection("push_subscriptions").getFullList({
    filter: pb.filter("endpoint = {:e}", { e: endpoint }),
  });
}

async function newOrg(): Promise<Org> {
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Push ${t}`,
      slug: `push-${t}`,
      status: "active",
      path: "standard",
    })
  ).id;
  await pb.collection("business_profile").create({
    organization: org,
    time_zone: "America/Chicago",
    business_type: "bakery",
  });
  const owner = await newUser();
  const admin = await newUser();
  await pb
    .collection("memberships")
    .create({ user: owner, organization: org, role: "owner" });
  await pb
    .collection("memberships")
    .create({ user: admin, organization: org, role: "admin" });
  return {
    org,
    owner,
    admin,
    ctx: (user, extra = {}) =>
      mintOrgContext({
        orgId: org,
        actor: user,
        role: user === owner ? "owner" : "admin",
        grants: [],
        ip: "127.0.0.1",
        ...extra,
      }),
  };
}

async function subsOf(org: string, user: string) {
  return pb.collection("push_subscriptions").getFullList({
    filter: pb.filter("organization = {:org} && user = {:u}", { org, u: user }),
  });
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(() => {
  sendNotification.mockReset();
});

afterEach(() => {
  setPushSenderForTests(null);
  vi.unstubAllEnvs();
});

describe("webPushSender (PUSH-01 adapter)", () => {
  it("sends the JSON payload with TTL, urgency, a ≤32-char topic and per-request VAPID", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const sender = webPushSender(VAPID);
    const out = await sender.send(
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/a",
        p256dh: "p",
        auth: "a",
      },
      { ...PAYLOAD, urgency: "high" },
    );
    expect(out).toBe("ok");
    const [sub, body, opts] = sendNotification.mock.calls[0]!;
    expect(sub).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/a",
      keys: { p256dh: "p", auth: "a" },
    });
    expect(JSON.parse(body as string)).toEqual({
      title: "Bakery",
      org: "orgaaaaaaaaaaaa",
      body: "New message",
      href: "/hub/inbox",
      tag: "form.message",
    });
    expect(opts).toMatchObject({
      TTL: 3600,
      urgency: "high",
      topic: pushTopic("orgaaaaaaaaaaaa:form.message"),
      vapidDetails: VAPID,
    });
    // WR-C01: the same alert type from another site has its own topic.
    await sender.send(
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/a",
        p256dh: "p",
        auth: "a",
      },
      { ...PAYLOAD, org: "orgbbbbbbbbbbbb" },
    );
    expect(sendNotification.mock.calls[1]![2].topic).not.toBe(
      (opts as { topic: string }).topic,
    );
    expect(pushTopic("x".repeat(500))).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });

  it("maps 404 and 410 to gone, anything else to error, never logging the endpoint", async () => {
    const sender = webPushSender(VAPID);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/secret-endpoint",
      p256dh: "p",
      auth: "a",
    };
    sendNotification.mockRejectedValueOnce(pushError(410));
    expect(await sender.send(sub, PAYLOAD)).toBe("gone");
    sendNotification.mockRejectedValueOnce(pushError(404));
    expect(await sender.send(sub, PAYLOAD)).toBe("gone");
    sendNotification.mockRejectedValueOnce(pushError(500));
    expect(await sender.send(sub, PAYLOAD)).toBe("error");
    sendNotification.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await sender.send(sub, PAYLOAD)).toBe("error");
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).not.toContain("secret-endpoint");
    log.mockRestore();
  });
});

describe("push service allowlist (WR-B04)", () => {
  it("accepts the browser push services only", () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
      "https://web.push.apple.com/abc",
    ]) {
      expect(isPushServiceEndpoint(ok), ok).toBe(true);
    }
    for (const bad of [
      "https://push.example.com/a",
      "https://127.0.0.1.nip.io/x",
      "https://evilpush.apple.com.example/x",
      "http://fcm.googleapis.com/x",
      "https://fcm.googleapis.com:444/x",
      "not a url",
    ]) {
      expect(isPushServiceEndpoint(bad), bad).toBe(false);
    }
  });

  it("the sender never POSTs to a stored non-push-service endpoint; it reads gone", async () => {
    const sender = webPushSender(VAPID);
    const out = await sender.send(
      { endpoint: "https://10.0.0.5.nip.io/x", p256dh: "p", auth: "a" },
      PAYLOAD,
    );
    expect(out).toBe("gone");
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("getPushSender env selection", () => {
  it("uses the fake without complete VAPID env and Web Push with it", async () => {
    vi.stubEnv("VAPID_SUBJECT", "");
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    await getPushSender().send(
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/x",
        p256dh: "p",
        auth: "a",
      },
      PAYLOAD,
    );
    expect(sendNotification).not.toHaveBeenCalled();

    vi.stubEnv("VAPID_SUBJECT", VAPID.subject);
    vi.stubEnv("VAPID_PUBLIC_KEY", VAPID.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", VAPID.privateKey);
    sendNotification.mockResolvedValue({ statusCode: 201 });
    expect(
      await getPushSender().send(
        {
          endpoint: "https://fcm.googleapis.com/fcm/send/x",
          p256dh: "p",
          auth: "a",
        },
        PAYLOAD,
      ),
    ).toBe("ok");
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("refuses a localhost or plain-http subject", () => {
    expect(validVapidSubject("mailto:ops@example.com")).toBe(true);
    expect(validVapidSubject("https://connectionsdesignstudios.com")).toBe(
      true,
    );
    expect(validVapidSubject("https://localhost")).toBe(false);
    expect(validVapidSubject("http://example.com")).toBe(false);
    expect(validVapidSubject("mailto:")).toBe(false);
    expect(
      vapidFromEnv({
        VAPID_SUBJECT: "https://localhost",
        VAPID_PUBLIC_KEY: "a",
        VAPID_PRIVATE_KEY: "b",
      }),
    ).toBeNull();
  });
});

describe("subscriptions (DASH-34)", () => {
  it("validates endpoint and key shapes", () => {
    const ok = device();
    expect(validatePushSubscription(ok).endpoint).toBe(ok.endpoint);
    for (const endpoint of [
      "http://fcm.googleapis.com/x",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "https://intranet/x",
      // WR-B04: not a push service (public names that resolve to internal addresses).
      "https://127.0.0.1.nip.io/x",
      "https://localtest.me/x",
      "https://push.example.com/x",
      "https://fcm.googleapis.com.evil.example/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://fcm.googleapis.com/" + "a".repeat(1100),
      "not a url",
    ]) {
      expect(
        () => validatePushSubscription({ ...ok, endpoint }),
        endpoint,
      ).toThrow(InvalidInput);
    }
    expect(() =>
      validatePushSubscription({
        ...ok,
        keys: { ...ok.keys, p256dh: randomBytes(65).toString("base64url") },
      }),
    ).toThrow(InvalidInput);
    expect(() =>
      validatePushSubscription({
        ...ok,
        keys: { ...ok.keys, auth: randomBytes(8).toString("base64url") },
      }),
    ).toThrow(InvalidInput);
  });

  it("upserts per person and endpoint; lists only the caller's devices", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const d = device();
    const first = await savePushSubscription(o.ctx(o.owner), d);
    const again = await savePushSubscription(o.ctx(o.owner), {
      ...d,
      keys: keys(),
    });
    expect(again.id).toBe(first.id);
    await savePushSubscription(o.ctx(o.admin), device());
    const mine = await listMyDevices(o.ctx(o.owner));
    expect(mine.map((x) => x.id)).toEqual([first.id]);
    expect(mine[0]).not.toHaveProperty("endpoint");
    expect(mine[0]!.uaFamily).toBe("android");
  });

  it("refuses saving under impersonation; impersonated list is empty", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    await savePushSubscription(o.ctx(o.owner), device());
    const staff = o.ctx(o.owner, { impersonator: o.admin });
    await expect(savePushSubscription(staff, device())).rejects.toThrow(
      ImpersonationDenied,
    );
    expect(await listMyDevices(staff)).toEqual([]);
  });

  it("removing another person's device is NotFound; own removal deletes", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const other = await newOrg();
    const { id } = await savePushSubscription(o.ctx(o.owner), device());
    await expect(removePushSubscription(o.ctx(o.admin), id)).rejects.toThrow(
      NotFound,
    );
    await expect(
      removePushSubscription(other.ctx(other.owner), id),
    ).rejects.toThrow(NotFound);
    expect(await subsOf(o.org, o.owner)).toHaveLength(1);
    await removePushSubscription(o.ctx(o.owner), id);
    expect(await subsOf(o.org, o.owner)).toHaveLength(0);
  });

  it(`keeps at most ${MAX_PUSH_DEVICES} devices per person (oldest dropped)`, async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const ids: string[] = [];
    for (let i = 0; i < MAX_PUSH_DEVICES + 1; i++) {
      ids.push((await savePushSubscription(o.ctx(o.owner), device())).id);
    }
    const left = (await subsOf(o.org, o.owner)).map((r) => r.id);
    expect(left).toHaveLength(MAX_PUSH_DEVICES);
    expect(left).not.toContain(ids[0]);
    expect(left).toContain(ids[MAX_PUSH_DEVICES]);
  });
});

describe("one device, one owner; sign-out forgets it (WR-A02, WR-E01)", () => {
  it("another person saving the same browser takes it over, in any org", async (t) => {
    if (!inst) return t.skip();
    const a = await newOrg();
    const b = await newOrg();
    const d = device();
    await savePushSubscription(a.ctx(a.owner), d);
    await savePushSubscription(b.ctx(b.owner), { ...d, keys: keys() });
    const rows = await endpointRows(d.endpoint);
    expect(rows.map((r) => r.user)).toEqual([b.owner]);
    // Same org, a colleague on the front-desk tablet.
    await savePushSubscription(b.ctx(b.admin), { ...d, keys: keys() });
    expect((await endpointRows(d.endpoint)).map((r) => r.user)).toEqual([
      b.admin,
    ]);
  });

  it("two people saving one browser at once leave one owner", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const d = device();
    await Promise.all([
      savePushSubscription(o.ctx(o.owner), d),
      savePushSubscription(o.ctx(o.admin), { ...d, keys: keys() }),
    ]);
    const owners = new Set((await endpointRows(d.endpoint)).map((r) => r.user));
    expect(owners.size).toBe(1);
  });

  it("the same person keeps the device in each of their orgs", async (t) => {
    if (!inst) return t.skip();
    const a = await newOrg();
    const b = await newOrg();
    await pb
      .collection("memberships")
      .create({ user: a.admin, organization: b.org, role: "admin" });
    const d = device();
    await savePushSubscription(a.ctx(a.admin), d);
    await savePushSubscription(b.ctx(a.admin), d);
    expect(await endpointRows(d.endpoint)).toHaveLength(2);
  });

  it("forgetPushDeviceForSession removes only the caller's rows for that endpoint, in every org", async (t) => {
    if (!inst) return t.skip();
    const a = await newOrg();
    const b = await newOrg();
    await pb
      .collection("memberships")
      .create({ user: a.owner, organization: b.org, role: "admin" });
    const d = device();
    const other = device();
    await savePushSubscription(a.ctx(a.owner), d);
    await savePushSubscription(b.ctx(a.owner), d);
    await savePushSubscription(a.ctx(a.owner), other);
    await savePushSubscription(a.ctx(a.admin), device());
    const { token } = await signInMember(
      emailOf.get(a.owner)!,
      USER_PASSWORD,
      "127.0.0.1",
    );
    expect(await forgetPushDeviceForSession(token, d.endpoint)).toBe(2);
    expect(await endpointRows(d.endpoint)).toHaveLength(0);
    expect(await endpointRows(other.endpoint)).toHaveLength(1);
    expect(await subsOf(a.org, a.admin)).toHaveLength(1);
    // A bad endpoint or a dead token removes nothing.
    await expect(
      forgetPushDeviceForSession(token, "http://127.0.0.1/x"),
    ).rejects.toThrow(InvalidInput);
    await expect(
      forgetPushDeviceForSession("not-a-token", other.endpoint),
    ).rejects.toThrow();
    expect(await endpointRows(other.endpoint)).toHaveLength(1);
  });
});

describe("delivery bookkeeping through raiseAlert (DASH-36)", () => {
  it("410 deletes the subscription, an error bumps fail_count, ok stamps last_ok_at", async (t) => {
    if (!inst) return t.skip();
    const o = await newOrg();
    const gone = device();
    const flaky = device();
    const fine = device();
    for (const d of [gone, flaky, fine]) {
      await savePushSubscription(o.ctx(o.owner), d);
    }
    sendNotification.mockImplementation((sub: { endpoint: string }) => {
      if (sub.endpoint === gone.endpoint) return Promise.reject(pushError(410));
      if (sub.endpoint === flaky.endpoint)
        return Promise.reject(pushError(500));
      return Promise.resolve({ statusCode: 201 });
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    setPushSenderForTests(webPushSender(VAPID));
    await raiseAlert(
      { orgId: o.org, as: mintSystemContext({ job: "test" }) },
      {
        type: "billing.card_failed",
        sourceKey: "billing:fix_card",
        title: "Your card was declined",
        safeTitle: "Your card was declined",
        href: "/hub/settings?tab=billing",
      },
      { now: new Date(AT_1000), transport: captureTransport() },
    );
    log.mockRestore();
    expect(sendNotification).toHaveBeenCalledTimes(3);
    const left = await subsOf(o.org, o.owner);
    const byEndpoint = new Map(left.map((r) => [r.endpoint, r]));
    expect(byEndpoint.has(gone.endpoint)).toBe(false);
    expect(byEndpoint.get(flaky.endpoint)!.fail_count).toBe(1);
    expect(byEndpoint.get(fine.endpoint)!.last_ok_at).not.toBe("");
    const alert = await pb
      .collection("alerts")
      .getFirstListItem(pb.filter("organization = {:org}", { org: o.org }));
    expect(alert.push_state).toBe("sent");
  });

  it("the fake recorder stays the default without keys", () => {
    const fake = createFakePushSender();
    setPushSenderForTests(fake);
    expect(getPushSender()).toBe(fake);
  });
});
