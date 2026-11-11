// 14-33 (DOM-10, D172, D26; T-14-33-01..04): the launch review store on the real PocketBase
// binary. Marks are the Owner's (refused under impersonation, Admin reads only), progress is
// computed (a republish resets a page), the review token mints the owner's context only while
// the membership holds, Needs a change files a P12 change ticket on `page:<id>`, and Ready to
// launch waits for all six items and a prepared domain move (driven with the 14-22 helpers).
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  NotFound,
} from "@cds/core";
import { P14_COPY, type DnsRecord } from "@cds/core/dns";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { resetDnsForTests } from "../src/dns/factory";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import { advanceMove, startMove, type MoveDeps } from "../src/dns/moves";
import { signReviewToken } from "../src/dns/preview-links";
import { captureTransport } from "../src/email/transport";
import {
  markKeyFacts,
  markPage,
  markPhoneCheck,
  recordTestFormSubmission,
  reviewContextForToken,
} from "../src/launch-review/marks";
import { launchReviewState } from "../src/launch-review/progress";
import {
  DomainNotReady,
  launchReviewView,
  requestPageChange,
  reviewPages,
  submitLaunchReview,
} from "../src/launch-review/review";
import { launchReviewProgress } from "../src/org-stage";
import {
  presetRecords,
  seedFakeDomain,
  switchToCds,
} from "./helpers/fake-dns-world";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let storageDir = "";
let n = 0;
const provider = fakeDnsProvider();
const saved = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  CDS_STAFF_ALERT_EMAIL: process.env.CDS_STAFF_ALERT_EMAIL,
};
const STAFF_TO = "staff-alerts@cds.test";

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-launch-review-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_STAFF_ALERT_EMAIL = STAFF_TO;
  resetDnsForTests();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await inst?.stop();
  rmSync(storageDir, { recursive: true, force: true });
});

const tag = () => randomBytes(4).toString("hex");

type Site = {
  org: string;
  owner: string;
  ownerEmail: string;
  admin: string;
  editor: string;
  pages: string[];
  ctx: OrgContext;
  adminCtx: OrgContext;
  editorCtx: OrgContext;
};

const ctxFor = (
  org: string,
  actor: string,
  role: "owner" | "admin" | "editor",
  extra: { impersonator?: string } = {},
) =>
  mintOrgContext({
    orgId: org,
    actor,
    role,
    grants: [],
    ip: "1.1.1.1",
    ...extra,
  });

