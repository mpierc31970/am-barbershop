// Upload and video temp sweep (07-27 choice 7; RESEARCH Pitfall 1; T-07-27-04). 07-12 writes
// chunked uploads to `chunkUploadRoot()/<org>/<uploadId>/` and 07-13 works videos in
// `videoWorkRoot()/<org>/<asset>/`; both clean up after themselves, and this hourly sweep
// clears what a crash or an abandoned upload left behind.
//
// Only `<root>/<15-char id>/<15-char id>` REAL directories are candidates (lstat; a symlink or
// junction is never followed or removed). Age = newest mtime of the dir and its direct
// entries; older than 24 h is removed. Ids a root marks active (a video job running in this
// process) are skipped. Org dirs left empty are removed. Logs carry counts only.
import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { chunkUploadRoot } from "../library/chunks";
import { isVideoActive } from "../video/job";
import { videoWorkRoot } from "../video/workdir";

export const TEMP_MAX_AGE_MS = 24 * 3_600_000;
const ID_RE = /^[a-z0-9]{15}$/;

export type TempRoot = { path: string; isActive?: (id: string) => boolean };
export type TempSweepResult = {
  removed: number;
  skipped: number;
  errors: number;
};

export function defaultTempRoots(): TempRoot[] {
  return [
    { path: chunkUploadRoot() },
    { path: videoWorkRoot(), isActive: isVideoActive },
  ];
}

async function realDir(path: string): Promise<boolean> {
  try {
    const st = await lstat(path);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

async function newestMtime(dir: string): Promise<number> {
  let newest = (await lstat(dir)).mtimeMs;
  for (const name of await readdir(dir)) {
    try {
      const st = await lstat(join(dir, name));
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    } catch {
      // Vanished between readdir and lstat: ignore.
    }
  }
  return newest;
}

async function sweepRoot(
  root: TempRoot,
  now: number,
  out: TempSweepResult,
): Promise<void> {
  if (!(await realDir(root.path))) return;
  for (const org of await readdir(root.path)) {
    const orgDir = join(root.path, org);
    if (!ID_RE.test(org) || !(await realDir(orgDir))) {
      out.skipped += 1;
      continue;
    }
    for (const id of await readdir(orgDir)) {
      const dir = join(orgDir, id);
      if (!ID_RE.test(id) || !(await realDir(dir))) {
        out.skipped += 1;
        continue;
      }
      if (root.isActive?.(id)) {
        out.skipped += 1;
        continue;
      }
      try {
        if (now - (await newestMtime(dir)) <= TEMP_MAX_AGE_MS) continue;
        await rm(dir, { recursive: true, force: true });
        out.removed += 1;
      } catch {
        out.errors += 1;
      }
    }
    try {
      if ((await readdir(orgDir)).length === 0) await rmdir(orgDir);
    } catch {
      // Raced with a new upload: leave it.
    }
  }
}

export async function sweepTempDirs(
  opts: { now?: Date; roots?: TempRoot[] } = {},
): Promise<TempSweepResult> {
  const now = (opts.now ?? new Date()).getTime();
  const out: TempSweepResult = { removed: 0, skipped: 0, errors: 0 };
  for (const root of opts.roots ?? defaultTempRoots()) {
    try {
      await sweepRoot(root, now, out);
    } catch {
      out.errors += 1;
    }
  }
  console.info(
    `[jobs/media] temp sweep: ${out.removed} removed, ${out.skipped} skipped, ${out.errors} errors`,
  );
  return out;
}
