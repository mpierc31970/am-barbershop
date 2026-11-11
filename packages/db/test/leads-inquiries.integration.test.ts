// Hub /contact inquiries as staff leads (15-07; HUB-07, A3-Q2). Against a throwaway
// PocketBase: an inquiry is listed by listLeads with kind "inquiry" (topic · about as status,
// never the message), the summary line counts it, `since` applies to it, and staffInquiryLeads
// masks its email. PocketBase stamps `created` itself, so the retention checks (15-07 Task 2)
// run the job on a clock moved forward.
import "@cds/addon-registry/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { superuser } from "../src/client";
import type { PlatformContext } from "../src/context";
import { leadsSummaryLine, listLeads } from "../src/leads";
import { runRetentionJob, type RetentionJobDeps } from "../src/jobs/retention";
import { staffInquiryLeads } from "../src/staff/pipeline";
import { LocalDiskStore } from "../src/storage/local-disk";
import { bootSeededPb, staffContext, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
let admin: PlatformContext;
let inquiryId = "";
let created = new Date(0);
let dir = "";
const DAY_MS = 86_400_000;

describe("hub inquiries as leads (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
    if (!booted) return;
    admin = await staffContext(
      booted.inst,
      "inq-leads-admin@cds.test",
      "super_admin",
    );
    const pb = await superuser();
    const row = await pb.collection("hub_inquiries").create({
      name: "Dana Glow",
      email: "dana@glow.test",
      business: "Glow Salon",
      topic: "call",
      phone: "",
      about: "Salon owner",
      message: "SECRET MESSAGE BODY",
    });
    inquiryId = row.id;
    created = new Date(String(row.created).replace(" ", "T"));
  });
  afterAll(async () => {
    await booted?.inst.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("listLeads includes the inquiry with kind inquiry, never the message", async (t) => {
    if (!booted) return t.skip();
    const leads = await listLeads(admin);
    const lead = leads.find((l) => l.id === inquiryId);
    expect(lead).toMatchObject({
      kind: "inquiry",
      email: "dana@glow.test",
      path: "",
      businessType: "Glow Salon",
      items: 0,
      status: "Book a call · Salon owner",
      assembled: "-",
      name: "Dana Glow",
      business: "Glow Salon",
    });
    expect(JSON.stringify(leads)).not.toContain("SECRET MESSAGE BODY");
    expect(leadsSummaryLine(leads)).toContain(", 1 inquiry");
  });

  it("`since` applies to inquiries", async (t) => {
    if (!booted) return t.skip();
    const later = new Date(created.getTime() + 60_000);
    const leads = await listLeads(admin, { since: later });
    expect(leads.find((l) => l.id === inquiryId)).toBeUndefined();
    const earlier = new Date(created.getTime() - 60_000);
    expect(
      (await listLeads(admin, { since: earlier })).some(
        (l) => l.id === inquiryId,
      ),
    ).toBe(true);
  });

  it("staffInquiryLeads masks the email and carries the topic word", async (t) => {
    if (!booted) return t.skip();
    const rows = await staffInquiryLeads(admin, { since: "all" });
    const row = rows.find((r) => r.id === inquiryId);
    expect(row).toMatchObject({
      business: "Glow Salon",
      topicLabel: "Book a call",
      emailMasked: "d•••@glow.test",
    });
    expect(JSON.stringify(rows)).not.toContain("dana@glow.test");
  });

  it("retention: a dry run at 731 days counts the inquiry and deletes nothing; a real run deletes it", async (t) => {
    if (!booted) return t.skip();
    dir = await mkdtemp(join(tmpdir(), "cds-inq-retention-"));
    const store = new LocalDiskStore(join(dir, "private"));
    const deps: RetentionJobDeps = {
      privateStore: store,
      publicStore: new LocalDiskStore(join(dir, "public")),
      agreementStore: store,
    };
    const pb = await superuser();
    const at = (days: number) => new Date(created.getTime() + days * DAY_MS);

    const early = await runRetentionJob({ now: at(729), dryRun: true, deps });
    expect(early.hubInquiriesDeleted).toBe(0);

    const dry = await runRetentionJob({ now: at(731), dryRun: true, deps });
    expect(dry.hubInquiriesDeleted).toBe(1);
    expect(dry.failedSteps).not.toContain("hub-inquiries");
    expect((await pb.collection("hub_inquiries").getOne(inquiryId)).id).toBe(
      inquiryId,
    );

    const real = await runRetentionJob({ now: at(731), deps });
    expect(real.hubInquiriesDeleted).toBe(1);
    expect(real.failedSteps).not.toContain("hub-inquiries");
    await expect(
      pb.collection("hub_inquiries").getOne(inquiryId),
    ).rejects.toThrow();
  });
});
