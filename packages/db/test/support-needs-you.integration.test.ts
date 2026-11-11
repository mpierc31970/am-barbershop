// 12-24: the support Needs-you provider on the real PocketBase binary (COMM-03, COMM-10,
// COMM-11, SUPPORT-03, DASH-27; T-12-24-01, T-12-24-02). CDS replies, tickets waiting on you,
// new CDS messages and notes, the Owner's paid choice, held changes and planned work, each
// for the right people; bell rows clear with their items.
import "@cds/addon-registry/server";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import type { NeedsYouItem } from "@cds/core/today";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listBell } from "../src/alerts/list";
import { resetClientForTests, superuser } from "../src/client";
import { type OrgContext } from "../src/context";
import { captureTransport } from "../src/email/transport";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import {
  fileTicket,
  holdDraft,
  markNotesRead,
  markSupportRead,
  replyToTicket,
  staffCreateServiceWindow,
  staffMarkPaidService,
  staffPostConversationMessage,
  staffPostNote,
  staffReplyToTicket,
  supportNeedsYou,
} from "../src/support";
import { resetLockCacheForTests } from "../src/support/lock";
import { listNeedsYou } from "../src/today";
import { bootPb, type PbInstance } from "./pb-harness";
import { fixedClock } from "./support-fakes";
import { seedSupport, type SupportSeed } from "./support-seed";

const MIN = 60_000;
const HOUR = 60 * MIN;

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let nowMs = Date.now();

const at = (offset = 0) => new Date(nowMs + offset);
const clockAt = (offset = 0) => ({ now: () => at(offset) });
const quiet = () => ({ transport: captureTransport() });

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: new Date() });
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(() => {
  resetSupportLimitsForTests();
  nowMs = Date.now();
  resetLockCacheForTests({ now: () => new Date(nowMs) });
});

async function file(
  ctx: OrgContext,
  subject: string,
  type: "question" | "change" = "question",
) {
  const r = await fileTicket(
    ctx,
    { type, subject, body: "Please help with the hours on the home page." },
    { clock: clockAt(-10 * MIN) },
  );
  return r.number;
}

async function threadId(number: number): Promise<string> {
  return (
    await pb
      .collection("support_threads")
      .getFirstListItem(pb.filter("number = {:n}", { n: number }))
  ).id;
}

async function items(ctx: OrgContext, offset = 0): Promise<NeedsYouItem[]> {
  return supportNeedsYou(ctx, at(offset));
}

function find(list: NeedsYouItem[], key: string) {
  return list.find((i) => i.key === key);
}