async function site(
  opts: { form?: boolean; confirmed?: boolean; stage?: string } = {},
): Promise<Site> {
  n += 1;
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Review ${n}`,
      slug: `review-${n}-${t}`,
      status: "active",
      stage: opts.stage ?? "ready_for_review",
    })
  ).id;
  await pb.collection("org_hosts").create({
    hostname: `review-${n}-${t}.sites.localhost`,
    organization: org,
    kind: "preview",
    primary: true,
  });
  const member = async (role: string) => {
    const password = randomBytes(18).toString("hex");
    const email = `${role}-${t}@cds.test`;
    const id = (
      await pb.collection("users").create({
        email,
        password,
        passwordConfirm: password,
        name: `${role} ${n}`,
      })
    ).id;
    await pb
      .collection("memberships")
      .create({ user: id, organization: org, role });
    return { id, email };
  };
  const owner = await member("owner");
  const admin = await member("admin");
  const editor = await member("editor");
  const pages: string[] = [];
  for (const [slug, title] of [
    ["home", "Home"],
    ["about", "About us"],
  ]) {
    pages.push(
      (
        await pb.collection("pages").create({
          organization: org,
          slug,
          title,
          status: "published",
          kind: "builder",
          published_at: "2026-10-01 10:00:00.000Z",
        })
      ).id,
    );
  }
  // A draft page is never in the review set.
  await pb.collection("pages").create({
    organization: org,
    slug: "draft",
    title: "Draft",
    status: "draft",
    kind: "builder",
  });
  await pb.collection("org_email_routes").create({
    organization: org,
    purpose: "default",
    address: `hello-${t}@example.com`,
    ...(opts.confirmed === false
      ? {}
      : { confirmed_at: "2026-10-02 10:00:00.000Z" }),
  });
  if (opts.form) {
    await pb
      .collection("forms")
      .create({ organization: org, name: "Contact", template: "contact" });
  }
  return {
    org,
    owner: owner.id,
    ownerEmail: owner.email,
    admin: admin.id,
    editor: editor.id,
    pages,
    ctx: ctxFor(org, owner.id, "owner"),
    adminCtx: ctxFor(org, admin.id, "admin"),
    editorCtx: ctxFor(org, editor.id, "editor"),
  };
}

const doneIds = async (ctx: OrgContext) =>
  (await launchReviewProgress(ctx)).items
    .filter((i) => i.done)
    .map((i) => i.id);

async function completeAll(s: Site): Promise<void> {
  for (const p of s.pages) await markPage(s.ctx, p, "looks_good");
  await markKeyFacts(s.ctx);
  await markPhoneCheck(s.ctx);
}

const dmarc = (d: string): DnsRecord => ({
  type: "TXT",
  name: `_dmarc.${d}`,
  value: "v=DMARC1; p=none",
  ttl: 3600,
});

async function prepareMove(s: Site): Promise<string> {
  const d = `review${n}-${tag()}.example`;
  await seedFakeDomain(d, "google", {
    oldZone: [...presetRecords(d, "google"), dmarc(d)],
  });
  const at = { now: new Date("2026-10-17T10:00:00.000Z") };
  const deps: MoveDeps = {
    provider,
    transport: captureTransport(),
    now: () => at.now,
  };
  const v = await startMove(
    s.ctx,
    s.org,
    { domain: d, kind: "launch", by: s.owner },
    deps,
  );
  await switchToCds(d);
  at.now = new Date(at.now.getTime() + 5 * 60_000);
  const p = await advanceMove(v.id, deps);
  expect(p.status).toBe("prepared");
  return d;
}

describe("marks and progress (14-33 Task 1)", () => {
  it("six items progress; a republish resets item 1; no form counts as tested", async () => {
    if (!inst) return;
    const s = await site();
    const start = await launchReviewProgress(s.ctx);
    expect(start.available).toBe(true);
    expect(start.total).toBe(6);
    expect(await doneIds(s.ctx)).toEqual([
      "changes_sent",
      "test_form",
      "no_open_requests",
    ]);

    const pages = await reviewPages(s.ctx);
    expect(pages.map((p) => [p.title, p.path, p.status])).toEqual([
      ["Home", "/", "not_looked"],
      ["About us", "/about", "not_looked"],
    ]);

    await markPage(s.ctx, s.pages[0]!, "looks_good");
    expect(await doneIds(s.ctx)).not.toContain("pages_reviewed");
    await markPage(s.ctx, s.pages[1]!, "looks_good");
    await markKeyFacts(s.ctx);
    await markPhoneCheck(s.ctx);
    const all = await launchReviewProgress(s.ctx);
    expect(all.done).toBe(6);

    // Upsert: marking again keeps one row per page.
    await markPage(s.ctx, s.pages[1]!, "looks_good");
    const rows = await pb.collection("launch_review_marks").getFullList({
      filter: pb.filter("organization = {:org} && kind = 'page'", {
        org: s.org,
      }),
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.by === s.owner && r.at)).toBe(true);

    // Audited with who.
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:org} && action = 'launch_review.marked'",
        { org: s.org },
      ),
    });
    expect(audit.length).toBeGreaterThanOrEqual(5);
    expect(audit.every((r) => r.actor === s.owner && !r.impersonator)).toBe(
      true,
    );

    // Republishing About us resets it (computed, the mark is untouched).
    await pb
      .collection("pages")
      .update(s.pages[1]!, { published_at: "2026-10-05 10:00:00.000Z" });
    expect(await doneIds(s.ctx)).not.toContain("pages_reviewed");
    expect((await reviewPages(s.ctx))[1]?.status).toBe("changed_since");
    const mark = await pb.collection("launch_review_marks").getFirstListItem(
      pb.filter("organization = {:org} && page = {:p}", {
        org: s.org,
        p: s.pages[1]!,
      }),
    );
    expect(mark.status).toBe("looks_good");
  });

  it("impersonating staff are refused; Admin and Editor read, never write", async () => {
    if (!inst) return;
    const s = await site();
    const imp = ctxFor(s.org, s.owner, "owner", { impersonator: s.admin });
    await expect(markPage(imp, s.pages[0]!, "looks_good")).rejects.toThrow(
      ImpersonationDenied,
    );
    await expect(markKeyFacts(imp)).rejects.toThrow(ImpersonationDenied);
    await expect(markPhoneCheck(imp)).rejects.toThrow(ImpersonationDenied);
    await expect(submitLaunchReview(imp)).rejects.toThrow(ImpersonationDenied);
    await expect(
      requestPageChange(imp, s.pages[0]!, "Please change the phone number."),
    ).rejects.toThrow(ImpersonationDenied);

    const view = await launchReviewView(s.adminCtx);
    expect(view.canAct).toBe(false);
    expect(view.total).toBe(6);
    expect((await launchReviewView(s.editorCtx)).pages).toHaveLength(2);
    expect((await launchReviewView(s.ctx)).canAct).toBe(true);
    await expect(
      markPage(s.adminCtx, s.pages[0]!, "looks_good"),
    ).rejects.toThrow(Forbidden);
    await expect(markPhoneCheck(s.editorCtx)).rejects.toThrow(Forbidden);
    expect(
      await pb.collection("launch_review_marks").getFullList({
        filter: pb.filter("organization = {:org}", { org: s.org }),
      }),
    ).toHaveLength(0);
  });

  it("key facts wait for a confirmed email; a test submission ticks the form item", async () => {
    if (!inst) return;
    const s = await site({ form: true, confirmed: false });
    await expect(markKeyFacts(s.ctx)).rejects.toThrow(
      /Confirm your email address first/,
    );
    expect(await doneIds(s.ctx)).not.toContain("test_form");

    const real = await pb
      .collection("form_submissions")
      .create({ organization: s.org, form_name: "Contact", data: {} });
    expect(await recordTestFormSubmission(s.org, real.id)).toBe(false);
    const other = await site();
    const test = await pb.collection("form_submissions").create({
      organization: s.org,
      form_name: "Contact",
      data: {},
      is_test: true,
    });
    // Another org's id never ticks it.
    expect(await recordTestFormSubmission(other.org, test.id)).toBe(false);
    expect(await recordTestFormSubmission(s.org, test.id)).toBe(true);
    expect(await doneIds(s.ctx)).toContain("test_form");
    const view = await launchReviewView(s.ctx);
    expect(view.hasForm).toBe(true);
    expect(view.emailConfirmed).toBe(false);
    expect(view.items.find((i) => i.id === "test_form")?.at).toBeTruthy();
  });

  it("the review token gives the owner's context until the membership changes", async () => {
    if (!inst) return;
    const s = await site();
    const token = signReviewToken(s.org, s.owner, "phone");
    const ctx = await reviewContextForToken(token, { ip: "9.9.9.9" });
    expect(ctx?.orgId).toBe(s.org);
    expect(ctx?.role).toBe("owner");
    expect(ctx?.impersonator).toBeUndefined();
    await markPhoneCheck(ctx!);
    expect(await doneIds(s.ctx)).toContain("phone_check");

    // An Admin's token is no owner context.
    expect(
      await reviewContextForToken(signReviewToken(s.org, s.admin, "review")),
    ).toBeNull();
    // Expired and junk.
    expect(
      await reviewContextForToken(token, { now: Date.now() + 61 * 60_000 }),
    ).toBeNull();
    expect(await reviewContextForToken("v1.junk")).toBeNull();

    const m = await pb.collection("memberships").getFirstListItem(
      pb.filter("user = {:u} && organization = {:o}", {
        u: s.owner,
        o: s.org,
      }),
    );
    await pb.collection("memberships").update(m.id, { role: "admin" });
    expect(await reviewContextForToken(token)).toBeNull();

    // A live site has no review.
    const live = await site({ stage: "live" });
    expect(
      await reviewContextForToken(
        signReviewToken(live.org, live.owner, "review"),
      ),
    ).toBeNull();
    expect((await launchReviewState(live.org)).available).toBe(false);
  });
});

describe("change requests and submission (14-33 Task 2)", () => {
  it("Needs a change files a change ticket on page:<id>", async () => {
    if (!inst) return;
    const s = await site();
    await expect(
      requestPageChange(s.ctx, s.pages[1]!, "too short"),
    ).rejects.toThrow(P14_COPY.NOTE_SHORT);
    const other = await site();
    await expect(
      requestPageChange(
        other.ctx,
        s.pages[1]!,
        "Change the phone number please.",
      ),
    ).rejects.toThrow(NotFound);

    const r = await requestPageChange(
      s.ctx,
      s.pages[1]!,
      "Change the phone number in the footer.",
    );
    expect(r.ticketNumber).toBeGreaterThan(0);
    const t = await pb.collection("support_threads").getFirstListItem(
      pb.filter("organization = {:org} && number = {:n}", {
        org: s.org,
        n: r.ticketNumber,
      }),
    );
    expect(t.type).toBe("change");
    expect(t.subject).toBe("Change on About us");
    expect(t.target).toMatchObject({ kind: "page", id: s.pages[1] });

    const view = await launchReviewView(s.ctx);
    expect(view.pages[1]?.status).toBe("needs_change");
    const item = (id: string) => view.items.find((i) => i.id === id);
    expect(item("changes_sent")).toMatchObject({ done: true, count: 1, of: 1 });
    expect(item("no_open_requests")).toMatchObject({ done: false, count: 1 });

    // A Needs-a-change mark without a sent note leaves item 2 open.
    await markPage(s.ctx, s.pages[0]!, "needs_change");
    expect(await doneIds(s.ctx)).not.toContain("changes_sent");
  });

  it("Ready to launch waits for six items and a prepared move, then mails owner and CDS", async () => {
    if (!inst) return;
    const s = await site();
    await expect(submitLaunchReview(s.ctx)).rejects.toThrow(
      "Finish 3 more items above.",
    );
    await completeAll(s);
    await expect(submitLaunchReview(s.ctx)).rejects.toThrow(DomainNotReady);
    await expect(submitLaunchReview(s.ctx)).rejects.toThrow(InvalidInput);

    const domain = await prepareMove(s);
    const before = await launchReviewView(s.ctx);
    expect(before.domainReady).toBe(true);
    expect(before.domain).toBe(domain);
    expect(before.submittedAt).toBeNull();

    const mail = captureTransport();
    const now = new Date("2026-10-17T12:00:00.000Z");
    const r = await submitLaunchReview(s.ctx, { now, transport: mail });
    expect(r.submittedAt).toBe(now.toISOString());
    expect(
      mail.sent.filter((m) => m.type === "review.sent").map((m) => m.to),
    ).toEqual([s.ownerEmail]);
    expect(
      mail.sent.filter((m) => m.type === "staff.domain_alert").map((m) => m.to),
    ).toEqual([STAFF_TO]);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:org} && action = 'launch_review.submitted'",
        { org: s.org },
      ),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor).toBe(s.owner);

    const sent = await launchReviewView(s.ctx);
    expect(sent.submittedAt).toBeTruthy();
    expect(sent.resubmitNeeded).toEqual([]);
    await pb
      .collection("pages")
      .update(s.pages[1]!, { published_at: "2026-10-18 10:00:00.000Z" });
    const changed = await launchReviewView(s.ctx);
    expect(changed.resubmitNeeded).toEqual(["About us"]);
    expect(changed.done).toBe(5);
  });
});
