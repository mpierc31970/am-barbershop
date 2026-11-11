// 12-30: the remaining staff CLIs (cds:post, service:window, incident:run, ideas:run) on the
// real PocketBase binary (COMM-02, COMM-04, COMM-11, COMM-12, CUSTOM-01; T-12-30-01..03).
// Sign-in and the y/N prompt are mocked (the 12-28 pattern): the staff context is a real minted
// support_agent or super_admin context, so every db call, audit row and alert is real.
// `--help` also runs as a child process with no PB env.
import "@cds/addon-registry/server";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
import { resetClientForTests, superuser } from "../src/client";
import { captureTransport } from "../src/email/transport";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import { keywordScanner } from "../src/content/scan-standin";
import { LocalDiskStore } from "../src/storage/local-disk";
import { fileTicket, submitIdea, toggleIdeaVote } from "../src/support";
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

const post = await import("../scripts/cds-post");
const win = await import("../scripts/service-window");
const inc = await import("../scripts/incident-run");
const ideas = await import("../scripts/ideas-run");

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
  await pb
    .collection("organizations")
    .update(s.A.org, { name: "Rivera Bakery" });
  await pb.collection("pages").update(s.A.livePage, { title: "About us" });
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cds-support-cli-2-"));
  store = new LocalDiskStore(root);
  resetSupportLimitsForTests();
  h.ctx = s?.staff.agent ?? null;
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

describe("--help (child process, no PB env)", () => {
  it.each([
    ["cds-post.ts", ["--help"], "cds:post"],
    ["service-window.ts", ["--help"], "service:window"],
    ["incident-run.ts", ["--help"], "incident:run"],
    ["ideas-run.ts", ["--help"], "ideas:run"],
  ])("%s --help exits 0", (script, args, name) => {
    const r = runChild(script, args);
    expect(r.status).toBe(0);
    expect(r.output).toContain(name);
  });

  it("an unknown verb prints USAGE and exits 1", () => {
    const r = runChild("ideas-run.ts", ["vote"]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("ideas:run - curate");
    expect(r.output).toContain("unknown verb vote");
  });
});

describe("cds:post (choice 2)", () => {
  it("checks arguments before sign-in", async () => {
    await expect(post.main(["--note", "Hi", "--title", "T"])).rejects.toThrow(
      "--org <org-id> is required",
    );
    await expect(
      post.main(["--org", "a".repeat(15), "--note", "Hi"]),
    ).rejects.toThrow("--title");
    await expect(
      post.main(["--org", "a".repeat(15), "--message", "Hi", "--note", "x"]),
    ).rejects.toThrow("exactly one of");
    await expect(
      post.main(["--org", "a".repeat(15), "--message", "Hi", "--pin"]),
    ).rejects.toThrow("--pin goes with --note");
    expect(h.signIn).toBe(0);
  });

  it("--note --pin --dry-run changes nothing; --yes posts a pinned note and prints the people count", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    const args = [
      "--org",
      s.A.org,
      "--note",
      "Your new menu page goes live Friday.",
      "--title",
      "Menu launch",
      "--pin",
    ];
    await post.main([...args, "--dry-run"], { transport, now: () => AT });
    const text = out.join("\n");
    expect(text).toContain(
      "Pinned note to Rivera Bakery, as the owner will see it:",
    );
    expect(text).toContain("  Menu launch");
    expect(out.at(-1)).toBe("DRY RUN would post this; nothing changed");
    const none = await pb.collection("cds_notes").getFullList({
      filter: pb.filter("organization = {:o}", { o: s.A.org }),
    });
    expect(none).toHaveLength(0);
    expect(transport.sent).toEqual([]);

    out = [];
    await post.main([...args, "--yes"], { transport, now: () => AT });
    expect(h.asked).toEqual([]);
    expect(out.at(-1)).toMatch(
      /^Posted\. Bell and email \(logged\) for [1-9]\d* (person|people)\.$/,
    );
    const notes = await pb.collection("cds_notes").getFullList({
      filter: pb.filter("organization = {:o}", { o: s.A.org }),
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.pinned).toBe(true);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'support.note_posted' && organization = {:o}",
        {
          o: s.A.org,
        },
      ),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor).toBe(s.staff.agentUser);
  });

  it("a message asks Post? and n changes nothing; a document is shared", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    h.answer = "n";
    await post.main(["--org", s.B.org, "--message", "Hello from CDS"], {
      transport,
      store,
      now: () => AT,
    });
    expect(h.asked).toEqual(["Post? [y/N] "]);
    expect(out.at(-1)).toBe("Nothing changed.");
    expect(
      await pb.collection("support_messages").getFullList({
        filter: pb.filter("organization = {:o}", { o: s.B.org }),
      }),
    ).toHaveLength(0);

    out = [];
    const { writeFile } = await import("node:fs/promises");
    const path = join(root, "brief.txt");
    await writeFile(path, "Launch checklist\n");
    await post.main(
      [
        "--org",
        s.B.org,
        "--document",
        path,
        "--title",
        "Launch checklist",
        "--yes",
      ],
      { transport, store, now: () => AT },
    );
    expect(out.join("\n")).toContain("File: brief.txt");
    expect(out.at(-1)).toMatch(/^Posted\. /);
    const docs = await pb.collection("cds_documents").getFullList({
      filter: pb.filter("organization = {:o}", { o: s.B.org }),
    });
    expect(docs).toHaveLength(1);
  });

  it("an unknown org is refused in plain words", async (t) => {
    if (!inst) return t.skip();
    await expect(
      post.main(["--org", "z".repeat(15), "--message", "Hi", "--yes"]),
    ).rejects.toThrow("not found, or this account can't post to sites.");
  });
});

