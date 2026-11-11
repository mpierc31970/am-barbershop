// 15-03 (HUB-07, HUB-03; P15-P14, A3-Q2): hub_inquiries is a platform collection (every API rule
// null, no org field, no tenant repository, not in the tenant export registry), createHubInquiry
// stores no IP (WR-B06), takes the contact slot and the Turnstile check itself (WR-B07; the check
// is stubbed here, no network), and sends one staff-only `hub.inquiry` copy with the visitor as
// Reply-To, listHubInquiries is staff-only and omits the message, and pruneHubInquiries keeps
// 730 days. PocketBase stamps `created` itself, so prune runs on a clock moved forward.
import "@cds/addon-registry/server";
import { InvalidInput } from "@cds/core";
import type PocketBase from "pocketbase";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintPlatformContext, type PlatformContext } from "../src/context";
import { resetContactLimitsForTests } from "../src/rate-limit";
import { captureTransport } from "../src/email/transport";
import {
  createHubInquiry,
  HUB_INQUIRY_RETENTION_DAYS,
  listHubInquiries,
  pruneHubInquiries,
} from "../src/hub-inquiries";
import { allTenantCollections } from "../src/registry";
import { tenantRepo } from "../src/repository";
import { bootPb, type PbInstance } from "./pb-harness";

const RULES = [
  "listRule",
  "viewRule",
  "createRule",
  "updateRule",
  "deleteRule",
] as const;
const DAY_MS = 86_400_000;
const STAFF = "staff-alerts@example.com";

// WR-B07: createHubInquiry runs the Turnstile check itself; never call Cloudflare from a test.
vi.mock("../src/human-check", async (orig) => ({
  ...(await orig<typeof import("../src/human-check")>()),
  getHumanCheck: () => ({ verify: async () => true }),
}));

let inst: PbInstance | null = null;
let pb: PocketBase;

const input = (over: Record<string, unknown> = {}) => ({
  name: "Dana Rivera",
  email: "Dana@Example.com",
  business: "Rivera Bakery",
  topic: "call" as const,
  phone: "555 0100",
  about: "Studio",
  message: "Hello <b>CDS</b>.\nCan we talk on Tuesday?",
  ip: "2001:db8:1:2:3:4:5:6",
  humanToken: "XXXX.DUMMY.TOKEN.XXXX",
  ...over,
});

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(async () => {
  vi.stubEnv("CDS_STAFF_ALERT_EMAIL", STAFF);
  resetContactLimitsForTests();
  if (!inst) return;
  for (const r of await pb.collection("hub_inquiries").getFullList()) {
    await pb.collection("hub_inquiries").delete(r.id);
  }
});

describe("hub_inquiries (15-03)", () => {
  it("is a platform collection: rules null, no org field, no tenant repo, never exported", async (ctx) => {
    if (!inst) return ctx.skip();
    const c = await pb.collections.getOne("hub_inquiries");
    for (const rule of RULES) expect(c[rule], rule).toBeNull();
    const fields = c.fields.map((f) => f.name);
    expect(fields).not.toContain("organization");
    expect(fields).not.toContain("org_id");
    // WR-B06 (migration 1790000901): no IP-derived field.
    expect(fields).not.toContain("ip_bucket");
    expect(() => tenantRepo("hub_inquiries")).toThrow(InvalidInput);
    // Choice 7: exempt from the export field lists (no-org platform collection).
    expect(Object.hasOwn(allTenantCollections(), "hub_inquiries")).toBe(false);
  });

  it("stores no IP (WR-B06) and sends one staff copy with the visitor as Reply-To", async (ctx) => {
    if (!inst) return ctx.skip();
    const transport = captureTransport();
    const { id, staffNotified } = await createHubInquiry(input(), {
      transport,
    });
    expect(staffNotified).toBe(true);
    const row = await pb.collection("hub_inquiries").getOne(id);
    expect(row.email).toBe("dana@example.com");
    expect(row.topic).toBe("call");
    expect(row).not.toHaveProperty("ip_bucket");
    expect(JSON.stringify(row)).not.toContain("2001");

    const second = await createHubInquiry(
      input({ ip: "2001:db8:1:2:ffff:ffff:ffff:ffff" }),
      { transport },
    );
    const row2 = await pb.collection("hub_inquiries").getOne(second.id);
    expect(JSON.stringify(row2)).not.toContain("2001");

    expect(transport.sent).toHaveLength(2);
    const m = transport.sent[0]!;
    expect(m.type).toBe("hub.inquiry");
    expect(m.to).toBe(STAFF);
    expect(m.replyTo).toBe("dana@example.com");
    expect(m.subject).toContain("Dana Rivera");
    expect(m.html).not.toContain("<b>CDS</b>");
    expect(m.html).toContain("&lt;b&gt;CDS&lt;/b&gt;");
    expect(m.text).toContain("Can we talk on Tuesday?");
  });

  it("validates on the server", async (ctx) => {
    if (!inst) return ctx.skip();
    const transport = captureTransport();
    await expect(
      createHubInquiry(input({ topic: "spam" }), { transport }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      createHubInquiry(input({ message: "x".repeat(2001) }), { transport }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      createHubInquiry(input({ email: "not-an-email" }), { transport }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      createHubInquiry(input({ name: "a\nBcc: x@y.z" }), { transport }),
    ).rejects.toThrow(InvalidInput);
    expect(transport.sent).toHaveLength(0);
    expect(await pb.collection("hub_inquiries").getFullList()).toHaveLength(0);
  });

  it("lists for staff only, newest first, without the message or bucket", async (ctx) => {
    if (!inst) return ctx.skip();
    const transport = captureTransport();
    await createHubInquiry(input({ name: "First" }), { transport });
    await createHubInquiry(input({ name: "Second", topic: "press" }), {
      transport,
    });
    const staff = mintPlatformContext({
      actor: "staffuser00001",
      staffRole: "support_agent",
      ip: "10.0.0.1",
    });
    const rows = await listHubInquiries(staff);
    expect(rows.map((r) => r.name)).toEqual(["Second", "First"]);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ["about", "business", "created", "email", "id", "name", "topic"].sort(),
    );
    expect(
      await listHubInquiries(staff, { since: new Date(Date.now() + DAY_MS) }),
    ).toEqual([]);

    const notStaff = mintPlatformContext({
      actor: "user00000000001",
      staffRole: "viewer" as PlatformContext["staffRole"],
      ip: "10.0.0.1",
    });
    await expect(listHubInquiries(notStaff)).rejects.toThrow();
  });

  it("prunes past 730 days; a dry run deletes nothing", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(HUB_INQUIRY_RETENTION_DAYS).toBe(730);
    const { id } = await createHubInquiry(input(), {
      transport: captureTransport(),
    });
    const created = new Date(
      String((await pb.collection("hub_inquiries").getOne(id)).created).replace(
        " ",
        "T",
      ),
    );
    const at = (days: number) => new Date(created.getTime() + days * DAY_MS);

    expect(await pruneHubInquiries(at(729), { dryRun: false })).toEqual({
      deleted: 0,
    });
    expect(await pruneHubInquiries(at(731), { dryRun: true })).toEqual({
      deleted: 1,
    });
    expect(await pb.collection("hub_inquiries").getFullList()).toHaveLength(1);
    expect(await pruneHubInquiries(at(731), { dryRun: false })).toEqual({
      deleted: 1,
    });
    expect(await pb.collection("hub_inquiries").getFullList()).toHaveLength(0);
  });
});