describe("tickets (COMM-03, COMM-10)", () => {
  it("a CDS reply reaches the filer and the Owner; reading clears it for the filer only", async (t) => {
    if (!inst) return t.skip();
    const n = await file(s.A.ctx.editor, "Hours look wrong");
    await staffReplyToTicket(
      s.staff.agent,
      { number: n, body: "Fixed the hours for you." },
      { clock: clockAt(-5 * MIN), ...quiet() },
    );
    const key = `support:ticket:${n}`;
    for (const who of [s.A.ctx.editor, s.A.ctx.owner, s.A.ctx.admin]) {
      const item = find(await items(who), key);
      expect(item?.title).toBe(`CDS replied to ticket #${n}`);
      expect(item?.actionLabel).toBe("Read reply");
      expect(item?.sub).toBe("Hours look wrong · 5 minutes ago");
      expect(item?.href).toBe(`/hub/support/tickets/${n}`);
      expect(item?.section).toBe("support");
      expect(item?.tab).toBe("tickets");
    }

    await markSupportRead(s.A.ctx.editor, await threadId(n), at(-MIN));
    expect(find(await items(s.A.ctx.editor), key)).toBeUndefined();
    expect(find(await items(s.A.ctx.owner), key)).toBeDefined();
    // Org B never sees org A's ticket.
    expect(find(await items(s.B.ctx.owner), key)).toBeUndefined();
  });

  it("an editor sees only tickets they filed", async (t) => {
    if (!inst) return t.skip();
    const n = await file(s.A.ctx.owner, "Owner's own question");
    await staffReplyToTicket(
      s.staff.agent,
      { number: n, body: "Answer." },
      { clock: clockAt(-5 * MIN), ...quiet() },
    );
    const key = `support:ticket:${n}`;
    expect(find(await items(s.A.ctx.owner), key)).toBeDefined();
    expect(find(await items(s.A.ctx.editor), key)).toBeUndefined();
  });

  it("Waiting on you shows until the tenant replies", async (t) => {
    if (!inst) return t.skip();
    const n = await file(s.A.ctx.editor, "Which photo?");
    await staffReplyToTicket(
      s.staff.agent,
      { number: n, body: "Which photo do you want?", status: "waiting_on_you" },
      { clock: clockAt(-5 * MIN), ...quiet() },
    );
    const key = `support:ticket:${n}`;
    const waiting = find(await items(s.A.ctx.editor), key);
    expect(waiting?.title).toBe(`Ticket #${n} is waiting on you`);
    expect(waiting?.sub).toBe("Which photo?");
    expect(waiting?.actionLabel).toBe("Reply");

    // Opening the ticket alone keeps it: the ticket still waits on a reply.
    await markSupportRead(s.A.ctx.editor, await threadId(n), at(-2 * MIN));
    expect(find(await items(s.A.ctx.editor), key)?.title).toBe(
      `Ticket #${n} is waiting on you`,
    );

    await replyToTicket(
      s.A.ctx.editor,
      n,
      { body: "The blue one." },
      { clock: clockAt(-MIN) },
    );
    expect(find(await items(s.A.ctx.editor), key)).toBeUndefined();
    // The Owner never read the CDS question: it stays as an unread reply, not waiting.
    expect(find(await items(s.A.ctx.owner), key)?.title).toBe(
      `CDS replied to ticket #${n}`,
    );
  });
});

describe("paid choice (SUPPORT-03; T-12-24-01)", () => {
  it("only the Owner gets the choice row; the Admin sees the ticket waiting", async (t) => {
    if (!inst) return t.skip();
    const n = await file(s.A.ctx.editor, "New banner please", "change");
    await staffMarkPaidService(
      s.staff.agent,
      { number: n, category: "design" },
      { clock: clockAt(-5 * MIN), ...quiet() },
    );
    const key = `support:ticket:${n}`;
    const owner = find(await items(s.A.ctx.owner), key);
    expect(owner?.title).toBe(`Choose how to handle ticket #${n}`);
    expect(owner?.sub).toBe("This is a paid service");
    expect(owner?.actionLabel).toBe("Choose an option");
    for (const who of [s.A.ctx.admin, s.A.ctx.editor]) {
      expect(find(await items(who), key)?.title).toBe(
        `Ticket #${n} is waiting on you`,
      );
    }
    // Through listNeedsYou too: the merged list keeps the grant split.
    const base = { today: [], registry: ADDON_REGISTRY, now: at() };
    const ownerList = await listNeedsYou(s.A.ctx.owner, base);
    const adminList = await listNeedsYou(s.A.ctx.admin, base);
    expect(find(ownerList.items, key)?.title).toMatch(/^Choose how/);
    expect(find(adminList.items, key)?.title).toMatch(/waiting on you$/);
    expect(adminList.items.some((i) => i.title.startsWith("Choose"))).toBe(
      false,
    );
    // Internal grant fields never leave listNeedsYou.
    expect(Object.keys(find(ownerList.items, key)!)).not.toContain("feature");
  });
});

describe("Viewers (D310)", () => {
  it("get no support items", async (t) => {
    if (!inst) return t.skip();
    expect(await items(s.A.ctx.viewer)).toEqual([]);
    const res = await listNeedsYou(s.A.ctx.viewer, {
      today: [],
      registry: ADDON_REGISTRY,
    });
    expect(res.items).toEqual([]);
  });
});

