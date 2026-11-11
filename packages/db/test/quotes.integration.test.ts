// The anonymous quote chokepoint against a real PocketBase (ONB-08, ONB-06, ONB-11; D213;
// T-06-28..T-06-33). Token hashed at rest, server-side totals, path reconcile, read-only
// after Submit, 30-day expiry, save with a bot check, and unsubscribe to the one list.
import { InvalidInput, NotFound, RateLimited } from "@cds/core";
import { priceQuote } from "@cds/core/pricing";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readPriceCatalog } from "../src/catalog";
import { superuser } from "../src/client";
import { mintSystemContext } from "../src/context";
import { canSend } from "../src/email";
import { alwaysFail, alwaysPass } from "../src/human-check";
import {
  createQuote,
  describeUnsubscribe,
  quoteLinkState,
  quoteReopenLink,
  QUOTE_TOKEN_RE,
  quoteUnsubscribeLink,
  readQuoteByToken,
  saveQuoteEmail,
  unsubscribeQuote,
  updateQuote,
} from "../src/quotes";
import { QUOTE_SAVE_PER_IP, resetQuoteLimitsForTests } from "../src/rate-limit";
import {
  bootSeededPb,
  captureTransport,
  fakeHumanCheck,
  seedQuote,
  storedQuote,
  testRegistry,
  type SeededPb,
} from "./seeded";

let booted: SeededPb | null = null;
const registry = testRegistry();
const DAY = 86_400_000;
const IP = "198.51.100.7";

function sha(t: string): string {
  return createHash("sha256").update(t, "utf8").digest("hex");
}

async function suppressionRows(email: string) {
  const pb = await superuser();
  return pb.collection("email_suppressions").getFullList({
    filter: pb.filter("email = {:e}", { e: email }),
  });
}