describe("service:window (choice 3)", () => {
  it("checks arguments before sign-in", async () => {
    await expect(win.main(["create", "--scope", "galaxy"])).rejects.toThrow(
      "--scope must be",
    );
    await expect(
      win.main(["create", "--scope", "page", "--org", "a".repeat(15)]),
    ).rejects.toThrow("--scope page needs --page");
    await expect(win.main(["clear", "--id", "12"])).rejects.toThrow(
      "window code such as W-12",
    );
    expect(h.signIn).toBe(0);
  });

  it("a platform window as support_agent is refused with the D100 sentence", async (t) => {
    if (!inst) return t.skip();
    await expect(
      win.main(
        [
          "create",
          "--scope",
          "platform",
          "--until",
          "16:00",
          "--message",
          "Upgrading the server.",
          "--yes",
        ],
        { now: () => AT, addons: [] },
      ),
    ).rejects.toThrow("Refused: platform and add-on windows need super_admin.");
    const rows = await pb.collection("service_windows").getFullList();
    expect(rows.filter((r) => r.scope === "platform")).toHaveLength(0);
  });

  it("as super_admin a platform window prints W-n and alerts", async (t) => {
    if (!inst) return t.skip();
    h.ctx = s.staff.superAdmin;
    const transport = captureTransport();
    await win.main(
      [
        "create",
        "--scope",
        "platform",
        "--until",
        "16:00",
        "--message",
        "Upgrading the server.",
        "--yes",
      ],
      { now: () => AT, addons: [], transport },
    );
    const text = out.join("\n");
    expect(text).toMatch(
      /Window W-\d+ · all sites · now → 4:00 pm America\/Chicago · editing paused for the owners\./,
    );
    expect(text).toMatch(/[1-9]\d* alerts? raised\./);
  });

  it("a page window prints the business, page and time; clear sets cleared_at", async (t) => {
    if (!inst) return t.skip();
    await win.main(
      [
        "create",
        "--scope",
        "page",
        "--org",
        s.A.org,
        "--page",
        s.A.livePage,
        "--until",
        "16:00",
        "--message",
        "Fixing the photo gallery.",
      ],
      { now: () => AT, addons: [] },
    );
    expect(h.asked).toEqual(["Create? [y/N] "]);
    const line = out.find((l) => l.startsWith("Window W-"));
    expect(line).toMatch(
      /^Window W-\d+ · Rivera Bakery · page "About us" · now → 4:00 pm America\/Chicago · editing paused for the owner\.$/,
    );
    const code = /W-\d+/.exec(line!)![0];

    out = [];
    await win.main(["list"], { now: () => AT, addons: [] });
    expect(out.join("\n")).toContain(code);

    out = [];
    await win.main(["clear", "--id", code], {
      now: () => new Date(AT.getTime() + 60_000),
      addons: [],
    });
    expect(out.at(-1)).toBe(
      `Cleared ${code}. Editing is back on; the notice is gone.`,
    );
    const row = await pb
      .collection("service_windows")
      .getFirstListItem(pb.filter("seq = {:n}", { n: Number(code.slice(2)) }));
    expect(row.cleared_at).not.toBe("");
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "action = 'platform.service_window_cleared' && target_id = {:t}",
        { t: row.id },
      ),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor).toBe(s.staff.agentUser);
  });
});

