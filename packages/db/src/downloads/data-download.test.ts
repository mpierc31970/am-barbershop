// 11-40 Task 1: the "Download my data" zip builder and signed links (LIFE-04, D284, D285;
// T-11-40-01, T-11-40-02, T-11-40-04).
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv } from "@cds/core/csv";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TENANT_COLLECTIONS } from "../registry";
import {
  buildDownloadZip,
  downloadCollections,
  DownloadTooLarge,
  mediaEntryName,
  type DownloadCollection,
  type DownloadSource,
} from "./data-download";
import {
  downloadLinkPath,
  signDownloadLink,
  verifyDownloadLink,
} from "./links";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cds-dl-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function pick(...names: string[]): DownloadCollection[] {
  const all = downloadCollections();
  return names.map((n) => {
    const c = all.find((x) => x.name === n);
    if (!c) throw new Error(`no download collection ${n}`);
    return c;
  });
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      // two chunks, to exercise chunked pass-through
      c.enqueue(bytes.slice(0, Math.floor(bytes.length / 2)));
      c.enqueue(bytes.slice(Math.floor(bytes.length / 2)));
      c.close();
    },
  });
}

function source(
  rows: Record<string, Record<string, unknown>[]>,
  extra: Partial<DownloadSource> = {},
): DownloadSource {
  return {
    orgName: "Bakery Co",
    now: new Date("2026-10-11T12:00:00Z"),
    collections: pick(...Object.keys(rows)),
    async *rows(name) {
      const all = rows[name] ?? [];
      // two pages
      yield all.slice(0, 1);
      yield all.slice(1);
    },
    media: [],
    openMedia: () => Promise.resolve(null),
    ...extra,
  };
}

async function unzip(path: string): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await readFile(path)));
}

function csv(files: Record<string, Uint8Array>, name: string) {
  const bytes = files[name]!;
  // UTF-8 BOM (Excel reads accents); strFromU8 drops it when decoding.
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return strFromU8(bytes);
}

describe("downloadCollections (choice 2)", () => {
  it("is every field-list collection that is not auth or personal, in plain-word files", () => {
    const list = downloadCollections();
    const names = list.map((c) => c.name);
    expect(names).toContain("pages");
    expect(names).toContain("contacts");
    expect(names).toContain("form_submissions");
    for (const never of [
      "end_users",
      "alerts",
      "push_subscriptions",
      "data_exports",
      "member_prefs",
    ]) {
      expect(names).not.toContain(never);
    }
    const file = (n: string) => list.find((c) => c.name === n)?.file;
    expect(file("pages")).toBe("pages.csv");
    expect(file("contacts")).toBe("contacts.csv");
    expect(file("form_submissions")).toBe("form-messages.csv");
    expect(new Set(list.map((c) => c.file)).size).toBe(list.length);
    for (const c of list) {
      const spec =
        TENANT_COLLECTIONS[c.name as keyof typeof TENANT_COLLECTIONS];
      if (spec) expect(c.fields).toEqual(spec.export);
    }
  });
});

