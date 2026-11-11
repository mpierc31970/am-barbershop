// 12-28: the ticket staff CLIs (support:list, support:show, support:reply, support:open,
// support:sla) and staffSlaReport on the real PocketBase binary (SUPPORT-02, COMM-09, COMM-10,
// SUPPORT-03; D210; T-12-28-01..04). Sign-in and the y/N prompt are mocked (the announce-set
// test pattern): the staff context is a real minted support_agent context, so every db call,
// audit row and alert is real. `--help` also runs as a child process with no PB env.
import "@cds/addon-registry/server";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type PocketBase from "pocketbase";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PlatformContext } from "../src/context";
import { resetClientForTests, superuser } from "../src/client";
import { captureTransport } from "../src/email/transport";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import { LocalDiskStore } from "../src/storage/local-disk";
import {
  fileTicket,
  slaMonthOf,
  staffReplyToTicket,
  staffSlaReport,
} from "../src/support";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const h = vi.hoisted(() => ({
  ctx: null as unknown,
  signIn: 0,
  answer: "y",
  asked: [] as string[],
}));

vi.mock("../scripts/staff-cli", async (orig) => {
  const real = await orig<typeof import("../scripts/staff-cli")>();
  return {
    ...real,
    signInStaffInteractive: async () => {
      h.signIn++;
      return h.ctx;
    },
    ask: async (prompt: string) => {
      h.asked.push(prompt);
      return h.answer;
    },
  };
});

const list = await import("../scripts/support-list");
const show = await import("../scripts/support-show");
const sla = await import("../scripts/support-sla");
const reply = await import("../scripts/support-reply");
const open = await import("../scripts/support-open");

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const NODE_FLAGS = [
  "--experimental-strip-types",
  "--no-warnings=ExperimentalWarning",
  "--import",
  pathToFileURL(join(PKG_DIR, "scripts", "register-ts.mjs")).href,
];

function runChild(script: string, args: string[]) {
  const r = spawnSync(
    process.execPath,
    [...NODE_FLAGS, join(PKG_DIR, "scripts", script), ...args],
    {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, PB_URL: "", PB_SUPERUSER_EMAIL: "" },
    },
  );
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const AT = new Date("2026-10-12T15:00:00.000Z"); // Monday 10:00 Chicago

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let root: string;
let store: LocalDiskStore;
let out: string[] = [];

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: AT });
  await pb
    .collection("users")
    .update(s.staff.agentUser, { name: "Mara Lopez" });
  await pb.collection("users").update(s.A.users.editor, { name: "Dana Lee" });
  await pb
    .collection("organizations")
    .update(s.A.org, { name: "Rivera Bakery" });
  h.ctx = s.staff.agent;
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cds-support-cli-"));
  store = new LocalDiskStore(root);
  resetSupportLimitsForTests();
  h.signIn = 0;
  h.answer = "y";
  h.asked = [];
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function file(
  subject: string,
  org: "A" | "B" = "A",
  type: "problem" | "change" | "question" = "problem",
): Promise<number> {
  const r = await fileTicket(
    s[org].ctx.editor,
    { type, subject, body: "The menu photo looks blurry." },
    { clock: { now: () => AT } },
  );
  return r.number;
}

async function threadOf(number: number) {
  return pb
    .collection("support_threads")
    .getFirstListItem(pb.filter("number = {:n}", { n: number }));
}

