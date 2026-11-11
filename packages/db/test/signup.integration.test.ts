// Submit and member code sign-in against a real PocketBase (ONB-08, ONB-12, ONB-01; D213,
// D215, D286; RESEARCH Pattern 2; T-06-34..T-06-38). Codes are read from the OTP stand-in's
// stdout line; nothing is ever mailed.
import { InvalidInput, RateLimited } from "@cds/core";
import { AUP_TEST_TERMS } from "@cds/core/onboarding";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgContextFromToken } from "../src/auth";
import { superuser } from "../src/client";
import { mintSystemContext } from "../src/context";
import { addSuppression } from "../src/email";
import { alwaysFail } from "../src/human-check";
import { ERR_HUMAN } from "../src/quotes";
import { getOrgStage } from "../src/org-stage";
import {
  resetSignInLimitsForTests,
  resetSubmitLimitsForTests,
  SIGN_IN_PER_OTP,
  SUBMIT_PER_EMAIL,
} from "../src/rate-limit";
import {
  completeMemberCode,
  completeSubmit,
  ERR_CREATE,
  priorBlockedReason,
  requestMemberCode,
  startSubmit,
  SubmitCodeInvalid,
  SUBMIT_SUPPRESSED_COPY,
} from "../src/signup";
import {
  bootSeededPb,
  otpCodeFor,
  seedQuote,
  storedQuote,
  submitWithCode,
  testRegistry,
  type SeededPb,
  PASS_HUMAN,
} from "./seeded";

let booted: SeededPb | null = null;
const registry = testRegistry();
const IP = "198.51.100.44";
const SELECTIONS = {
  addons: ["fixture-quote"],
  extras: [],
  carePlan: false,
  cadence: "monthly",
};
let n = 0;

function nextEmail(): string {
  n += 1;
  return `visitor-${n}@cds.test`;
}

async function usersByEmail(email: string) {
  const pb = await superuser();
  return pb.collection("users").getFullList({
    filter: pb.filter("email = {:e}", { e: email }),
  });
}

async function orgCount(): Promise<number> {
  const pb = await superuser();
  return (await pb.collection("organizations").getList(1, 1)).totalItems;
}

async function byOrg(collection: string, orgId: string) {
  const pb = await superuser();
  return pb.collection(collection).getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
  });
}

