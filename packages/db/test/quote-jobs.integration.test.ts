// The hourly quote job against a real PocketBase (ONB-08, D213, D290, EMAIL-01; PD-9;
// T-06-43..T-06-45). Reminders day 1 / day 3 at most once, the 12 h activity skip,
// suppression, send failures, expiry, purges, orphan users, heartbeat, mutex, and the
// signed reopen link that rotates the quote token.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { superuser } from "../src/client";
import type { EmailTransport } from "../src/email";
import { runQuoteJobs } from "../src/jobs/quotes";
import { readPlatformMeta } from "../src/platform-meta";
import {
  describeSignedReopen,
  quoteSignedReopenLink,
  quoteUnsubscribeLink,
  readQuoteByToken,
  resolveSignedReopen,
  unsubscribeQuote,
} from "../src/quotes";
import {
  bootSeededPb,
  captureTransport,
  seedQuote,
  storedQuote,
  type SeededPb,
} from "./seeded";

let booted: SeededPb | null = null;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function email(tag: string): string {
  return `job-${tag}-${randomBytes(4).toString("hex")}@example.com`;
}

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

async function clearQuotes(): Promise<void> {
  const pb = await superuser();
  for (const r of await pb.collection("quotes").getFullList({ fields: "id" })) {
    await pb.collection("quotes").delete(r.id);
  }
}

async function exists(collection: string, id: string): Promise<boolean> {
  const pb = await superuser();
  try {
    await pb.collection(collection).getOne(id);
    return true;
  } catch {
    return false;
  }
}

async function savedQuote(tag: string, savedAt: Date, expiresAt?: Date) {
  const address = email(tag);
  const q = await seedQuote({
    status: "saved",
    email: address,
    savedAt,
    expiresAt: expiresAt ?? at(savedAt, 30 * DAY),
  });
  return { ...q, email: address };
}

async function createUser(
  verified: boolean,
  pendingSignup = true,
): Promise<string> {
  const pb = await superuser();
  const password = randomBytes(16).toString("hex");
  const u = await pb.collection("users").create({
    email: email("user"),
    password,
    passwordConfirm: password,
    verified,
    pending_signup: pendingSignup,
  });
  return u.id;
}