describe("--help and argument checks (child process, no PB env)", () => {
  it.each([
    ["support-list.ts", "support:list"],
    ["support-show.ts", "support:show"],
    ["support-sla.ts", "support:sla"],
    ["support-reply.ts", "support:reply"],
    ["support-open.ts", "support:open"],
  ])("%s --help exits 0", (script, name) => {
    const r = runChild(script, ["--help"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain(name);
  });

  it("support:list rejects a bad --status before sign-in", () => {
    const r = runChild("support-list.ts", ["--status", "stuck"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("--status must be");
  });
});

describe("support:list (choice 2)", () => {
  it("--help prints USAGE without signing in; an invalid --status fails before sign-in", async () => {
    await list.main(["--help"]);
    expect(out.join("\n")).toContain("support:list");
    await expect(list.main(["--status", "stuck"])).rejects.toThrow(
      "--status must be",
    );
    await expect(list.main(["--sla", "late"])).rejects.toThrow(
      "--sla must be at-risk or missed",
    );
    expect(h.signIn).toBe(0);
  });

  it("--dry-run reads nothing and signs nobody in", async () => {
    await list.main(["--dry-run"]);
    expect(out.at(-1)).toContain("DRY RUN");
    expect(h.signIn).toBe(0);
  });

  it("lists tickets with type, status, age, SLA and the footer", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Menu photo is blurry");
    const now = new Date(AT.getTime() + 4 * 3_600_000);
    await list.main(["--org", s.A.org, "--status", "open"], () => now);
    const text = out.join("\n");
    const lines = text.split("\n");
    expect(lines[0]).toMatch(
      /^#\s+Org\s+Type\s+Status\s+Age\s+SLA\s+Assignee$/,
    );
    const row = lines.find((l) => l.startsWith(String(n)));
    expect(row).toMatch(/Rivera Bakery\s+Problem\s+Open/);
    expect(row).toContain("due in");
    expect(text).toMatch(/\d+ tickets? · \d+ at risk · \d+ missed$/);
    expect(h.signIn).toBe(1);
  });
});

describe("support:show (choice 3)", () => {
  it("prints the header, the thread in order and [internal] before an internal note", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Contact form \u001b[2Jbroken");
    await staffReplyToTicket(
      s.staff.agent,
      {
        number: n,
        body: "Checked the logs; form handler times out.",
        internal: true,
      },
      { store, clock: { now: () => new Date(AT.getTime() + 60_000) } },
    );
    await show.main(["--ticket", `#${n}`], { store, now: () => AT });
    const text = out.join("\n");
    expect(out[0]).toBe(`Ticket #${n} · Contact form ?[2Jbroken`);
    expect(text).toContain("Org:        Rivera Bakery");
    expect(text).toContain("Opened by:  Dana Lee");
    const internal = out.findIndex((l) => l.startsWith("[internal] "));
    expect(internal).toBeGreaterThan(0);
    expect(out[internal]).toContain("Mara · CDS");
    expect(out[internal + 1]).toBe(
      "  Checked the logs; form handler times out.",
    );
    expect(text).not.toContain("\u001b");
  });

  it("an unknown ticket is a plain refusal", async (t) => {
    if (!inst) return t.skip();
    await expect(show.main(["--ticket", "999999"], { store })).rejects.toThrow(
      "Ticket #999999 not found, or this account can't read support tickets.",
    );
  });

  it("--download saves an attachment (staff file) and never overwrites", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Need the before and after");
    await staffReplyToTicket(
      s.staff.agent,
      {
        number: n,
        body: "Here is the proof.",
        files: [
          {
            name: "proof.txt",
            bytes: new TextEncoder().encode("before/after"),
          },
        ],
      },
      { store, clock: { now: () => AT } },
    );
    const row = (
      await pb.collection("support_files").getFullList({
        filter: pb.filter("thread = {:t}", { t: (await threadOf(n)).id }),
      })
    )[0]!;
    await show.main(["--ticket", String(n)], { store });
    expect(out.join("\n")).toContain(
      `Attachment: proof.txt (12 B, CDS file) id ${row.id}`,
    );
    const target = join(root, "saved.txt");
    out = [];
    await show.main(
      ["--ticket", String(n), "--download", row.id, "--out", target],
      { store },
    );
    expect(await readFile(target, "utf8")).toBe("before/after");
    expect(out.at(-1)).toContain("Saved proof.txt");
    await expect(
      show.main(
        ["--ticket", String(n), "--download", row.id, "--out", target],
        { store },
      ),
    ).rejects.toThrow("already exists");
  });
});

describe("staffSlaReport and support:sla (choice 6)", () => {
  it("counts 2 met and 1 missed with the missed number and lateness", async (t) => {
    if (!inst) return t.skip();
    const nums = [
      await file("One", "B"),
      await file("Two", "B", "question"),
      await file("Three", "B"),
    ];
    // A Change request carries no SLA and is not counted.
    await file("Not counted", "B", "change");
    const rows = await Promise.all(nums.map(threadOf));
    const due = Date.parse(
      String(rows[0]!.first_reply_due_at).replace(" ", "T"),
    );
    const iso = (ms: number) => new Date(ms).toISOString();
    await pb.collection("support_threads").update(rows[0]!.id, {
      first_replied_at: iso(due - 3_600_000),
    });
    await pb.collection("support_threads").update(rows[1]!.id, {
      first_replied_at: iso(due - 60_000),
    });
    await pb.collection("support_threads").update(rows[2]!.id, {
      first_replied_at: iso(due + 3 * 3_600_000),
    });
    const now = new Date();
    const month = slaMonthOf(now);
    const r = await staffSlaReport(s.staff.agent, {
      month,
      orgId: s.B.org,
      now,
    });
    expect(r.met).toBe(2);
    expect(r.missed).toBe(1);
    expect(r.firstReplies).toBe(3);
    expect(r.missedTickets.map((m) => m.number)).toEqual([nums[2]]);

    await sla.main(["--month", month, "--org", s.B.org], () => now);
    expect(out[0]).toMatch(
      new RegExp(
        `^\\w+ \\d{4} · first replies 3 · met 2 · missed 1 \\(#${nums[2]}, 3h late\\)$`,
      ),
    );
  });

  it("a ticket solved before it was due with no reply is not a miss (12-REVIEW WR-A08)", async (t) => {
    if (!inst) return t.skip();
    const now = new Date();
    const month = slaMonthOf(now);
    const before = await staffSlaReport(s.staff.agent, {
      month,
      orgId: s.B.org,
      now,
    });
    const early = await threadOf(await file("Solved early", "B"));
    const late = await threadOf(await file("Solved late", "B"));
    const iso = (ms: number) => new Date(ms).toISOString();
    // Due in the past for both, so neither is "waiting".
    for (const row of [early, late]) {
      await pb.collection("support_threads").update(row.id, {
        first_reply_due_at: iso(now.getTime() - 4 * 3_600_000),
      });
    }
    const shiftedDue = now.getTime() - 4 * 3_600_000;
    await pb.collection("support_threads").update(early.id, {
      status: "resolved",
      resolved_at: iso(shiftedDue - 3_600_000),
    });
    await pb.collection("support_threads").update(late.id, {
      status: "closed",
      closed_at: iso(shiftedDue + 3_600_000),
    });
    const after = await staffSlaReport(s.staff.agent, {
      month,
      orgId: s.B.org,
      now,
    });
    expect(after.missed).toBe(before.missed + 1);
    expect(after.firstReplies).toBe(before.firstReplies + 1);
    const miss = after.missedTickets.find((m) => m.number === late.number)!;
    expect(miss.answered).toBe(false);
    expect(after.missedTickets.some((m) => m.number === early.number)).toBe(
      false,
    );
  });

  it("a bad --month fails before sign-in; another month is empty", async (t) => {
    await expect(sla.main(["--month", "2026-13"])).rejects.toThrow(
      "--month must look like 2026-10",
    );
    expect(h.signIn).toBe(0);
    if (!inst) return t.skip();
    const r = await staffSlaReport(s.staff.agent, {
      month: "2001-01",
      orgId: s.B.org,
    });
    expect(r).toMatchObject({ firstReplies: 0, met: 0, missed: 0 });
  });

  it("refuses a context without support_read", async (t) => {
    if (!inst) return t.skip();
    const nobody = { ...(s.staff.agent as PlatformContext), staffRole: "" };
    await expect(
      staffSlaReport(nobody as PlatformContext, { month: "2026-10" }),
    ).rejects.toThrow();
  });
});

describe("support:reply (choice 4)", () => {
  it("--help, a bad --priority and --paid with --status fail before sign-in", async () => {
    await reply.main(["--help"]);
    expect(out.join("\n")).toContain("support:reply");
    await expect(
      reply.main(["--ticket", "1042", "--body", "Hi", "--priority", "asap"]),
    ).rejects.toThrow("--priority must be");
    await expect(
      reply.main(["--ticket", "1042", "--paid", "design", "--status", "open"]),
    ).rejects.toThrow("leave out --status");
    await expect(reply.main(["--ticket", "1042"])).rejects.toThrow(
      "nothing to send",
    );
    expect(h.signIn).toBe(0);
  });

  it("--dry-run prints the preview as the owner sees it and changes nothing", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Dry run ticket");
    const transport = captureTransport();
    const tid = (await threadOf(n)).id;
    const before = await pb.collection("support_messages").getFullList({
      filter: pb.filter("thread = {:t}", { t: tid }),
    });
    await reply.main(
      [
        "--ticket",
        String(n),
        "--body",
        "Can you send the original photo?",
        "--status",
        "waiting",
        "--dry-run",
      ],
      { store, transport, now: () => AT },
    );
    const text = out.join("\n");
    expect(text).toContain("Reply as the owner will see it:");
    expect(text).toContain("  Mara · CDS");
    expect(text).toContain("Status:     Open → Waiting on you");
    expect(text).toContain(
      "Recipients: the person who filed it, Owners and Admins",
    );
    expect(out.at(-1)).toBe("DRY RUN would send this; nothing changed");
    expect(h.asked).toEqual([]);
    const after = await pb.collection("support_messages").getFullList({
      filter: pb.filter("thread = {:t}", { t: tid }),
    });
    expect(after.length).toBe(before.length);
    expect(transport.sent).toEqual([]);
  });

  it("answering n at Send? changes nothing; --yes sends, alerts and audits with the staff actor", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Answer me");
    const transport = captureTransport();
    const thread = await threadOf(n);
    h.answer = "n";
    await reply.main(
      ["--ticket", String(n), "--body", "On it.", "--status", "in_progress"],
      { store, transport, now: () => AT },
    );
    expect(h.asked).toEqual(["Send? [y/N] "]);
    expect(out.at(-1)).toBe("Nothing changed.");
    expect((await threadOf(n)).status).toBe("open");
    expect(transport.sent).toEqual([]);

    out = [];
    h.asked = [];
    const body = join(root, "reply.md");
    await writeFile(body, "Fixed the photo.\r\nTake a look.");
    await reply.main(
      [
        "--ticket",
        String(n),
        "--body-file",
        body,
        "--status",
        "waiting",
        "--priority",
        "high",
        "--assign",
        "me",
        "--yes",
      ],
      { store, transport, now: () => AT },
    );
    expect(h.asked).toEqual([]);
    expect(out.at(-1)).toMatch(
      /^Sent\. Rivera Bakery sees it in the hub; [1-9]\d* alerts? raised\.$/,
    );
    const after = await threadOf(n);
    expect(after.status).toBe("waiting_on_you");
    expect(after.priority).toBe("high");
    expect(after.assignee).toBe(s.staff.agentUser);
    expect(transport.sent.length).toBeGreaterThan(0);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'support.staff_reply' && target_id = {:t}", {
        t: thread.id,
      }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor).toBe(s.staff.agentUser);
  });

  it("--internal saves a note, prints the internal line and raises no alert", async (t) => {
    if (!inst) return t.skip();
    const n = await file("Internal only");
    const transport = captureTransport();
    await reply.main(
      [
        "--ticket",
        String(n),
        "--body",
        "Looks like a caching issue.",
        "--internal",
        "--yes",
      ],
      { store, transport, now: () => AT },
    );
    expect(out.join("\n")).toContain(
      "Internal note (CDS staff only; the owner never sees it):",
    );
    expect(out.at(-1)).toBe(
      "Saved as an internal note. The owner never sees it.",
    );
    expect(transport.sent).toEqual([]);
    const bell = await pb.collection("alerts").getFullList({
      filter: pb.filter("source_key = {:k}", { k: `support:ticket:${n}` }),
    });
    expect(bell).toEqual([]);
  });

  it("--paid marks a Change request and refuses a Problem before sending", async (t) => {
    if (!inst) return t.skip();
    const problem = await file("Not a change");
    await expect(
      reply.main(["--ticket", String(problem), "--paid", "design", "--yes"], {
        store,
        now: () => AT,
      }),
    ).rejects.toThrow("only a Change request can be a paid service");

    const n = await file("New hero image", "A", "change");
    const transport = captureTransport();
    await reply.main(
      [
        "--ticket",
        String(n),
        "--body",
        "This is design work; here are your options.",
        "--paid",
        "design",
        "--yes",
      ],
      { store, transport, now: () => AT },
    );
    expect(out.join("\n")).toContain("Paid:       Design changes");
    const after = await threadOf(n);
    expect(after.status).toBe("waiting_on_you");
    expect((after.paid_service as { category: string }).category).toBe(
      "design",
    );
    expect(out.at(-1)).toMatch(/^Sent\. Rivera Bakery sees it in the hub;/);
  });

  it("--file attaches staff files; a refused type fails before sign-in", async (t) => {
    const bad = join(root, "evil.png");
    await writeFile(bad, "not really a png");
    await expect(
      reply.main(["--ticket", "1042", "--body", "Hi", "--file", bad]),
    ).rejects.toThrow("name and content must agree");
    expect(h.signIn).toBe(0);
    if (!inst) return t.skip();
    const n = await file("Want a file");
    const a = join(root, "notes.txt");
    const b = join(root, "data.csv");
    await writeFile(a, "first");
    await writeFile(b, "a,b\n1,2\n");
    await reply.main(
      [
        "--ticket",
        String(n),
        "--body",
        "Two files.",
        "--file",
        a,
        `--file=${b}`,
        "--yes",
      ],
      { store, now: () => AT },
    );
    const files = await pb.collection("support_files").getFullList({
      filter: pb.filter("thread = {:t}", { t: (await threadOf(n)).id }),
    });
    expect(files.map((f) => f.name).sort()).toEqual(["data.csv", "notes.txt"]);
    expect(files.every((f) => f.scan === "staff")).toBe(true);
  });
});

