// 14-25 (ONB-10; D112, D173; P14-P20; RESEARCH Pitfall 2; T-14-25-01/02/03): a verified own
// sending domain changes the From of org mail, the owner chooses only the local part, and the
// system-set sending fields can never be written through the owner surface.
import { Forbidden, InvalidInput } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { captureTransport, sendEmail } from "../src/email";
import {
  getSendingView,
  saveBusinessProfile,
  setSendingLocalPart,
  SENDING_LOCAL_PART_AUDIT,
} from "../src/intake";
import { bootSeededPb, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
let pb: PocketBase;
const DOMAIN = "riverabakery.example";

function ctxAs(
  orgId: string,
  actor: string,
  role: OrgContext["role"],
  impersonator?: string,
): OrgContext {
  return mintOrgContext({
    orgId,
    actor,
    role,
    grants: [],
    ip: "127.0.0.1",
    ...(impersonator ? { impersonator } : {}),
  });
}

/** The system side (14-24's domains job) marks the org's own domain verified. */
async function markVerified(orgId: string, verified = true): Promise<string> {
  const existing = await pb
    .collection("business_profile")
    .getFirstListItem(pb.filter("organization = {:o}", { o: orgId }))
    .catch(() => null);
  const body = {
    sending_domain: DOMAIN,
    sending_status: verified ? "verified" : "pending",
    sending_domain_verified: verified,
  };
  if (existing) {
    await pb.collection("business_profile").update(existing.id, body);
    return existing.id;
  }
  const row = await pb
    .collection("business_profile")
    .create({ ...body, organization: orgId, hours: {} });
  return row.id;
}

async function sendConfirm(orgId: string, ctx: OrgContext) {
  const t = captureTransport();
  await sendEmail(
    { kind: "org", ctx, orgId },
    "email.confirm",
    "orders@customer.example",
    {
      orgName: "Org A",
      purposeLabel: "website inquiries",
      link: "http://localhost:3000/start/confirm-email?t=x",
    },
    { transport: t },
  );
  return t.sent[0]!;
}

beforeAll(async () => {
  booted = await bootSeededPb();
  if (booted) pb = await superuser();
});

afterAll(async () => {
  await booted?.inst.stop();
});

describe("own-domain sending identity (14-25)", () => {
  it("a verified profile sends From bookings@<domain> after the owner sets the local part; Reply-To unchanged", async (t) => {
    if (!booted) return t.skip();
    const { seed } = booted;
    const before = await sendConfirm(seed.A.org, seed.ctxA);
    expect(before.fromAddress).toBe("org-a@send.cds.needtobeedgy.com");

    await markVerified(seed.A.org);
    expect((await sendConfirm(seed.A.org, seed.ctxA)).fromAddress).toBe(
      `hello@${DOMAIN}`,
    );

    const view = await setSendingLocalPart(seed.ctxA, "  Bookings ");
    expect(view).toEqual({
      state: "verified",
      domain: DOMAIN,
      localPart: "bookings",
    });
    const m = await sendConfirm(seed.A.org, seed.ctxA);
    expect(m.fromAddress).toBe(`bookings@${DOMAIN}`);
    expect(m.fromName).toBe("Org A");
    expect(m.replyTo).toBe("owner-a@cds.test");

    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = {:a} && organization = {:o}", {
        a: SENDING_LOCAL_PART_AUDIT,
        o: seed.A.org,
      }),
    });
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("an owner patch with the system fields does not change them (silently dropped)", async (t) => {
    if (!booted) return t.skip();
    const { seed } = booted;
    const id = await markVerified(seed.B.org, false);
    await saveBusinessProfile(seed.ctxB, {
      tagline: "Fresh bread",
      sending_domain_verified: true,
      sending_domain: "evil.example",
      sending_status: "verified",
    });
    const row = await pb.collection("business_profile").getOne(id);
    expect(row.sending_domain_verified).toBe(false);
    expect(row.sending_domain).toBe(DOMAIN);
    expect(row.sending_status).toBe("pending");
    expect(row.tagline).toBe("Fresh bread");
    expect((await getSendingView(seed.ctxB)).state).toBe("pending");
    const m = await sendConfirm(seed.B.org, seed.ctxB);
    expect(m.fromAddress).toBe("org-b@send.cds.needtobeedgy.com");
  });

  it("saveBusinessProfile accepts a valid sending_local_part (Owner) and refuses an invalid one", async (t) => {
    if (!booted) return t.skip();
    const { seed } = booted;
    await saveBusinessProfile(seed.ctxB, { sending_local_part: "front.desk" });
    expect((await getSendingView(seed.ctxB)).localPart).toBe("front.desk");
    await expect(
      saveBusinessProfile(seed.ctxB, { sending_local_part: "a..b" }),
    ).rejects.toThrow(P14_COPY.SEND_LOCAL_INVALID);
  });

  it("refuses an invalid local part, and non-owners (Admin) cannot set it", async (t) => {
    if (!booted) return t.skip();
    const { seed } = booted;
    for (const bad of ["", "a..b", "-x", "x\r\nBcc: y@z", "x".repeat(65)]) {
      await expect(setSendingLocalPart(seed.ctxA, bad)).rejects.toThrow(
        InvalidInput,
      );
    }
    const admin = ctxAs(seed.A.org, seed.A.owner, "admin");
    await expect(setSendingLocalPart(admin, "sales")).rejects.toThrow(
      Forbidden,
    );
    await expect(
      saveBusinessProfile(admin, { sending_local_part: "sales" }),
    ).rejects.toThrow(Forbidden);
    // Admin still reads the state (business read).
    expect((await getSendingView(admin)).localPart).toBe("bookings");
  });

  it("an org with no own domain reads 'none'", async (t) => {
    if (!booted) return t.skip();
    const org = await pb.collection("organizations").create({
      name: "No Domain",
      slug: `nodomain-${Date.now().toString(36)}`,
      status: "active",
    });
    const ctx = ctxAs(org.id, booted.seed.A.owner, "owner");
    expect(await getSendingView(ctx)).toEqual({
      state: "none",
      domain: "",
      localPart: "hello",
    });
  });
});
