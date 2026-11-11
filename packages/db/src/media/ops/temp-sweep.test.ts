import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweepTempDirs } from "./temp-sweep";

const HOUR = 3_600_000;
const NOW = new Date("2026-10-06T12:00:00.000Z");
const ORG = "orgorgorgorgorg";
const id = (c: string) => c.repeat(15);

let base: string;

async function makeDir(path: string, ageH: number): Promise<void> {
  await mkdir(path, { recursive: true });
  await age(path, ageH);
}

async function age(path: string, ageH: number): Promise<void> {
  const t = new Date(NOW.getTime() - ageH * HOUR);
  await utimes(path, t, t);
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "cds-sweep-test-"));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("sweepTempDirs (07-27 choice 7)", () => {
  it("removes old dirs, keeps young ones and dirs with a recent file", async () => {
    const root = join(base, "uploads");
    const old = join(root, ORG, id("a"));
    const young = join(root, ORG, id("b"));
    const oldWithNewFile = join(root, ORG, id("c"));
    await makeDir(old, 25);
    await makeDir(young, 1);
    await makeDir(oldWithNewFile, 25);
    await writeFile(join(oldWithNewFile, "part"), "x");
    await age(join(oldWithNewFile, "part"), 1);
    await age(oldWithNewFile, 25);
    await age(old, 25);

    const r = await sweepTempDirs({ now: NOW, roots: [{ path: root }] });
    expect(r.removed).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(young)).toBe(true);
    expect(existsSync(oldWithNewFile)).toBe(true);
  });

  it("skips hostile names and symlinks (target untouched)", async () => {
    const root = join(base, "uploads");
    const bad1 = join(root, ORG, "notanid");
    const bad2 = join(root, ORG, "abcdefghijklm-x");
    await makeDir(bad1, 30);
    await makeDir(bad2, 30);
    const target = join(base, "target");
    await makeDir(target, 30);
    await writeFile(join(target, "keep.txt"), "keep");
    const link = join(root, ORG, id("d"));
    await symlink(target, link, "junction");
    await age(join(root, ORG), 30);

    const r = await sweepTempDirs({ now: NOW, roots: [{ path: root }] });
    expect(r.removed).toBe(0);
    expect(r.skipped).toBeGreaterThanOrEqual(3);
    expect(existsSync(bad1)).toBe(true);
    expect(existsSync(bad2)).toBe(true);
    expect(existsSync(join(target, "keep.txt"))).toBe(true);
  });

  it("skips active video ids in the video root only and removes emptied org dirs", async () => {
    const uploads = join(base, "uploads");
    const video = join(base, "video");
    const active = id("e");
    await makeDir(join(uploads, ORG, active), 30);
    await makeDir(join(video, ORG, active), 30);
    const other = "otherorgotherrr";
    await makeDir(join(video, other, id("f")), 30);

    const r = await sweepTempDirs({
      now: NOW,
      roots: [
        { path: uploads },
        { path: video, isActive: (x) => x === active },
      ],
    });
    expect(r.removed).toBe(2);
    expect(existsSync(join(uploads, ORG))).toBe(false);
    expect(existsSync(join(video, ORG, active))).toBe(true);
    expect(existsSync(join(video, other))).toBe(false);
  });

  it("a missing root counts nothing", async () => {
    const r = await sweepTempDirs({
      now: NOW,
      roots: [{ path: join(base, "nope") }],
    });
    expect(r).toEqual({ removed: 0, skipped: 0, errors: 0 });
  });
});