describe("messages and notes", () => {
  it("a new CDS message, then a new note once the message is read", async (t) => {
    if (!inst) return t.skip();
    const posted = await staffPostConversationMessage(
      s.staff.agent,
      {
        orgId: s.A.org,
        body: "Hi! We moved your booking page live this morning, have a look when you can.",
      },
      { clock: clockAt(-5 * MIN), ...quiet() },
    );
    for (const who of [s.A.ctx.editor, s.A.ctx.owner]) {
      const item = find(await items(who), "support:messages");
      expect(item?.title).toBe("New message from CDS");
      expect(item?.actionLabel).toBe("Read message");
      expect(item?.href).toBe("/hub/support?tab=messages");
      expect(item?.tab).toBe("messages");
      expect(item?.sub?.length).toBeLessThanOrEqual(60);
      expect(item?.sub).toMatch(/^Hi! We moved your booking page/);
    }
    await markSupportRead(s.A.ctx.editor, posted.threadId, at(-MIN));
    expect(find(await items(s.A.ctx.editor), "support:messages")).toBe(
      undefined,
    );

    await staffPostNote(
      s.staff.agent,
      { orgId: s.A.org, title: "Holiday hours", body: "We are closed Monday." },
      { clock: clockAt(), ...quiet() },
    );
    const note = find(await items(s.A.ctx.editor, MIN), "support:messages");
    expect(note?.title).toBe("New note from CDS: Holiday hours");
    expect(note?.actionLabel).toBe("Read note");
    await markNotesRead(s.A.ctx.editor, at(2 * MIN));
    expect(
      find(await items(s.A.ctx.editor, 3 * MIN), "support:messages"),
    ).toBeUndefined();
  });
});

describe("held changes (COMM-11; T-12-24-02)", () => {
  it("appear for their author only, after the window ends", async (t) => {
    if (!inst) return t.skip();
    const endsAt = nowMs + HOUR;
    await staffCreateServiceWindow(
      s.staff.agent,
      {
        scope: "page",
        orgId: s.A.org,
        pageId: s.A.livePage,
        startsAt: at(-HOUR),
        endsAt: new Date(endsAt),
      },
      {
        clock: fixedClock(at().toISOString()),
        addons: [],
        notify: { transport: captureTransport() },
      },
    );
    const held = await holdDraft(s.A.ctx.editor, {
      kind: "section",
      section: {
        pageId: s.A.livePage,
        section_type: "text-only",
        row_layout: "full",
        content: { heading: "Mine", text: "<p>x</p>" },
      },
    });
    const key = `support:held:${held.id}`;
    expect(find(await items(s.A.ctx.editor), key)).toBeUndefined();

    nowMs = endsAt + MIN;
    resetLockCacheForTests({ now: () => new Date(nowMs) });
    const item = find(await items(s.A.ctx.editor), key);
    const page = await pb.collection("pages").getOne(s.A.livePage);
    expect(item?.title).toBe(`Your changes to ${page.title} are waiting`);
    expect(item?.sub).toBe("CDS has finished its work.");
    expect(item?.actionLabel).toBe("Review changes");
    expect(item?.href).toBe(`/hub/website/pages/${s.A.livePage}`);
    expect(find(await items(s.A.ctx.owner), key)).toBeUndefined();
    expect(find(await items(s.A.ctx.admin), key)).toBeUndefined();
  });
});

