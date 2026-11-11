// Video work dirs (07-13 choice 3). One folder per video job under os.tmpdir()/cds-video/
// <org>/<asset>/: input.mp4 (the moved upload or the private original), out.mp4, frame.jpg.
// Removed in the job's `finally`; 07-27's temp sweep clears leftovers (skipping active ids).
import { copyFile, mkdir, rename, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotFound } from "@cds/core";

const ID_RE = /^[a-z0-9]{15}$/;

export function videoWorkRoot(): string {
  return join(tmpdir(), "cds-video");
}

function checked(v: string): string {
  if (typeof v !== "string" || !ID_RE.test(v)) throw new NotFound();
  return v;
}

export function videoWorkDir(orgId: string, assetId: string): string {
  return join(videoWorkRoot(), checked(orgId), checked(assetId));
}

export async function ensureWorkDir(
  orgId: string,
  assetId: string,
): Promise<string> {
  const dir = videoWorkDir(orgId, assetId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** rename, falling back to copy + unlink across devices (EXDEV). */
export async function moveInto(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code !== "EXDEV") throw err;
    await copyFile(src, dest);
    await unlink(src).catch(() => undefined);
  }
}

/** Idempotent. */
export async function removeWorkDir(
  orgId: string,
  assetId: string,
): Promise<void> {
  await rm(videoWorkDir(orgId, assetId), { recursive: true, force: true });
}