describe("quote chokepoint (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
  });
  afterAll(async () => {
    await booted?.inst.stop();
  });
  beforeEach(() => resetQuoteLimitsForTests());

  it("creates a draft with a random token stored only as its sha256", async (ctx) => {
    if (!booted) return ctx.skip();
    const { token, quote } = await createQuote(
      { path: "standard", ip: IP },
      { registry },
    );
    expect(token).toMatch(QUOTE_TOKEN_RE);
    expect(quote.status).toBe("draft");
    expect(quote.path).toBe("standard");
    const row = await storedQuote(quote.id);
    expect(row.token_hash).toBe(sha(token));
    for (const v of Object.values(row)) {
      expect(JSON.stringify(v)).not.toContain(token);
    }
    const expected = priceQuote(
      await readPriceCatalog(),
      quote.selections,
      "standard",
      "monthly",
    );
    expect(quote.totals).toEqual(expected);
    expect(expected.build.cents).toBe(150000);
  });

  it("two quotes get different tokens", async (ctx) => {
    if (!booted) return ctx.skip();
    const a = await createQuote({ path: "studio", ip: IP }, { registry });
    const b = await createQuote({ path: "studio", ip: IP }, { registry });
    expect(a.token).not.toBe(b.token);
  });

  it("refuses the unsold Shop path", async (ctx) => {
    if (!booted) return ctx.skip();
    await expect(
      createQuote({ path: "shop", ip: IP }, { registry }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("reads a quote by token; malformed and unknown tokens read null", async (ctx) => {
    if (!booted) return ctx.skip();
    const { token, quote } = await createQuote(
      { path: "standard", ip: IP },
      { registry },
    );
    expect((await readQuoteByToken(token))?.id).toBe(quote.id);
    expect(await readQuoteByToken("garbage")).toBeNull();
    expect(await readQuoteByToken("Z".repeat(43))).toBeNull();
  });

  it("recomputes totals on the server and ignores client totals", async (ctx) => {
    if (!booted) return ctx.skip();
    const { token } = await createQuote(
      { path: "standard", ip: IP },
      { registry },
    );
    const { quote } = await updateQuote(
      token,
      {
        selections: {
          addons: ["fixture-quote", "not-a-real-addon", "fixture-private"],
          extras: ["copywriting", "made-up"],
          carePlan: true,
          cadence: "yearly",
          totals: { dueAtCheckoutCents: 1 },
          monthlyCents: 1,
        },
      },
      IP,
      { registry },
    );
    expect(quote.selections).toEqual({
      addons: ["fixture-quote"],
      extras: ["copywriting"],
      carePlan: true,
      cadence: "yearly",
    });
    expect(quote.totals).toEqual(
      priceQuote(
        await readPriceCatalog(),
        quote.selections,
        "standard",
        "yearly",
      ),
    );
    const row = await storedQuote(quote.id);
    expect(row.totals).toEqual(quote.totals);
    expect(JSON.stringify(row.selections)).not.toContain("totals");
  });

  it("changing path drops add-ons that no longer fit and reports them", async (ctx) => {
    if (!booted) return ctx.skip();
    const { token } = await createQuote(
      { path: "standard", ip: IP },
      { registry },
    );
    await updateQuote(
      token,
      { selections: { addons: ["fixture-quote", "fixture-events"] } },
      IP,
      { registry },
    );
    const { quote, removed } = await updateQuote(
      token,
      { path: "studio" },
      IP,
      { registry },
    );
    expect(removed).toEqual(["fixture-quote"]);
    expect(quote.path).toBe("studio");
    expect(quote.selections.addons).toEqual(["fixture-events"]);
    expect(quote.totals?.path).toBe("studio");
  });

  it("validates the business type against the path; 'other' needs a description", async (ctx) => {
    if (!booted) return ctx.skip();
    const { token } = await createQuote(
      { path: "standard", ip: IP },
      { registry },
    );
    await expect(
      updateQuote(token, { businessType: "hair-salon" }, IP, { registry }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      updateQuote(token, { businessType: "nope" }, IP, { registry }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      updateQuote(token, { businessType: "other" }, IP, { registry }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      updateQuote(
        token,
        { businessType: "other", businessTypeOther: "x".repeat(81) },
        IP,
        { registry },
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
    const ok = await updateQuote(
      token,
      { businessType: "other", businessTypeOther: "  Candle maker " },
      IP,
      { registry },
    );
    expect(ok.quote.businessType).toBe("other");
    expect(ok.quote.businessTypeOther).toBe("Candle maker");
    const t = await updateQuote(token, { businessType: "bakery" }, IP, {
      registry,
    });
    expect(t.quote.businessType).toBe("bakery");
    expect(t.quote.businessTypeOther).toBe("");
    // A path change clears a type that does not exist on the new path.
    const s = await updateQuote(token, { path: "studio" }, IP, { registry });
    expect(s.quote.businessType).toBe("");
  });

  it("every change pushes expires_at to 30 days after it", async (ctx) => {
    if (!booted) return ctx.skip();
    const now = new Date("2026-10-01T00:00:00.000Z");
    const { token } = await createQuote(
      { path: "standard", ip: IP },
      { registry, now },
    );
    const later = new Date(now.getTime() + 10 * DAY);
    const { quote } = await updateQuote(
      token,
      { selections: { carePlan: true } },
      IP,
      { registry, now: later },
    );
    expect(quote.expiresAt?.getTime()).toBe(later.getTime() + 30 * DAY);
  });

  it("an expired quote reads null and its link reads 'expired'", async (ctx) => {
    if (!booted) return ctx.skip();
    const { token } = await createQuote(
      { path: "standard", ip: IP },
      { registry },
    );
    const future = new Date(Date.now() + 31 * DAY);
    expect(await readQuoteByToken(token, { now: future })).toBeNull();
    expect(await quoteLinkState(token, { now: future })).toBe("expired");
    expect(await quoteLinkState(token)).toBe("valid");
    expect(await quoteLinkState("garbage")).toBe("expired");
    expect(await quoteLinkState("Z".repeat(43))).toBe("expired");
    await expect(
      updateQuote(token, { selections: {} }, IP, { registry, now: future }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("submitted and blocked quotes are read-only", async (ctx) => {
    if (!booted) return ctx.skip();
    const sub = await seedQuote({ status: "submitted", email: "s@x.test" });
    const blk = await seedQuote({ status: "blocked" });
    for (const { token } of [sub, blk]) {
      await expect(
        updateQuote(token, { selections: {} }, IP, { registry }),
      ).rejects.toBeInstanceOf(InvalidInput);
      await expect(
        saveQuoteEmail(token, "s@x.test", "tok", IP, {
          registry,
          humanCheck: alwaysPass(),
        }),
      ).rejects.toBeInstanceOf(InvalidInput);
    }
    expect(await quoteLinkState(sub.token)).toBe("submitted");
    expect(await quoteLinkState(blk.token)).toBe("expired");
  });

  it("a failed bot check refuses the save with ERR-HUMAN and sends nothing", async (ctx) => {
    if (!booted) return ctx.skip();
    const { token, quote } = await createQuote(
      { path: "standard", ip: IP },
      { registry },
    );
    const t = captureTransport();
    await expect(
      saveQuoteEmail(token, "bot@x.test", "tok", IP, {
        registry,
        transport: t,
        humanCheck: alwaysFail(),
      }),
    ).rejects.toThrow(/couldn't confirm you're a person/);
    expect(t.sent).toHaveLength(0);
    expect((await storedQuote(quote.id)).status).toBe("draft");
  });

  it("saving sets status, saved_at and sends quote.saved with the reopen link", async (ctx) => {
    if (!booted) return ctx.skip();
    const { token } = await createQuote(
      { path: "standard", ip: IP },
      { registry },
    );
    const t = captureTransport();
    const hc = fakeHumanCheck(true);
    const saved = await saveQuoteEmail(
      token,
      " Visitor@Example.com ",
      "turnstile-tok",
      IP,
      { registry, transport: t, humanCheck: hc },
    );
    expect(hc.calls).toEqual([{ token: "turnstile-tok", ip: IP }]);
    expect(saved.status).toBe("saved");
    expect(saved.email).toBe("visitor@example.com");
    expect(saved.savedAt).toBeInstanceOf(Date);
    expect(t.sent).toHaveLength(1);
    const m = t.sent[0]!;
    expect(m.type).toBe("quote.saved");
    expect(m.to).toBe("visitor@example.com");
    expect(m.orgId).toBeNull();
    expect(m.text).toContain(quoteReopenLink(token));
    expect((await readQuoteByToken(token))?.email).toBe("visitor@example.com");
  });

  it("a send failure does not undo the save", async (ctx) => {
    if (!booted) return ctx.skip();
    const { token } = await createQuote(
      { path: "studio", ip: IP },
      { registry },
    );
    const saved = await saveQuoteEmail(token, "fail@x.test", "tok", IP, {
      registry,
      humanCheck: alwaysPass(),
      transport: { send: () => Promise.reject(new Error("smtp down")) },
    });
    expect(saved.status).toBe("saved");
  });

  it("an invalid email is refused with ERR-EMAIL", async (ctx) => {
    if (!booted) return ctx.skip();
    const { token } = await createQuote(
      { path: "standard", ip: IP },
      { registry },
    );
    await expect(
      saveQuoteEmail(token, "nope", "tok", IP, {
        registry,
        humanCheck: alwaysPass(),
      }),
    ).rejects.toThrow(/doesn't look like an email address/);
  });

  it("the sixth save from one IP is rate limited", async (ctx) => {
    if (!booted) return ctx.skip();
    const { token } = await createQuote(
      { path: "standard", ip: IP },
      { registry },
    );
    const ip = "198.51.100.99";
    const deps = {
      registry,
      humanCheck: alwaysPass(),
      transport: captureTransport(),
    };
    for (let i = 0; i < QUOTE_SAVE_PER_IP; i++) {
      await saveQuoteEmail(token, "r@x.test", "tok", ip, deps);
    }
    await expect(
      saveQuoteEmail(token, "r@x.test", "tok", ip, deps),
    ).rejects.toBeInstanceOf(RateLimited);
  });

  it("unsubscribe writes a CDS marketing suppression; tampered links do nothing", async (ctx) => {
    if (!booted) return ctx.skip();
    const email = "unsub@x.test";
    const q = await seedQuote({ status: "saved", email, savedAt: new Date() });
    const exp = new Date(Date.now() + 30 * DAY);
    const t = new URL(quoteUnsubscribeLink(q.id, exp)).searchParams.get("t")!;

    expect(await describeUnsubscribe(t)).toMatchObject({
      quoteId: q.id,
      done: false,
    });
    expect(await unsubscribeQuote(`${t}x`)).toBe(false);
    expect(await suppressionRows(email)).toHaveLength(0);

    expect(await unsubscribeQuote(t)).toBe(true);
    expect(await unsubscribeQuote(t)).toBe(true); // idempotent
    const rows = await suppressionRows(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization: "",
      scope: "marketing",
      reason: "unsubscribe",
    });
    expect((await describeUnsubscribe(t))?.done).toBe(true);

    const system = mintSystemContext({ job: "test" });
    const as = { kind: "cds" as const, ctx: system };
    expect(await canSend(as, email, "marketing")).toBe(false);
    expect(await canSend(as, email, "transactional")).toBe(true);
  });

  it("an unsubscribe link for a quote with no email does nothing", async (ctx) => {
    if (!booted) return ctx.skip();
    const q = await seedQuote();
    const t = new URL(
      quoteUnsubscribeLink(q.id, new Date(Date.now() + DAY)),
    ).searchParams.get("t")!;
    expect(await describeUnsubscribe(t)).toBeNull();
    expect(await unsubscribeQuote(t)).toBe(false);
  });
});