describe("buildDownloadZip (choices 2, 3)", () => {
  it("writes one CSV per collection with the export fields as headers and guarded cells", async () => {
    const out = join(dir, "a.zip");
    const res = await buildDownloadZip(
      source({
        contacts: [
          {
            id: "c1",
            organization: "o1",
            email: "jane@example.com",
            name: "=SUM(A1)",
            tags: ["vip", "+1"],
            password_hash: "SECRET-HASH",
          },
          {
            id: "c2",
            organization: "o1",
            email: "bob@example.com",
            name: 'Bob "the baker", Jr',
            phone: "@home",
          },
        ],
        member_invites: [
          {
            id: "i1",
            organization: "o1",
            email: "ed@example.com",
            role: "editor",
            status: "pending",
            token_hash: "TOKEN-HASH-VALUE",
          },
        ],
      }),
      out,
    );
    const files = await unzip(out);
    expect(Object.keys(files).sort()).toEqual(
      ["README.txt", "contacts.csv", "member-invites.csv"].sort(),
    );
    expect(res.counts).toEqual({ contacts: 2, member_invites: 1 });
    expect(res.bytes).toBe((await readFile(out)).length);

    const contacts = parseCsv(csv(files, "contacts.csv"));
    if (!contacts.ok) throw new Error("csv did not parse");
    const spec = TENANT_COLLECTIONS.contacts.export;
    expect(contacts.header).toEqual([...spec]);
    const col = (h: string) => contacts.header.indexOf(h);
    expect(contacts.rows[0]![col("name")]).toBe("'=SUM(A1)");
    expect(contacts.rows[0]![col("tags")]).toBe('["vip","+1"]');
    expect(contacts.rows[1]![col("name")]).toBe('Bob "the baker", Jr');
    expect(contacts.rows[1]![col("phone")]).toBe("'@home");

    const raw = strFromU8(files["contacts.csv"]!);
    expect(raw).toContain("'=SUM(A1)");
    expect(raw).not.toMatch(/(^|,)=SUM/m);
  });

  it("never writes a non-allowlisted field (password, token, push keys)", async () => {
    const out = join(dir, "b.zip");
    await buildDownloadZip(
      source({
        contacts: [
          {
            id: "c1",
            organization: "o1",
            email: "a@example.com",
            password_hash: "PW-HASH-XYZ",
            token_hash: "TOK-HASH-XYZ",
            p256dh: "P256DH-KEY-XYZ",
            auth: "AUTH-SECRET-XYZ",
          },
        ],
        member_invites: [
          {
            id: "i1",
            organization: "o1",
            email: "b@example.com",
            token_hash: "INVITE-TOKEN-XYZ",
          },
        ],
        memberships: [
          {
            id: "m1",
            organization: "o1",
            user: "u1",
            role: "owner",
            password: "PLAIN-PW-XYZ",
            tokenKey: "TOKEN-KEY-XYZ",
          },
        ],
      }),
      out,
    );
    const files = await unzip(out);
    for (const [name, bytes] of Object.entries(files)) {
      const text = strFromU8(bytes);
      for (const secret of [
        "password_hash",
        "token_hash",
        "p256dh",
        "tokenKey",
        "PW-HASH-XYZ",
        "TOK-HASH-XYZ",
        "P256DH-KEY-XYZ",
        "AUTH-SECRET-XYZ",
        "INVITE-TOKEN-XYZ",
        "PLAIN-PW-XYZ",
        "TOKEN-KEY-XYZ",
      ]) {
        expect(text, `${name} contains ${secret}`).not.toContain(secret);
      }
    }
  });

  it("streams media originals under media/ and lists missing ones in README", async () => {
    const out = join(dir, "c.zip");
    const photo = new Uint8Array(70_000).map((_, i) => i % 251);
    const opened: string[][] = [];
    const res = await buildDownloadZip(
      source(
        { pages: [] },
        {
          media: [
            {
              id: "aaaaaaaaaaaaaaa",
              name: "My Shop Front!.JPG",
              keys: ["dev/tenants/o/media/aaaaaaaaaaaaaaa/original.jpg"],
            },
            {
              id: "bbbbbbbbbbbbbbb",
              name: "",
              keys: [
                "dev/tenants/o/media/bbbbbbbbbbbbbbb/original.mp4",
                "dev/tenants/o/media/bbbbbbbbbbbbbbb/video.mp4",
              ],
            },
            {
              id: "ccccccccccccccc",
              name: "gone.png",
              keys: ["dev/tenants/o/media/ccccccccccccccc/original.png"],
            },
          ],
          openMedia: (keys) => {
            opened.push([...keys]);
            if (keys[0]!.includes("aaaa")) {
              return Promise.resolve({
                key: keys[0]!,
                stream: streamOf(photo),
              });
            }
            if (keys[0]!.includes("bbbb")) {
              return Promise.resolve({
                key: keys[1]!,
                stream: streamOf(new Uint8Array([1, 2, 3, 4])),
              });
            }
            return Promise.resolve(null);
          },
        },
      ),
      out,
    );
    const files = await unzip(out);
    expect(files["media/aaaaaaaaaaaaaaa-my-shop-front.jpg"]).toEqual(photo);
    expect(files["media/bbbbbbbbbbbbbbb.mp4"]).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(res.mediaFiles).toBe(2);
    expect(res.mediaMissing).toBe(1);
    const readme = strFromU8(files["README.txt"]!);
    expect(readme).toContain("Bakery Co");
    expect(readme).toContain("pages.csv (0 rows)");
    expect(readme).toContain("1 file was not found");
    expect(readme).toContain("Never included: passwords");
    expect(opened).toHaveLength(3);
  });

  it("stops above the size cap and leaves no partial file", async () => {
    const out = join(dir, "d.zip");
    const big = new Uint8Array(200_000).map(() =>
      Math.floor(Math.random() * 256),
    );
    await expect(
      buildDownloadZip(
        source(
          { pages: [] },
          {
            media: [
              { id: "aaaaaaaaaaaaaaa", name: "x.png", keys: ["k/x.png"] },
            ],
            openMedia: (keys) =>
              Promise.resolve({ key: keys[0]!, stream: streamOf(big) }),
          },
        ),
        out,
        { maxBytes: 50_000 },
      ),
    ).rejects.toBeInstanceOf(DownloadTooLarge);
    expect(await readdir(dir)).toEqual([]);
  });

  it("names media entries safely", () => {
    expect(
      mediaEntryName(
        { id: "abc", name: "../../etc/passwd", keys: [] },
        "k/original.png",
      ),
    ).toBe("media/abc-etc-passwd.png");
    expect(
      mediaEntryName({ id: "abc", name: "", keys: [] }, "k/audio.mp3"),
    ).toBe("media/abc.mp3");
  });
});

describe("signed download links (choice 6)", () => {
  const id = "abcdefghij12345";
  const now = Date.UTC(2026, 9, 11);
  const exp = now + 7 * 86_400_000;

  it("a valid link passes", () => {
    const sig = signDownloadLink(id, exp);
    expect(verifyDownloadLink(id, String(exp), sig, now)).toBe(true);
    expect(downloadLinkPath(id, exp)).toBe(
      `/hub/api/data-download/${id}?exp=${exp}&sig=${sig}`,
    );
  });

  it("a tampered signature, id or expiry fails", () => {
    const sig = signDownloadLink(id, exp);
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyDownloadLink(id, String(exp), flipped, now)).toBe(false);
    expect(verifyDownloadLink("bbcdefghij12345", String(exp), sig, now)).toBe(
      false,
    );
    expect(verifyDownloadLink(id, String(exp + 1), sig, now)).toBe(false);
    expect(verifyDownloadLink(id, "abc", sig, now)).toBe(false);
    expect(verifyDownloadLink(id, String(exp), undefined, now)).toBe(false);
  });

  it("an expired link fails", () => {
    const sig = signDownloadLink(id, exp);
    expect(verifyDownloadLink(id, String(exp), sig, exp)).toBe(false);
    expect(verifyDownloadLink(id, String(exp), sig, exp + 1)).toBe(false);
  });
});