describe("support:open (choice 5)", () => {
  const ORG = "abcdefghijklmno";
  it("checks arguments before sign-in", async () => {
    await expect(
      open.main(["--org", "bad", "--type", "change", "--subject", "x"]),
    ).rejects.toThrow("--org is not a valid organization id");
    await expect(
      open.main(["--org", ORG, "--type", "suggestion", "--subject", "x"]),
    ).rejects.toThrow("--type must be");
    await expect(
      open.main([
        "--org",
        ORG,
        "--type",
        "change",
        "--subject",
        "x".repeat(81),
        "--body",
        "y",
      ]),
    ).rejects.toThrow("--subject must be 1-80 characters");
    await expect(
      open.main(["--org", ORG, "--type", "change", "--subject", "x"]),
    ).rejects.toThrow("--body-file <md> is required");
    expect(h.signIn).toBe(0);
  });

  it("prints Opened by CDS and the new number; the ticket is answered and audited", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    await open.main(
      [
        "--org",
        s.A.org,
        "--type",
        "change",
        "--subject",
        "Your hours banner is out of date",
        "--body",
        "We noticed the holiday hours are still up.",
        "--target",
        `page:${s.A.livePage}`,
      ],
      { store, transport, now: () => AT },
    );
    expect(h.asked).toEqual(["Open? [y/N] "]);
    const m =
      /^Ticket #(\d+) opened for Rivera Bakery \(Opened by CDS\)\. Already answered for SLA\.$/.exec(
        out.at(-1)!,
      );
    expect(m).not.toBeNull();
    const row = await threadOf(Number(m![1]));
    expect(row.opened_by_cds).toBe(true);
    expect(row.first_replied_at).not.toBe("");
    expect((row.target as { kind: string }).kind).toBe("page");
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'support.ticket_opened_by_cds' && target_id = {:t}",
        { t: row.id },
      ),
    });
    expect(audit[0]?.actor).toBe(s.staff.agentUser);
  });

  it("--dry-run and answering n open nothing", async (t) => {
    if (!inst) return t.skip();
    const count = async () =>
      (
        await pb.collection("support_threads").getFullList({
          filter: pb.filter("organization = {:o}", { o: s.A.org }),
        })
      ).length;
    const before = await count();
    const args = [
      "--org",
      s.A.org,
      "--type",
      "question",
      "--subject",
      "Checking in",
      "--body",
      "Anything we can help with?",
    ];
    await open.main([...args, "--dry-run"], { store, now: () => AT });
    expect(out.at(-1)).toBe("DRY RUN would open this ticket; nothing changed");
    h.answer = "n";
    await open.main(args, { store, now: () => AT });
    expect(out.at(-1)).toBe("Nothing changed.");
    expect(await count()).toBe(before);
  });
});