describe("incident:run (choice 4)", () => {
  it("open → I-n; link a ticket; resolve prints the moved count", async (t) => {
    if (!inst) return t.skip();
    const transport = captureTransport();
    await inc.main([
      "open",
      "--title",
      "Email delays",
      "--public",
      "Some emails from your site are arriving late. We're on it.",
    ]);
    const opened = out.at(-1)!;
    expect(opened).toMatch(/^Opened I-\d+\. /);
    const code = /I-\d+/.exec(opened)![0];

    const ticket = await fileTicket(
      s.A.ctx.editor,
      { type: "problem", subject: "Emails late", body: "Contact emails late." },
      { clock: { now: () => AT } },
    );
    out = [];
    await inc.main([
      "link",
      "--incident",
      code,
      "--ticket",
      String(ticket.number),
    ]);
    expect(out.at(-1)).toBe(
      `Linked #${ticket.number} (Rivera Bakery) to ${code}. The owner sees "Linked to a known problem" and the public text.`,
    );

    out = [];
    await inc.main(["resolve", "--incident", code, "--message", "Fixed now."], {
      transport,
      now: () => AT,
    });
    expect(h.asked).toEqual(["Resolve? [y/N] "]);
    expect(out.at(-1)).toBe(
      `Resolved ${code}. 1 linked ticket moved to Resolved, 1 alert raised.`,
    );
    const thread = await pb
      .collection("support_threads")
      .getFirstListItem(pb.filter("number = {:n}", { n: ticket.number }));
    expect(thread.status).toBe("resolved");

    out = [];
    await inc.main(["list", "--all"]);
    expect(out.join("\n")).toContain(code);
  });

  it("an unknown verb prints USAGE and fails", async () => {
    await expect(inc.main(["close"])).rejects.toThrow("unknown verb close");
    expect(out.join("\n")).toContain("incident:run - known problems");
  });
});

describe("ideas:run (choice 5)", () => {
  it("merge prints the vote union line; status built prints the alerted count; hide and edit", async (t) => {
    if (!inst) return t.skip();
    const clock = { now: () => AT };
    const scanner = { scan: keywordScanner.scan.bind(keywordScanner) };
    const x = await submitIdea(
      s.A.ctx.editor,
      { title: "Gift card store", description: "Sell gift cards online." },
      { clock, scanner },
    );
    const y = await submitIdea(
      s.B.ctx.editor,
      { title: "Gift cards", description: "Let customers buy gift cards." },
      { clock, scanner },
    );
    // Org A votes for Y too, so one site voted for both.
    await toggleIdeaVote(s.A.ctx.editor, y.ideaId);

    await ideas.main(["list"]);
    expect(out.join("\n")).toContain("Gift card store");

    out = [];
    await ideas.main(["merge", "--idea", x.ideaId, "--into", y.ideaId]);
    expect(h.asked).toEqual(["Merge? [y/N] "]);
    expect(out.at(-1)).toBe(
      'Merged "Gift card store" into "Gift cards" · votes 1 + 2 → 2 (1 site voted for both).',
    );

    out = [];
    const transport = captureTransport();
    await ideas.main(["status", "--idea", y.ideaId, "--to", "built", "--yes"], {
      transport,
      now: () => AT,
    });
    expect(out.at(-1)).toMatch(
      /^"Gift cards" is now Built · [0-9]+ suggestion tickets? resolved · 2 voting sites alerted\.$/,
    );

    out = [];
    await ideas.main(["hide", "--idea", y.ideaId]);
    expect(out.at(-1)).toBe(
      'Hidden "Gift cards". It is off the board and keeps its votes.',
    );
    out = [];
    await ideas.main([
      "edit",
      "--idea",
      y.ideaId,
      "--title",
      "Gift cards online",
    ]);
    expect(out.at(-1)).toBe("Saved: title changed.");
    const row = await pb.collection("feature_ideas").getOne(y.ideaId);
    expect(row.title).toBe("Gift cards online");
    const audit = await pb.collection("audit_log").getFullList({
      filter: "action ~ 'support.idea_'",
    });
    expect(audit.some((a) => a.actor === s.staff.agentUser)).toBe(true);
  });

  it("an unknown verb prints USAGE and fails before sign-in", async () => {
    await expect(ideas.main(["vote"])).rejects.toThrow("unknown verb vote");
    expect(out.join("\n")).toContain("ideas:run - curate");
    await expect(
      ideas.main(["status", "--idea", "a".repeat(15), "--to", "done"]),
    ).rejects.toThrow("--to must be");
    expect(h.signIn).toBe(0);
  });
});