describe("runQuoteJobs (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
  });
  afterAll(async () => {
    await booted?.inst.stop();
  });
  beforeEach(async () => {
    if (booted) await clearQuotes();
  });

  it("sends reminder 1 after 24 h and reminder 2 after 72 h, each once", async (ctx) => {
    if (!booted) return ctx.skip();
    const T = new Date();
    const q = await savedQuote("sched", T);
    const t = captureTransport();

    expect(
      (await runQuoteJobs({ now: at(T, 23 * HOUR), transport: t })).reminded1,
    ).toBe(0);
    expect(t.sent).toHaveLength(0);

    const r1 = await runQuoteJobs({ now: at(T, 25 * HOUR), transport: t });
    expect(r1.reminded1).toBe(1);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.to).toBe(q.email);
    expect(t.sent[0]!.type).toBe("quote.reminder");
    expect(t.sent[0]!.text).not.toContain("This is the last reminder.");
    expect((await storedQuote(q.id)).reminders_sent).toBe(1);

    const again = await runQuoteJobs({ now: at(T, 26 * HOUR), transport: t });
    expect(again.reminded1 + again.reminded2).toBe(0);
    expect(t.sent).toHaveLength(1);

    const r2 = await runQuoteJobs({ now: at(T, 73 * HOUR), transport: t });
    expect(r2.reminded2).toBe(1);
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1]!.text).toContain("This is the last reminder.");
    expect((await storedQuote(q.id)).reminders_sent).toBe(2);

    const late = await runQuoteJobs({ now: at(T, 100 * HOUR), transport: t });
    expect(late.reminded1 + late.reminded2).toBe(0);
    expect(t.sent).toHaveLength(2);
  });

  it("never sends both reminders in one run when the job was down for days", async (ctx) => {
    if (!booted) return ctx.skip();
    const T = new Date();
    await savedQuote("down", T);
    const t = captureTransport();
    const r = await runQuoteJobs({ now: at(T, 80 * HOUR), transport: t });
    expect(r.reminded1).toBe(1);
    expect(r.reminded2).toBe(0);
    expect(t.sent).toHaveLength(1);
  });

  it("the reminder carries a signed reopen link, an unsubscribe link and RFC 8058 headers", async (ctx) => {
    if (!booted) return ctx.skip();
    const T = new Date();
    const q = await savedQuote("links", T);
    const t = captureTransport();
    await runQuoteJobs({ now: at(T, 25 * HOUR), transport: t });
    const msg = t.sent[0]!;
    const expiresAt = new Date(
      String((await storedQuote(q.id)).expires_at).replace(" ", "T"),
    );
    expect(msg.text).toContain(quoteSignedReopenLink(q.id, expiresAt));
    expect(msg.text).toContain(quoteUnsubscribeLink(q.id, expiresAt));
    expect(msg.text).toContain("/start/q/s/");
    expect(msg.text).not.toContain(q.token);
    expect(msg.headers["List-Unsubscribe"]).toContain(
      "/api/email/unsubscribe?t=",
    );
    expect(msg.headers["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
  });

  it("skips a quote changed within 12 h and sends it once it is idle (PD-9)", async (ctx) => {
    if (!booted) return ctx.skip();
    const now = new Date();
    // Saved 25 h ago but the row was just written (updated = now): the visitor is active.
    await savedQuote("active", at(now, -25 * HOUR));
    const t = captureTransport();
    const busy = await runQuoteJobs({ now, transport: t });
    expect(busy.skippedActive).toBe(1);
    expect(busy.reminded1).toBe(0);
    expect(t.sent).toHaveLength(0);
    const idle = await runQuoteJobs({ now: at(now, 13 * HOUR), transport: t });
    expect(idle.reminded1).toBe(1);
    expect(t.sent).toHaveLength(1);
  });

  it("claims but does not send to an unsubscribed address", async (ctx) => {
    if (!booted) return ctx.skip();
    const T = new Date();
    const q = await savedQuote("unsub", T);
    const row = await storedQuote(q.id);
    const link = quoteUnsubscribeLink(
      q.id,
      new Date(String(row.expires_at).replace(" ", "T")),
    );
    const signed = new URL(link).searchParams.get("t")!;
    expect(await unsubscribeQuote(signed)).toBe(true);
    const t = captureTransport();
    const r = await runQuoteJobs({ now: at(T, 25 * HOUR), transport: t });
    expect(r.suppressed).toBe(1);
    expect(r.reminded1).toBe(0);
    expect(t.sent).toHaveLength(0);
    expect((await storedQuote(q.id)).reminders_sent).toBe(1);
  });

  it("counts a transport failure and never retries it (at most once)", async (ctx) => {
    if (!booted) return ctx.skip();
    const T = new Date();
    const q = await savedQuote("fail", T);
    const broken: EmailTransport = {
      send: () => Promise.reject(new Error("smtp down")),
    };
    const r = await runQuoteJobs({ now: at(T, 25 * HOUR), transport: broken });
    expect(r.sendFailures).toBe(1);
    expect(r.reminded1).toBe(0);
    expect((await storedQuote(q.id)).reminders_sent).toBe(1);
    const t = captureTransport();
    await runQuoteJobs({ now: at(T, 26 * HOUR), transport: t });
    expect(t.sent).toHaveLength(0);
  });

  it("expires past-expiry quotes and never reminds them", async (ctx) => {
    if (!booted) return ctx.skip();
    const T = new Date();
    const q = await savedQuote("exp", at(T, -2 * DAY), at(T, -1 * HOUR));
    const t = captureTransport();
    const r = await runQuoteJobs({ now: T, transport: t });
    expect(r.expired).toBe(1);
    expect(t.sent).toHaveLength(0);
    expect((await storedQuote(q.id)).status).toBe("expired");
  });

  it("purges drafts untouched for 30 days", async (ctx) => {
    if (!booted) return ctx.skip();
    const T = new Date();
    const draft = await seedQuote({
      status: "draft",
      expiresAt: at(T, 90 * DAY),
    });
    const t = captureTransport();
    const early = await runQuoteJobs({ now: at(T, 29 * DAY), transport: t });
    expect(early.purgedDrafts).toBe(0);
    expect(await exists("quotes", draft.id)).toBe(true);
    const r = await runQuoteJobs({ now: at(T, 31 * DAY), transport: t });
    expect(r.purgedDrafts).toBe(1);
    expect(await exists("quotes", draft.id)).toBe(false);
  });

  it("purges expired and blocked quotes 90 days after expiry, never submitted ones", async (ctx) => {
    if (!booted) return ctx.skip();
    const T = new Date();
    const old = await seedQuote({
      status: "expired",
      expiresAt: at(T, -91 * DAY),
    });
    const recent = await seedQuote({
      status: "expired",
      expiresAt: at(T, -89 * DAY),
    });
    const blocked = await seedQuote({
      status: "blocked",
      expiresAt: at(T, -91 * DAY),
    });
    const submitted = await seedQuote({
      status: "submitted",
      expiresAt: at(T, -400 * DAY),
    });
    const r = await runQuoteJobs({ now: T, transport: captureTransport() });
    expect(r.purgedLeads).toBe(2);
    expect(await exists("quotes", old.id)).toBe(false);
    expect(await exists("quotes", blocked.id)).toBe(false);
    expect(await exists("quotes", recent.id)).toBe(true);
    expect(await exists("quotes", submitted.id)).toBe(true);
  });

  it("deletes unverified users older than 24 h with no membership only", async (ctx) => {
    if (!booted) return ctx.skip();
    const orphan = await createUser(false);
    const verified = await createUser(true);
    const member = await createUser(false);
    // A-WR-04: an unverified user Submit did not create (demoted staff, a member removed
    // from their last org, a hand-made user) is never purged.
    const notSignup = await createUser(false, false);
    const pb = await superuser();
    await pb.collection("memberships").create({
      user: member,
      organization: booted.seed.A.org,
      role: "viewer",
    });
    const T = new Date();
    const young = await runQuoteJobs({
      now: at(T, 1 * HOUR),
      transport: captureTransport(),
    });
    expect(await exists("users", orphan)).toBe(true);
    expect(young.purgedUsers).toBe(0);
    const r = await runQuoteJobs({
      now: at(T, 25 * HOUR),
      transport: captureTransport(),
    });
    expect(r.purgedUsers).toBeGreaterThanOrEqual(1);
    expect(await exists("users", orphan)).toBe(false);
    expect(await exists("users", verified)).toBe(true);
    expect(await exists("users", member)).toBe(true);
    expect(await exists("users", notSignup)).toBe(true);
  });

  it("moves on an org left at intake with its intake sent (R2-WR-01)", async (ctx) => {
    if (!booted) return ctx.skip();
    const pb = await superuser();
    const mk = async (stage: string, submitted: boolean) => {
      const org = await pb.collection("organizations").create({
        name: "Raced Org",
        slug: `raced-${randomBytes(4).toString("hex")}`,
        status: "active",
        path: "standard",
        stage,
      });
      await pb.collection("org_intake").create({
        organization: org.id,
        selections: {},
        submitted_at: submitted ? new Date().toISOString() : "",
      });
      return org.id;
    };
    const stuck = await mk("intake", true);
    const notSent = await mk("intake", false);
    const held = await mk("fit_review", true);
    const r = await runQuoteJobs({ transport: captureTransport() });
    expect(r.reconciled).toBeGreaterThanOrEqual(1);
    expect((await pb.collection("organizations").getOne(stuck)).stage).toBe(
      "ready_for_build",
    );
    expect((await pb.collection("organizations").getOne(notSent)).stage).toBe(
      "intake",
    );
    expect((await pb.collection("organizations").getOne(held)).stage).toBe(
      "fit_review",
    );
    const rows = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'fit.reconcile'", {
        o: stuck,
      }),
    });
    expect(rows).toHaveLength(1);
  });

  it("writes the heartbeat and counts to platform_meta", async (ctx) => {
    if (!booted) return ctx.skip();
    const T = new Date();
    await savedQuote("beat", T);
    const now = at(T, 25 * HOUR);
    const r = await runQuoteJobs({ now, transport: captureTransport() });
    expect(await readPlatformMeta("job:quotes:last_success")).toBe(
      now.toISOString(),
    );
    const counts = JSON.parse(
      (await readPlatformMeta("job:quotes:last_counts"))!,
    );
    expect(counts).toEqual(r);
    expect(counts.sendFailures).toBe(0);
    const later = at(T, 26 * HOUR);
    await runQuoteJobs({ now: later, transport: captureTransport() });
    expect(await readPlatformMeta("job:quotes:last_success")).toBe(
      later.toISOString(),
    );
  });

  it("serialises concurrent runs so a reminder is sent once", async (ctx) => {
    if (!booted) return ctx.skip();
    const T = new Date();
    await savedQuote("mutex", T);
    const t = captureTransport();
    const now = at(T, 25 * HOUR);
    const [a, b] = await Promise.all([
      runQuoteJobs({ now, transport: t }),
      runQuoteJobs({ now, transport: t }),
    ]);
    expect(a.reminded1 + b.reminded1).toBe(1);
    expect(t.sent).toHaveLength(1);
  });

  it("a signed reopen link rotates the token; tampered, expired and submitted links do not", async (ctx) => {
    if (!booted) return ctx.skip();
    const T = new Date();
    const q = await savedQuote("reopen", T);
    const expiresAt = at(T, 30 * DAY);
    const link = quoteSignedReopenLink(q.id, expiresAt);
    const signed = link.split("/start/q/s/")[1]!;
    expect(await readQuoteByToken(q.token)).not.toBeNull();

    // B-WR-01: describing the link (the GET page) never rotates the token.
    expect(await describeSignedReopen(signed)).toBe("valid");
    expect(await describeSignedReopen(signed)).toBe("valid");
    expect((await readQuoteByToken(q.token))?.id).toBe(q.id);
    expect(await describeSignedReopen(`${signed}x`)).toBeNull();

    const res = await resolveSignedReopen(signed);
    expect(res?.state).toBe("valid");
    const fresh = (res as { token: string }).token;
    expect(fresh).not.toBe(q.token);
    expect(await readQuoteByToken(q.token)).toBeNull();
    expect((await readQuoteByToken(fresh))?.id).toBe(q.id);

    expect(await resolveSignedReopen(`${signed}x`)).toBeNull();
    expect(await resolveSignedReopen("garbage")).toBeNull();

    // Past the quote's expiry the signed link itself has lapsed.
    expect(
      await resolveSignedReopen(signed, { now: at(T, 31 * DAY) }),
    ).toBeNull();

    const gone = await savedQuote(
      "reopen-exp",
      at(T, -2 * DAY),
      at(T, 1 * DAY),
    );
    const pb = await superuser();
    await pb.collection("quotes").update(gone.id, { status: "expired" });
    const goneSigned = quoteSignedReopenLink(gone.id, at(T, 1 * DAY)).split(
      "/start/q/s/",
    )[1]!;
    expect(await resolveSignedReopen(goneSigned)).toEqual({ state: "expired" });

    const sub = await seedQuote({
      status: "submitted",
      expiresAt: at(T, 5 * DAY),
    });
    const subSigned = quoteSignedReopenLink(sub.id, at(T, 5 * DAY)).split(
      "/start/q/s/",
    )[1]!;
    expect(await describeSignedReopen(subSigned)).toBe("submitted");
    expect(await describeSignedReopen(goneSigned)).toBe("expired");
    expect(await resolveSignedReopen(subSigned)).toEqual({
      state: "submitted",
    });
  });
});
