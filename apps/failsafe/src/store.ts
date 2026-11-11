// Encrypted JSON-lines store (D291). One line per request, each `{ iv, tag, data }`:
// aes-256-gcm with a random 12-byte IV and the auth tag stored. A line that fails to decrypt
// (tampered, wrong key) is counted as corrupt and skipped, never thrown to the client, and
// kept on disk as-is. Rewrites (ack, sweep) go through a temp file + rename. Synchronous fs:
// one process, tiny volume, and no interleaving between a rewrite and an append.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadKey, seal, unseal } from "./crypto.ts";

export const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FailsafeRequestInput = {
  orgSlug: string;
  addon: string;
  name: string;
  email: string;
  phone: string;
  preferred: string;
  message: string;
};

export type FailsafeRequest = FailsafeRequestInput & {
  id: string;
  created_at: string;
  reconciled_at?: string;
};

export type ReadResult = { requests: FailsafeRequest[]; corrupt: number };

export type FailsafeStore = {
  readonly filePath: string;
  append(input: FailsafeRequestInput): FailsafeRequest;
  /** Requests with `created_at > since` (all when `since` is omitted), oldest first. */
  readSince(since?: string): ReadResult;
  /** Mark ids reconciled now; returns how many were found and newly marked. */
  ack(ids: readonly string[]): number;
  /** Delete requests reconciled more than 30 days before `now`; returns how many. */
  sweep(now?: Date): number;
};

type Line =
  { ok: true; raw: string; req: FailsafeRequest } | { ok: false; raw: string };

function isRequest(v: unknown): v is FailsafeRequest {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.created_at === "string" &&
    typeof r.orgSlug === "string" &&
    typeof r.addon === "string"
  );
}

export function openStore(opts: {
  dir: string;
  key: string | undefined;
  now?: () => Date;
}): FailsafeStore {
  const key = loadKey(opts.key);
  const now = opts.now ?? (() => new Date());
  mkdirSync(opts.dir, { recursive: true });
  const filePath = join(opts.dir, "requests.jsonl");

  function readLines(): Line[] {
    if (!existsSync(filePath)) return [];
    const out: Line[] = [];
    for (const raw of readFileSync(filePath, "utf8").split("\n")) {
      if (raw.trim() === "") continue;
      try {
        const req = unseal(key, JSON.parse(raw));
        out.push(isRequest(req) ? { ok: true, raw, req } : { ok: false, raw });
      } catch {
        out.push({ ok: false, raw });
      }
    }
    return out;
  }

  function rewrite(lines: string[]): void {
    const tmp = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, lines.map((l) => `${l}\n`).join(""), { mode: 0o600 });
    renameSync(tmp, filePath);
  }

  return {
    filePath,

    append(input) {
      const req: FailsafeRequest = {
        id: randomBytes(12).toString("hex"),
        orgSlug: input.orgSlug,
        addon: input.addon,
        name: input.name,
        email: input.email,
        phone: input.phone,
        preferred: input.preferred,
        message: input.message,
        created_at: now().toISOString(),
      };
      appendFileSync(filePath, `${JSON.stringify(seal(key, req))}\n`, {
        mode: 0o600,
      });
      return req;
    },

    readSince(since) {
      const sinceMs = since === undefined ? -Infinity : Date.parse(since);
      const requests: FailsafeRequest[] = [];
      let corrupt = 0;
      for (const line of readLines()) {
        if (!line.ok) {
          corrupt++;
          continue;
        }
        if (
          Number.isNaN(sinceMs) ||
          Date.parse(line.req.created_at) > sinceMs
        ) {
          requests.push(line.req);
        }
      }
      return { requests, corrupt };
    },

    ack(ids) {
      const want = new Set(ids);
      if (want.size === 0) return 0;
      const at = now().toISOString();
      let marked = 0;
      const lines = readLines().map((line) => {
        if (!line.ok || !want.has(line.req.id) || line.req.reconciled_at) {
          return line.raw;
        }
        marked++;
        return JSON.stringify(seal(key, { ...line.req, reconciled_at: at }));
      });
      if (marked > 0) rewrite(lines);
      return marked;
    },

    sweep(at = now()) {
      const cutoff = at.getTime() - RETENTION_DAYS * DAY_MS;
      let deleted = 0;
      const kept: string[] = [];
      for (const line of readLines()) {
        if (
          line.ok &&
          line.req.reconciled_at &&
          Date.parse(line.req.reconciled_at) < cutoff
        ) {
          deleted++;
          continue;
        }
        kept.push(line.raw);
      }
      if (deleted > 0) rewrite(kept);
      return deleted;
    },
  };
}
