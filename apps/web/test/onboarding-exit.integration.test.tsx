// Phase 6 exit, end to end against the real PocketBase 0.39.11 binary (ROADMAP P6 exit; ONB-01..
// ONB-13, EMAIL-01; T-06-108): "a complete intake exists that P8 can assemble from". One funnel
// run through the public @cds/db chokepoint, the same calls the /start, job and hub routes make:
// create quote -> choose -> save (email captured) -> job reminders day 1 and day 3 ->
// unsubscribe through the signed link in the email -> Submit with the harness OTP -> intake ->
// fill the required field -> Send to CDS -> getIntakeForAssembly. Then the two other fit
// outcomes: a blocked business creates no org, and a reviewed-first one waits in fit_review until
// a super_admin approves it. Email goes to captureTransport; the human check is a fake that
// passes; codes are read from the OTP stand-in's stdout. With no PocketBase binary the steps
// skip locally, but fail under CI (never a silent green).
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { AUP_TEST_TERMS } from "@cds/core/onboarding";
import {
  approveFit,
  describeFitCase,
  captureTransport,
  completeSubmit,
  createQuote,
  describeUnsubscribe,
  getIntakeForAssembly,
  getOrgStage,
  IntakeIncomplete,
  orgContextFromToken,
  readQuoteByToken,
  resetQuoteLimitsForTests,
  resetSubmitLimitsForTests,
  runQuoteJobs,
  saveBusinessProfile,
  saveQuoteEmail,
  sendToCds,
  startSubmit,
  unsubscribeQuote,
  updateQuote,
} from "@cds/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bootSeededPb,
  fakeHumanCheck,
  otpCodeFor,
  staffContext,
  type SeededPb,
  PASS_HUMAN,
} from "../../../packages/db/test/seeded";

const IP = "203.0.113.61";
const HOUR = 3_600_000;
let booted: SeededPb | null = null;
let n = 0;

function nextEmail(tag: string): string {
  n += 1;
  return `exit-${tag}-${n}@cds.test`;
}

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

/** The signed unsubscribe token from a message's List-Unsubscribe header. */
function unsubscribeToken(headers: Record<string, string>): string {
  const m = /<(https?:[^>]+)>/.exec(headers["List-Unsubscribe"] ?? "");
  expect(m).not.toBeNull();
  const t = new URL(m![1]!).searchParams.get("t");
  expect(t).toBeTruthy();
  return t!;
}

/** A standard-path quote chosen on /start, not saved. */
async function chosenQuote(businessType = "bakery"): Promise<string> {
  const deps = { registry: ADDON_REGISTRY };
  const { token } = await createQuote({ path: "standard", ip: IP }, deps);
  const { quote, removed } = await updateQuote(
    token,
    {
      businessType,
      selections: {
        addons: ["testimonials"],
        extras: [],
        carePlan: false,
        cadence: "monthly",
      },
    },
    IP,
    deps,
  );
  expect(removed).toEqual([]);
  expect(quote.selections.addons).toEqual(["testimonials"]);
  return token;
}

/** Submit step A + B with the code the OTP stand-in logged. */
async function submit(
  quoteToken: string,
  input: { businessName: string; description: string; email: string },
) {
  const { otpId } = await startSubmit(
    { quoteToken, ...input, ip: IP },
    PASS_HUMAN,
  );
  const code = await otpCodeFor(booted!.inst, otpId);
  return completeSubmit(
    { quoteToken, otpId, code, ip: IP },
    { registry: ADDON_REGISTRY },
  );
}

