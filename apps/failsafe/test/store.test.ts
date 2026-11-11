import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore } from "../src/store.ts";
import { loadKey } from "../src/crypto.ts";

const KEY = randomBytes(32).toString("base64");
const T0 = new Date("2026-10-13T12:00:00.000Z");

const SAMPLE = {
  orgSlug: "bellas-salon",
  addon: "studio-booking",
  name: "Rosa Diaz",
  email: "rosa.diaz@example.com",
  phone: "",
  preferred: "Friday morning",
  message: "Cut and colour please",
};

let dir: string;
let clock: Date;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-store-"));
  clock = T0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function store() {
  return openStore({ dir, key: KEY, now: () => clock });
}

describe("failsafe store", () => {
  it("round-trips a request and keeps no plaintext on disk", () => {
    const s = store();
    const saved = s.append(SAMPLE);
    expect(saved.id).toMatch(/^[a-f0-9]{24}$/);
    expect(saved.created_at).toBe(T0.toISOString());

    const { requests, corrupt } = s.readSince("2026-10-13T00:00:00.000Z");
    expect(corrupt).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ ...SAMPLE, id: saved.id });

    const raw = readFileSync(s.filePath, "utf8");
    expect(raw).not.toContain("Rosa");
    expect(raw).not.toContain("rosa.diaz@example.com");
    expect(raw).not.toContain("bellas-salon");
    const line = JSON.parse(raw.trim()) as Record<string, string>;
    expect(Object.keys(line).sort()).toEqual(["data", "iv", "tag"]);
    expect(Buffer.from(line.iv!, "base64")).toHaveLength(12);
  });

  it("readSince excludes requests at or before since", () => {
    const s = store();
    s.append(SAMPLE);
    clock = new Date(T0.getTime() + 60_000);
    s.append({ ...SAMPLE, name: "Second" });
    const { requests } = s.readSince(T0.toISOString());
    expect(requests.map((r) => r.name)).toEqual(["Second"]);
  });

  it("a tampered line counts as corrupt and the others still read", () => {
    const s = store();
    s.append(SAMPLE);
    s.append({ ...SAMPLE, name: "Untouched" });
    const lines = readFileSync(s.filePath, "utf8").trim().split("\n");
    const first = JSON.parse(lines[0]!) as {
      iv: string;
      tag: string;
      data: string;
    };
    const bytes = Buffer.from(first.data, "base64");
    bytes[0] = bytes[0]! ^ 0x01;
    first.data = bytes.toString("base64");
    lines[0] = JSON.stringify(first);
    writeFileSync(s.filePath, lines.join("\n") + "\n");

    const { requests, corrupt } = s.readSince();
    expect(corrupt).toBe(1);
    expect(requests.map((r) => r.name)).toEqual(["Untouched"]);
  });

  it("refuses a missing or wrong-length key", () => {
    expect(() =>
      openStore({ dir, key: randomBytes(31).toString("base64") }),
    ).toThrow(/32 bytes/);
    expect(() => openStore({ dir, key: "" })).toThrow(/FAILSAFE_DATA_KEY/);
    expect(() => loadKey(undefined)).toThrow(/FAILSAFE_DATA_KEY/);
    expect(loadKey(KEY)).toHaveLength(32);
  });

  it("ack marks reconciled; sweep deletes after 30 days, keeps before", () => {
    const s = store();
    const a = s.append(SAMPLE);
    const b = s.append({ ...SAMPLE, name: "Not acked" });
    expect(s.ack([a.id, "nope"])).toBe(1);
    const after = s.readSince().requests;
    expect(after.find((r) => r.id === a.id)?.reconciled_at).toBe(
      T0.toISOString(),
    );
    expect(after.find((r) => r.id === b.id)?.reconciled_at).toBeUndefined();

    const day = 24 * 60 * 60 * 1000;
    expect(s.sweep(new Date(T0.getTime() + 29 * day))).toBe(0);
    expect(s.readSince().requests).toHaveLength(2);
    expect(s.sweep(new Date(T0.getTime() + 31 * day))).toBe(1);
    expect(s.readSince().requests.map((r) => r.id)).toEqual([b.id]);
  });

  it("a different key cannot read the store", () => {
    store().append(SAMPLE);
    const other = openStore({
      dir,
      key: randomBytes(32).toString("base64"),
    });
    expect(other.readSince()).toEqual({ requests: [], corrupt: 1 });
  });
});