async function rejects(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

function wrong(code: string): string {
  return code === "000000" ? "111111" : "000000";
}

describe("submit + member code (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
  });
  afterAll(async () => {
    await booted?.inst.stop();
  });
  beforeEach(() => {
    resetSubmitLimitsForTests();
    resetSignInLimitsForTests();
  });

  // ------------------------------------------------------------ step A

  it("step A for a new email: one pending user, a logged code, the quote filled in", async (t) => {
    if (!booted) return t.skip();
    const email = nextEmail();
    const q = await seedQuote({ selections: SELECTIONS });
    const r = await startSubmit(
      {
        quoteToken: q.token,
        businessName: "Rivera Bakery",
        description: "Fresh bread every morning.",
        email,
        ip: IP,
      },
      PASS_HUMAN,
    );
    expect(Object.keys(r).sort()).toEqual(["email", "otpId"]);
    expect(r.email).toBe(email);
    const users = await usersByEmail(email);
    expect(users).toHaveLength(1);
    expect(users[0]!.verified).toBe(false);
    expect(users[0]!.pending_signup).toBe(true);
    expect(await otpCodeFor(booted.inst, r.otpId)).toMatch(/^\d{6}$/);
    const row = await storedQuote(q.id);
    expect(row.business_name).toBe("Rivera Bakery");
    expect(row.description).toBe("Fresh bread every morning.");
    expect(row.email).toBe(email);
  });

  it("step A for an existing account creates no user and answers the same shape", async (t) => {
    if (!booted) return t.skip();
    const email = "owner-a@cds.test";
    const before = await usersByEmail(email);
    const q = await seedQuote();
    const r = await startSubmit(
      {
        quoteToken: q.token,
        businessName: "Other Shop",
        description: "Something else.",
        email,
        ip: IP,
      },
      PASS_HUMAN,
    );
    expect(Object.keys(r).sort()).toEqual(["email", "otpId"]);
    expect(await usersByEmail(email)).toHaveLength(before.length);
  });

  it("step A validates the name, the sentence and the email", async (t) => {
    if (!booted) return t.skip();
    const q = await seedQuote();
    const base = {
      quoteToken: q.token,
      businessName: "Rivera Bakery",
      description: "Bread.",
      email: nextEmail(),
      ip: IP,
    };
    for (const bad of [
      { businessName: "  " },
      { businessName: "x".repeat(121) },
      { description: "" },
      { description: "x".repeat(201) },
      { email: "not-an-email" },
      // A-WR-10: terminal escapes never reach the staff CLIs.
      { businessName: "Evil\u001b[2K" },
      { description: "Bread.\u001b]0;x\u0007" },
    ]) {
      expect(
        await rejects(
          startSubmit({ ...base, email: nextEmail(), ...bad }, PASS_HUMAN),
        ),
      ).toBeInstanceOf(InvalidInput);
    }
  });

  it("step A refuses an unknown or expired quote with the ERR-CREATE copy", async (t) => {
    if (!booted) return t.skip();
    const expired = await seedQuote({ expiresAt: new Date(Date.now() - 1000) });
    for (const token of [expired.token, "x".repeat(43), "junk"]) {
      const err = await rejects(
        startSubmit(
          {
            quoteToken: token,
            businessName: "A",
            description: "B",
            email: nextEmail(),
            ip: IP,
          },
          PASS_HUMAN,
        ),
      );
      expect(err).toBeInstanceOf(InvalidInput);
      expect((err as Error).message).toBe(ERR_CREATE);
    }
  });

  it("step A allows SUBMIT_PER_EMAIL requests per email, then RateLimited", async (t) => {
    if (!booted) return t.skip();
    const email = nextEmail();
    for (let i = 0; i < SUBMIT_PER_EMAIL; i++) {
      // An unknown quote still counts: the bucket is taken before the lookup.
      await rejects(
        startSubmit(
          {
            quoteToken: "junk",
            businessName: "A",
            description: "B",
            email,
            ip: `10.1.1.${i}`,
          },
          PASS_HUMAN,
        ),
      );
    }
    const q = await seedQuote();
    expect(
      await rejects(
        startSubmit(
          {
            quoteToken: q.token,
            businessName: "A",
            description: "B",
            email,
            ip: "10.1.2.1",
          },
          PASS_HUMAN,
        ),
      ),
    ).toBeInstanceOf(RateLimited);
  });

  // ------------------------------------------------------------ step B

  it("step B with the right code creates the org, owner, profile, intake, route, audit", async (t) => {
    if (!booted) return t.skip();
    const email = nextEmail();
    const q = await seedQuote({ selections: SELECTIONS });
    const out = await submitWithCode(booted.inst, {
      quoteToken: q.token,
      businessName: "Rivera Bakery",
      description: "Fresh bread every morning.",
      email,
    });
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") return;
    expect(out.stage).toBe("intake");
    expect(out.token).toBeTruthy();

    const pb = await superuser();
    const org = await pb.collection("organizations").getOne(out.orgId);
    expect(org.path).toBe("standard");
    expect(org.stage).toBe("intake");
    expect(org.status).toBe("active");
    expect(org.slug).toBe("rivera-bakery");

    const [user] = await usersByEmail(email);
    expect(user!.verified).toBe(true);
    expect(user!.pending_signup).toBe(false);
    const members = await byOrg("memberships", out.orgId);
    expect(members.map((m) => [m.user, m.role])).toEqual([[user!.id, "owner"]]);

    const [profile] = await byOrg("business_profile", out.orgId);
    expect(profile!.description).toBe("Fresh bread every morning.");
    expect(profile!.public_email).toBe(email);
    const [intake] = await byOrg("org_intake", out.orgId);
    expect((intake!.selections as { addons: string[] }).addons).toEqual([
      "fixture-quote",
    ]);
    const routes = await byOrg("org_email_routes", out.orgId);
    expect(routes).toHaveLength(1);
    expect(routes[0]!.purpose).toBe("default");
    expect(routes[0]!.address).toBe(email);
    expect(routes[0]!.confirmed_at).toBeTruthy();

    const row = await storedQuote(q.id);
    expect(row.status).toBe("submitted");
    expect(row.merged_org).toBe(out.orgId);
    const audit = await byOrg("audit_log", out.orgId);
    expect(audit.map((a) => a.action)).toContain("signup.submit");

    // The session token is a real member session for that org.
    const ctx = await orgContextFromToken(out.token, out.orgId, IP);
    expect(ctx.role).toBe("owner");
  });

  it("a second org with the same name gets a suffixed slug", async (t) => {
    if (!booted) return t.skip();
    const make = async () => {
      const q = await seedQuote();
      const out = await submitWithCode(booted!.inst, {
        quoteToken: q.token,
        businessName: "Twin Studio",
        description: "Photos.",
        email: nextEmail(),
      });
      if (out.outcome !== "created") throw new Error("expected created");
      return (await superuser()).collection("organizations").getOne(out.orgId);
    };
    const a = await make();
    const b = await make();
    expect(a.slug).toBe("twin-studio");
    expect(b.slug).toBe("twin-studio-2");
  });

  it("a wrong code is SubmitCodeInvalid and nothing is created", async (t) => {
    if (!booted) return t.skip();
    const q = await seedQuote();
    const before = await orgCount();
    const { otpId } = await startSubmit(
      {
        quoteToken: q.token,
        businessName: "A",
        description: "B",
        email: nextEmail(),
        ip: IP,
      },
      PASS_HUMAN,
    );
    const code = await otpCodeFor(booted.inst, otpId);
    expect(
      await rejects(
        completeSubmit(
          { quoteToken: q.token, otpId, code: wrong(code), ip: IP },
          { registry },
        ),
      ),
    ).toBeInstanceOf(SubmitCodeInvalid);
    expect(await orgCount()).toBe(before);
    expect((await storedQuote(q.id)).status).toBe("draft");
  });

  it("the 11th attempt on one otpId is RateLimited", async (t) => {
    if (!booted) return t.skip();
    const q = await seedQuote();
    const { otpId } = await startSubmit(
      {
        quoteToken: q.token,
        businessName: "A",
        description: "B",
        email: nextEmail(),
        ip: IP,
      },
      PASS_HUMAN,
    );
    const code = await otpCodeFor(booted.inst, otpId);
    for (let i = 0; i < SIGN_IN_PER_OTP; i++) {
      await rejects(
        completeSubmit(
          { quoteToken: q.token, otpId, code: wrong(code), ip: `10.2.0.${i}` },
          { registry },
        ),
      );
    }
    expect(
      await rejects(
        completeSubmit(
          { quoteToken: q.token, otpId, code, ip: "10.2.1.1" },
          { registry },
        ),
      ),
    ).toBeInstanceOf(RateLimited);
  });

  it("a staff account cannot use Submit (generic SubmitCodeInvalid)", async (t) => {
    if (!booted) return t.skip();
    const pb = await superuser();
    const email = "submit-staff@cds.test";
    const pw = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    await pb.collection("users").create({
      email,
      password: pw,
      passwordConfirm: pw,
      staff_role: "support_agent",
    });
    const q = await seedQuote();
    const before = await orgCount();
    const err = await rejects(
      submitWithCode(booted.inst, {
        quoteToken: q.token,
        businessName: "Staff Co",
        description: "Nope.",
        email,
      }),
    );
    expect(err).toBeInstanceOf(SubmitCodeInvalid);
    expect(await orgCount()).toBe(before);
  });

  it("a never-hosted match blocks: no org, quote blocked with the category", async (t) => {
    if (!booted) return t.skip();
    const q = await seedQuote();
    const before = await orgCount();
    const out = await submitWithCode(booted.inst, {
      quoteToken: q.token,
      businessName: "Bad Co",
      description: `We sell ${AUP_TEST_TERMS.blocked} things`,
      email: nextEmail(),
    });
    expect(out.outcome).toBe("blocked");
    if (out.outcome !== "blocked") return;
    expect(out.category).toBe("Illegal content or activity");
    expect(await orgCount()).toBe(before);
    const row = await storedQuote(q.id);
    expect(row.status).toBe("blocked");
    expect(row.fit_category).toBe("Illegal content or activity");
  });

  it("B-WR-04: a blocked Submit leaves no account, and a reworded retry is held for staff", async (t) => {
    if (!booted) return t.skip();
    const email = nextEmail();
    const q = await seedQuote();
    const out = await submitWithCode(booted.inst, {
      quoteToken: q.token,
      businessName: "Bad Co",
      description: `We sell ${AUP_TEST_TERMS.blocked} things`,
      email,
    });
    expect(out.outcome).toBe("blocked");
    expect(await usersByEmail(email)).toHaveLength(0);

    // Same address, innocent wording: created, but held at fit_review with the reason.
    const retry = await seedQuote();
    const again = await submitWithCode(booted.inst, {
      quoteToken: retry.token,
      businessName: "Good Co",
      description: "Fresh bread every morning.",
      email,
    });
    expect(again.outcome).toBe("created");
    if (again.outcome !== "created") return;
    expect(again.stage).toBe("fit_review");
    const holds = await byOrg("audit_log", again.orgId);
    const hold = holds.find((r) => r.action === "fit.hold");
    expect(JSON.stringify(hold?.meta)).toContain(
      priorBlockedReason("Illegal content or activity"),
    );
  });

  it("B-WR-04: a blocked Submit never deletes an account that existed before it", async (t) => {
    if (!booted) return t.skip();
    const email = nextEmail();
    const pb = await superuser();
    await pb.collection("users").create({
      email,
      password: "pre-existing-pass-123",
      passwordConfirm: "pre-existing-pass-123",
      verified: true,
    });
    const q = await seedQuote();
    const out = await submitWithCode(booted.inst, {
      quoteToken: q.token,
      businessName: "Bad Co",
      description: `We sell ${AUP_TEST_TERMS.blocked} things`,
      email,
    });
    expect(out.outcome).toBe("blocked");
    expect(await usersByEmail(email)).toHaveLength(1);
  });

  it("a reviewed-first business type creates the org in fit_review", async (t) => {
    if (!booted) return t.skip();
    const q = await seedQuote({ businessType: "cbd-shop" });
    const out = await submitWithCode(booted.inst, {
      quoteToken: q.token,
      businessName: "Leafy Tea",
      description: "Teas and tonics.",
      email: nextEmail(),
    });
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") return;
    expect(out.stage).toBe("fit_review");
    const org = await (
      await superuser()
    )
      .collection("organizations")
      .getOne(out.orgId);
    expect(org.stage).toBe("fit_review");
    const [profile] = await byOrg("business_profile", out.orgId);
    expect(profile!.business_type).toBe("cbd-shop");
  });

  it("an email that already owns an org gets no second org (D286); the quote stays a lead", async (t) => {
    if (!booted) return t.skip();
    const q = await seedQuote({ status: "saved", email: "owner-a@cds.test" });
    const before = await orgCount();
    const out = await submitWithCode(booted.inst, {
      quoteToken: q.token,
      businessName: "Second Shop",
      description: "Another one.",
      email: "owner-a@cds.test",
    });
    expect(out.outcome).toBe("existing_owner");
    if (out.outcome !== "existing_owner") return;
    expect(out.orgId).toBe(booted.seed.A.org);
    expect(await orgCount()).toBe(before);
    expect((await storedQuote(q.id)).status).toBe("saved");
    const ctx = await orgContextFromToken(out.token, out.orgId, IP);
    expect(ctx.role).toBe("owner");
  });

  it("step A refuses a failed human check: no user, no code (A-WR-02)", async (t) => {
    if (!booted) return t.skip();
    const email = nextEmail();
    const q = await seedQuote();
    const err = await rejects(
      startSubmit(
        {
          quoteToken: q.token,
          businessName: "Bot Shop",
          description: "Beep.",
          email,
          ip: IP,
          humanToken: "",
        },
        { humanCheck: alwaysFail() },
      ),
    );
    expect(err).toBeInstanceOf(InvalidInput);
    expect((err as Error).message).toBe(ERR_HUMAN);
    expect(await usersByEmail(email)).toHaveLength(0);
  });

  it("a suppressed address gets no code: step A refuses it, sign-in answers with a decoy (A-WR-02)", async (t) => {
    if (!booted) return t.skip();
    const email = nextEmail();
    await addSuppression(mintSystemContext({ job: "test" }), {
      organization: null,
      email,
      reason: "bounce",
      scope: "all",
      sourceType: "ses",
    });
    const q = await seedQuote();
    const err = await rejects(
      startSubmit(
        {
          quoteToken: q.token,
          businessName: "Bounce Bakery",
          description: "Bread.",
          email,
          ip: IP,
        },
        PASS_HUMAN,
      ),
    );
    expect((err as Error).message).toBe(SUBMIT_SUPPRESSED_COPY);
    expect(await usersByEmail(email)).toHaveLength(0);

    const { otpId } = await requestMemberCode(email, IP);
    expect(otpId).toMatch(/^[a-z0-9]{15}$/);
    const pb = await superuser();
    await expect(pb.collection("_otps").getOne(otpId)).rejects.toThrow();
  });

  // ------------------------------------------------------------ member code

  it("a suppressed address that is an existing owner still gets a sign-in code (R2-WR-02)", async (t) => {
    if (!booted) return t.skip();
    const email = nextEmail();
    const q = await seedQuote();
    const out = await submitWithCode(booted.inst, {
      quoteToken: q.token,
      businessName: "Bounced Later",
      description: "Bread.",
      email,
    });
    if (out.outcome !== "created") throw new Error("expected created");
    // One bounce after sign-up (a full mailbox) must not lock the owner out.
    await addSuppression(mintSystemContext({ job: "test" }), {
      organization: null,
      email,
      reason: "bounce",
      scope: "all",
      sourceType: "ses",
    });
    const { otpId } = await requestMemberCode(email, IP);
    const code = await otpCodeFor(booted.inst, otpId);
    const { token } = await completeMemberCode({ otpId, code, ip: IP });
    expect((await orgContextFromToken(token, out.orgId, IP)).orgId).toBe(
      out.orgId,
    );
  });

  it("requestMemberCode never creates a user; its decoy id never verifies", async (t) => {
    if (!booted) return t.skip();
    const email = "nobody-here@cds.test";
    const { otpId } = await requestMemberCode(email, IP);
    expect(typeof otpId).toBe("string");
    expect(otpId.length).toBeGreaterThan(0);
    expect(await usersByEmail(email)).toHaveLength(0);
    expect(
      await rejects(completeMemberCode({ otpId, code: "123456", ip: IP })),
    ).toBeInstanceOf(SubmitCodeInvalid);
  });

  it("a Submit-created owner signs back in with a code", async (t) => {
    if (!booted) return t.skip();
    const email = nextEmail();
    const q = await seedQuote();
    const out = await submitWithCode(booted.inst, {
      quoteToken: q.token,
      businessName: "Code Cafe",
      description: "Coffee.",
      email,
    });
    if (out.outcome !== "created") throw new Error("expected created");
    const { otpId } = await requestMemberCode(email.toUpperCase(), IP);
    const code = await otpCodeFor(booted.inst, otpId);
    const { token } = await completeMemberCode({ otpId, code, ip: IP });
    const ctx = await orgContextFromToken(token, out.orgId, IP);
    expect(ctx.orgId).toBe(out.orgId);
  });

  it("a staff account cannot use the member code flow", async (t) => {
    if (!booted) return t.skip();
    const { otpId } = await requestMemberCode("submit-staff@cds.test", IP);
    const code = await otpCodeFor(booted.inst, otpId);
    expect(
      await rejects(completeMemberCode({ otpId, code, ip: IP })),
    ).toBeInstanceOf(SubmitCodeInvalid);
  });

  // ------------------------------------------------------------ org stage

  it("getOrgStage gives the stage and path; a demo org without a stage gives ''", async (t) => {
    if (!booted) return t.skip();
    const q = await seedQuote({ path: "studio" });
    const email = nextEmail();
    const out = await submitWithCode(booted.inst, {
      quoteToken: q.token,
      businessName: "Stage Salon",
      description: "Hair.",
      email,
    });
    if (out.outcome !== "created") throw new Error("expected created");
    const ctx = await orgContextFromToken(out.token, out.orgId, IP);
    expect(await getOrgStage(ctx)).toMatchObject({
      stage: "intake",
      path: "studio",
    });
    expect((await getOrgStage(ctx)).slug).toMatch(/^[a-z0-9-]+$/);
    expect(await getOrgStage(booted.seed.ctxA)).toMatchObject({
      stage: "",
      path: "",
    });
  });
});
