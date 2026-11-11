// The one email pipeline against a real PocketBase (EMAIL-01, ONB-10, D138, D267; T-06-26,
// T-06-27). type check -> suppression list -> sender identity -> render -> transport.
import { InvalidContext, InvalidInput } from "@cds/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { superuser } from "../src/client";
import { mintSystemContext, type SystemContext } from "../src/context";
import {
  addSuppression,
  canSend,
  captureTransport,
  emailSendFailures,
  EmailSendFailed,
  sendEmail,
  type EmailData,
} from "../src/email";
import { __clearOrgLiveCacheForTests } from "../src/org-stage";
import { bootSeededPb, staffContext, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
let system: SystemContext;

const EXP = new Date("2026-10-28T12:00:00.000Z");
const reminder: EmailData["quote.reminder"] = {
  day: 1,
  pathLabel: "Standard",
  expiresAt: EXP,
  link: "http://localhost:3000/start/q/abc",
  unsubscribeLink: "http://localhost:3000/start/unsubscribe?t=tok",
  unsubscribePostUrl: "http://localhost:3000/api/unsubscribe?t=tok",
};
const saved: EmailData["quote.saved"] = {
  pathLabel: "Standard",
  addonCount: 1,
  buildCents: 150000,
  monthlyCents: 3900,
  dueCents: 25000,
  expiresAt: EXP,
  link: "http://localhost:3000/start/q/abc",
};

async function rows(email: string): Promise<number> {
  const pb = await superuser();
  const list = await pb.collection("email_suppressions").getFullList({
    filter: pb.filter("email = {:e}", { e: email }),
  });
  return list.length;
}

describe("email pipeline (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
    system = mintSystemContext({ job: "email-test" });
  });

  afterAll(async () => {
    await booted?.inst.stop();
  });

  it("sends a CDS marketing email with RFC 8058 headers and the CDS identity", async (ctx) => {
    if (!booted) return ctx.skip();
    const t = captureTransport();
    const res = await sendEmail(
      { kind: "cds", ctx: system },
      "quote.reminder",
      "Visitor1@Example.com",
      reminder,
      { transport: t },
    );
    expect(res).toEqual({ status: "sent" });
    expect(t.sent).toHaveLength(1);
    const m = t.sent[0]!;
    expect(m.to).toBe("visitor1@example.com");
    expect(m.orgId).toBeNull();
    expect(m.fromName).toBe("A&M Barber Studio");
    expect(m.fromAddress).toBe("hello@send.cds.needtobeedgy.com");
    expect(m.headers["List-Unsubscribe"]).toBe(
      "<http://localhost:3000/api/unsubscribe?t=tok>",
    );
    expect(m.headers["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
  });

  it("a CDS marketing suppression blocks reminders but not transactional mail", async (ctx) => {
    if (!booted) return ctx.skip();
    const addr = "visitor2@example.com";
    await addSuppression(system, {
      organization: null,
      email: addr,
      reason: "unsubscribe",
      scope: "marketing",
      sourceType: "quote",
    });
    const t = captureTransport();
    const as = { kind: "cds", ctx: system } as const;
    expect(
      await sendEmail(as, "quote.reminder", addr, reminder, { transport: t }),
    ).toEqual({ status: "suppressed" });
    expect(t.sent).toHaveLength(0);
    expect(
      await sendEmail(as, "quote.saved", addr, saved, { transport: t }),
    ).toEqual({ status: "sent" });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.headers["List-Unsubscribe"]).toBeUndefined();
  });

  it("a scope all row blocks transactional mail too", async (ctx) => {
    if (!booted) return ctx.skip();
    const addr = "bounced@example.com";
    await addSuppression(system, {
      organization: null,
      email: addr,
      reason: "bounce",
      scope: "all",
      sourceType: "ses",
    });
    const t = captureTransport();
    expect(
      await sendEmail(
        { kind: "cds", ctx: system },
        "quote.saved",
        addr,
        saved,
        {
          transport: t,
        },
      ),
    ).toEqual({ status: "suppressed" });
    expect(t.sent).toHaveLength(0);
  });

  it("an org A suppression does not block org B or CDS", async (ctx) => {
    if (!booted) return ctx.skip();
    const { seed } = booted;
    const addr = "shared@example.com";
    await addSuppression(seed.ctxA, {
      organization: seed.A.org,
      email: addr,
      reason: "unsubscribe",
      scope: "all",
      sourceType: "newsletter",
    });
    const asA = { kind: "org", ctx: seed.ctxA, orgId: seed.A.org } as const;
    const asB = { kind: "org", ctx: seed.ctxB, orgId: seed.B.org } as const;
    expect(await canSend(asA, addr, "transactional")).toBe(false);
    expect(await canSend(asB, addr, "marketing")).toBe(true);
    expect(await canSend({ kind: "cds", ctx: system }, addr, "marketing")).toBe(
      true,
    );
  });

  it("an unregistered type throws before the transport", async (ctx) => {
    if (!booted) return ctx.skip();
    const t = captureTransport();
    await expect(
      sendEmail(
        { kind: "cds", ctx: system },
        "not.registered" as "quote.saved",
        "x@example.com",
        saved,
        { transport: t },
      ),
    ).rejects.toThrow(InvalidInput);
    expect(t.sent).toHaveLength(0);
  });

  it("a PocketBase-sent type is refused by the app pipeline", async (ctx) => {
    if (!booted) return ctx.skip();
    await expect(
      sendEmail(
        { kind: "cds", ctx: system },
        "auth.code" as "quote.saved",
        "x@example.com",
        saved,
        { transport: captureTransport() },
      ),
    ).rejects.toThrow(InvalidInput);
  });

  it("an OrgContext cannot write CDS or another org's suppression rows", async (ctx) => {
    if (!booted) return ctx.skip();
    const { seed } = booted;
    const base = {
      email: "x@example.com",
      reason: "unsubscribe",
      scope: "marketing",
      sourceType: "t",
    } as const;
    await expect(
      addSuppression(seed.ctxA, { ...base, organization: null }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      addSuppression(seed.ctxA, { ...base, organization: seed.B.org }),
    ).rejects.toThrow(InvalidInput);
    expect(await rows("x@example.com")).toBe(0);
  });

  it("an org send cannot use a CDS identity or another org's id", async (ctx) => {
    if (!booted) return ctx.skip();
    const { seed } = booted;
    await expect(
      canSend(
        { kind: "cds", ctx: seed.ctxA as unknown as SystemContext },
        "x@example.com",
        "marketing",
      ),
    ).rejects.toThrow(InvalidContext);
    await expect(
      canSend(
        { kind: "org", ctx: seed.ctxA, orgId: seed.B.org },
        "x@example.com",
        "marketing",
      ),
    ).rejects.toThrow(InvalidInput);
  });

  it("addSuppression is idempotent", async (ctx) => {
    if (!booted) return ctx.skip();
    const staff = await staffContext(
      booted.inst,
      "email-staff@cds.test",
      "support_agent",
    );
    const input = {
      organization: null,
      email: "Twice@Example.com",
      reason: "staff",
      scope: "all",
      sourceType: "staff",
    } as const;
    await addSuppression(staff, input);
    await addSuppression(staff, input);
    expect(await rows("twice@example.com")).toBe(1);
  });

  it("an org send goes out as the org, with its confirmed default route as Reply-To", async (ctx) => {
    if (!booted) return ctx.skip();
    const { seed } = booted;
    const t = captureTransport();
    const res = await sendEmail(
      { kind: "org", ctx: seed.ctxA, orgId: seed.A.org },
      "email.confirm",
      "orders@riverabakery.com",
      {
        orgName: "Org A",
        purposeLabel: "website inquiries",
        link: "http://localhost:3000/start/confirm-email?t=x",
      },
      { transport: t },
    );
    expect(res).toEqual({ status: "sent" });
    const m = t.sent[0]!;
    expect(m.orgId).toBe(seed.A.org);
    expect(m.fromName).toBe("Org A");
    expect(m.fromAddress).toBe("org-a@send.cds.needtobeedgy.com");
    expect(m.replyTo).toBe("owner-a@cds.test");
    expect(m.subject).toBe("Confirm your email for Org A");
  });

  // DASH-32, Pitfall 9: marketing mail sent as an org waits for launch; nothing else does.
  describe("pre-launch hold (11-10)", () => {
    async function orgAt(stage: string): Promise<string> {
      const pb = await superuser();
      return (
        await pb.collection("organizations").create({
          name: "Rivera Bakery",
          slug: `hold-${Math.random().toString(36).slice(2, 10)}`,
          status: "active",
          path: "standard",
          stage,
        })
      ).id;
    }

    it("org marketing mail before launch is held and never reaches the outbox", async (ctx) => {
      if (!booted) return ctx.skip();
      __clearOrgLiveCacheForTests();
      const org = await orgAt("being_built");
      const t = captureTransport();
      const res = await sendEmail(
        { kind: "org", ctx: system, orgId: org },
        "quote.reminder",
        "customer1@example.com",
        reminder,
        { transport: t },
      );
      expect(res).toEqual({ status: "held" });
      expect(t.sent).toHaveLength(0);
    });

    it("the same send after the org is live goes out", async (ctx) => {
      if (!booted) return ctx.skip();
      __clearOrgLiveCacheForTests();
      const org = await orgAt("being_built");
      const as = { kind: "org", ctx: system, orgId: org } as const;
      const t = captureTransport();
      expect(
        await sendEmail(as, "quote.reminder", "c2@example.com", reminder, {
          transport: t,
        }),
      ).toEqual({ status: "held" });
      const pb = await superuser();
      await pb.collection("organizations").update(org, { stage: "live" });
      __clearOrgLiveCacheForTests();
      expect(
        await sendEmail(as, "quote.reminder", "c2@example.com", reminder, {
          transport: t,
        }),
      ).toEqual({ status: "sent" });
      expect(t.sent).toHaveLength(1);
      expect(t.sent[0]!.orgId).toBe(org);
    });

    it("CDS marketing mail is never held", async (ctx) => {
      if (!booted) return ctx.skip();
      const t = captureTransport();
      expect(
        await sendEmail(
          { kind: "cds", ctx: system },
          "quote.reminder",
          "c3@example.com",
          reminder,
          { transport: t },
        ),
      ).toEqual({ status: "sent" });
      expect(t.sent).toHaveLength(1);
    });

    it("transactional mail as an org sends before launch", async (ctx) => {
      if (!booted) return ctx.skip();
      __clearOrgLiveCacheForTests();
      const org = await orgAt("being_built");
      const t = captureTransport();
      expect(
        await sendEmail(
          { kind: "org", ctx: system, orgId: org },
          "data_export.ready",
          "owner@example.com",
          {
            business: "Rivera Bakery",
            href: "http://localhost:3000/hub/settings/data",
            expiresOn: "16 Oct",
          },
          { transport: t },
        ),
      ).toEqual({ status: "sent" });
      expect(t.sent).toHaveLength(1);
    });
  });

  it("a failing transport raises EmailSendFailed and counts it", async (ctx) => {
    if (!booted) return ctx.skip();
    const before = emailSendFailures();
    await expect(
      sendEmail(
        { kind: "cds", ctx: system },
        "quote.saved",
        "fail@example.com",
        saved,
        {
          transport: {
            send: () => Promise.reject(new Error("smtp down")),
          },
        },
      ),
    ).rejects.toThrow(EmailSendFailed);
    expect(emailSendFailures()).toBe(before + 1);
  });
});