describe("planned work (COMM-11)", () => {
  it("an active org-wide window is urgent for everyone until it ends; a page window is not listed", async (t) => {
    if (!inst) return t.skip();
    const endsAt = nowMs + HOUR;
    const notify = { transport: captureTransport() };
    const org = await staffCreateServiceWindow(
      s.staff.agent,
      {
        scope: "organization",
        orgId: s.B.org,
        message: "Moving your site to a faster server.",
        startsAt: at(-MIN),
        endsAt: new Date(endsAt),
      },
      { clock: fixedClock(at().toISOString()), addons: [], notify },
    );
    const page = await staffCreateServiceWindow(
      s.staff.agent,
      {
        scope: "page",
        orgId: s.B.org,
        pageId: s.B.livePage,
        startsAt: at(-MIN),
        endsAt: new Date(endsAt),
      },
      { clock: fixedClock(at().toISOString()), addons: [], notify },
    );
    for (const who of [s.B.ctx.owner, s.B.ctx.editor]) {
      const list = await items(who);
      const item = find(list, `support:notice:${org.id}`);
      expect(item?.level).toBe("urgent");
      expect(item?.title).toMatch(/^CDS is working on your site until /);
      expect(item?.title).not.toMatch(/\.$/);
      expect(item?.sub).toBe("Moving your site to a faster server.");
      expect(item?.actionLabel).toBe("See details");
      expect(item?.href).toBe("/hub/support?tab=messages");
      expect(find(list, `support:notice:${page.id}`)).toBeUndefined();
    }
    expect(find(await items(s.A.ctx.owner), `support:notice:${org.id}`)).toBe(
      undefined,
    );
    expect(
      find(await items(s.B.ctx.owner, HOUR + MIN), `support:notice:${org.id}`),
    ).toBeUndefined();
  });
});

describe("bell clearing (COMM-03, COMM-10; choices 3 and 4)", () => {
  async function bellFor(ctx: OrgContext, sourceKey: string, offset = 0) {
    const row = await pb.collection("alerts").getFirstListItem(
      pb.filter("user = {:u} && source_key = {:k}", {
        u: ctx.actor ?? "",
        k: sourceKey,
      }),
      { sort: "-created" },
    );
    const needs = await listNeedsYou(ctx, {
      today: [],
      registry: ADDON_REGISTRY,
      now: at(offset),
    });
    const keys = new Set(needs.items.map((i) => i.key));
    const bell = await listBell(ctx, { needsYouKeys: keys, limit: 100 });
    return bell.find((b) => b.id === row.id)!;
  }

  it("a support.reply row stays while its item exists and clears once it is read", async (t) => {
    if (!inst) return t.skip();
    const n = await file(s.A.ctx.editor, "Footer typo");
    await staffReplyToTicket(
      s.staff.agent,
      { number: n, body: "Fixed the typo." },
      { clock: clockAt(-5 * MIN), ...quiet() },
    );
    const key = `support:ticket:${n}`;
    const before = await bellFor(s.A.ctx.editor, key);
    expect(before.type).toBe("support.reply");
    expect(before.read).toBe(false);
    expect(before.cleared).toBe(false);

    await markSupportRead(s.A.ctx.editor, await threadId(n), at(-MIN));
    const after = await bellFor(s.A.ctx.editor, key);
    expect(after.read).toBe(false);
    expect(after.cleared).toBe(true);
    // The Owner has not read it: their row stays.
    expect((await bellFor(s.A.ctx.owner, key)).cleared).toBe(false);
  });

  it("a cds.notice row is a plain alert: it stays after its window's item ends", async (t) => {
    if (!inst) return t.skip();
    const w = await staffCreateServiceWindow(
      s.staff.agent,
      {
        scope: "organization",
        orgId: s.B.org,
        message: "Quick update.",
        startsAt: at(-MIN),
        endsAt: at(10 * MIN),
      },
      {
        clock: fixedClock(at().toISOString()),
        addons: [],
        notify: { transport: captureTransport() },
      },
    );
    const key = `cds:notice:${w.id}`;
    const during = await bellFor(s.B.ctx.owner, key);
    expect(during.type).toBe("cds.notice");
    expect(during.level).toBe("urgent");
    expect(during.cleared).toBe(false);
    const ended = await bellFor(s.B.ctx.owner, key, HOUR);
    expect(ended.cleared).toBe(false);
    expect(ended.read).toBe(false);
  });
});