describe("Phase 6 exit: quote to a complete intake (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
    if (!booted && process.env.CI) {
      throw new Error("PocketBase binary missing under CI");
    }
  });
  afterAll(async () => {
    await booted?.inst.stop();
  });
  beforeEach(() => {
    resetQuoteLimitsForTests();
    resetSubmitLimitsForTests();
  });

  it("clear: quote -> save -> reminders -> unsubscribe -> Submit -> Send to CDS -> P8 assembly", async (t) => {
    if (!booted) return t.skip();
    const deps = { registry: ADDON_REGISTRY };
    const mail = captureTransport();
    const human = fakeHumanCheck();
    const email = nextEmail("clear");

    // 1. Choose on /start, then save the quote to an email (quote.saved captured).
    const token = await chosenQuote();
    const T = new Date();
    const saved = await saveQuoteEmail(token, email, "turnstile-ok", IP, {
      ...deps,
      transport: mail,
      humanCheck: human,
      now: T,
    });
    expect(saved.status).toBe("saved");
    expect(human.calls).toEqual([{ token: "turnstile-ok", ip: IP }]);
    expect(mail.sent.map((m) => m.type)).toEqual(["quote.saved"]);
    expect(mail.sent[0]!.to).toBe(email);

    // 2. The hourly job: day 1 and day 3 reminders, each once (EMAIL-01).
    const r1 = await runQuoteJobs({ now: at(T, 25 * HOUR), transport: mail });
    expect(r1.reminded1).toBe(1);
    const r2 = await runQuoteJobs({ now: at(T, 73 * HOUR), transport: mail });
    expect(r2.reminded2).toBe(1);
    const reminders = mail.sent.filter((m) => m.type === "quote.reminder");
    expect(reminders).toHaveLength(2);
    expect(reminders[0]!.text).not.toContain("This is the last reminder.");
    expect(reminders[1]!.text).toContain("This is the last reminder.");
    expect(reminders.every((m) => m.to === email)).toBe(true);

    // 3. Unsubscribe through the signed link in the email; nothing more is sent.
    const signed = unsubscribeToken(reminders[1]!.headers);
    expect((await describeUnsubscribe(signed))?.done).toBe(false);
    expect(await unsubscribeQuote(signed)).toBe(true);
    expect((await describeUnsubscribe(signed))?.done).toBe(true);
    const sentBefore = mail.sent.length;
    await runQuoteJobs({ now: at(T, 100 * HOUR), transport: mail });
    expect(mail.sent).toHaveLength(sentBefore);

    // 4. Submit with the logged code: an org in setup, owned by that address.
    const out = await submit(token, {
      businessName: "Rivera Bakery",
      description: "Fresh bread and cakes every morning.",
      email,
    });
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") return;
    expect(out.stage).toBe("intake");
    expect((await readQuoteByToken(token))?.status).toBe("submitted");
    const ctx = await orgContextFromToken(out.token, out.orgId, IP);
    expect(ctx.role).toBe("owner");
    expect((await getOrgStage(ctx)).stage).toBe("intake");

    // 5. Send to CDS is refused until the required field is filled.
    const refused = await sendToCds(ctx, ADDON_REGISTRY).then(
      () => null,
      (err: unknown) => err,
    );
    expect(refused).toBeInstanceOf(IntakeIncomplete);
    expect((refused as IntakeIncomplete).missing).toEqual(["time_zone"]);
    await saveBusinessProfile(ctx, { time_zone: "America/Chicago" });
    const sent = await sendToCds(ctx, ADDON_REGISTRY);
    expect(sent.stage).toBe("ready_for_build");
    expect((await getOrgStage(ctx)).stage).toBe("ready_for_build");

    // 6. The P8 contract: provided values where given, fallbacks for the rest.
    const a = await getIntakeForAssembly(ctx, ADDON_REGISTRY);
    expect(a.orgId).toBe(out.orgId);
    expect(a.path).toBe("standard");
    expect(a.fields.org_name).toEqual({
      value: "Rivera Bakery",
      source: "provided",
    });
    expect(a.fields.business_type).toEqual({
      value: "bakery",
      source: "provided",
    });
    expect(a.fields.time_zone).toEqual({
      value: "America/Chicago",
      source: "provided",
    });
    expect(a.fields.email_delivery).toEqual({
      value: email,
      source: "provided",
    });
    expect(a.fields.about?.source).toBe("fallback");
    expect(a.fields.logo?.source).toBe("fallback");
    expect(a.fields.addon_testimonials_records?.source).toBe("fallback");
    expect(a.selections.addons).toEqual(["testimonials"]);
    expect(a.team).toEqual([]);
    expect(a.services).toEqual([]);
  });

  it("blocked: a never-allowed business creates no org and the quote is closed", async (t) => {
    if (!booted) return t.skip();
    const token = await chosenQuote();
    const out = await submit(token, {
      businessName: "Shady Goods",
      description: `We sell ${AUP_TEST_TERMS.blocked} things`,
      email: nextEmail("blocked"),
    });
    expect(out.outcome).toBe("blocked");
    expect((await readQuoteByToken(token))?.status).toBe("blocked");
  });

  it("review: a reviewed-first business waits in fit_review until a super_admin approves", async (t) => {
    if (!booted) return t.skip();
    const token = await chosenQuote();
    const out = await submit(token, {
      businessName: "Careful Co",
      description: `Mostly ${AUP_TEST_TERMS.review} work`,
      email: nextEmail("review"),
    });
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") return;
    expect(out.stage).toBe("fit_review");
    const ctx = await orgContextFromToken(out.token, out.orgId, IP);
    expect((await getOrgStage(ctx)).stage).toBe("fit_review");

    const admin = await staffContext(
      booted.inst,
      "exit-admin@cds.test",
      "super_admin",
    );
    const mail = captureTransport();
    const { fingerprint } = await describeFitCase(admin, out.orgId);
    await approveFit(admin, out.orgId, "Checked the site plan", {
      transport: mail,
      reviewed: fingerprint,
    });
    expect((await getOrgStage(ctx)).stage).toBe("intake");
    expect(mail.sent.map((m) => m.type)).toEqual(["fit.approved"]);
  });
});
