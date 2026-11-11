// Signed pull / ack contract (D291; 13-18's FailsafeCapture must sign the same strings).
// Both are POSTs with a JSON body `{ since, ts, sig }` / `{ ids, ts, sig }`, so nothing
// signed ever sits in a URL or an access log (WR-B01).
//   pull: sig = hex(HMAC_SHA256(FAILSAFE_PULL_SECRET, "pull|" + since + "|" + ts))
//   ack:  sig = hex(HMAC_SHA256(FAILSAFE_PULL_SECRET, "ack|" + ids.join(",") + "|" + ts))
// ts is Unix milliseconds (decimal integer) and must be within ±5 minutes of the service
// clock. An empty or unset secret refuses everything. The compare is timing-safe
// (crypto.timingSafeEqual inside hexEqual). A signature is accepted once: the server keeps
// every verified sig for the skew window and refuses a repeat (replayGuard, WR-B01).
// `since` is "" (everything) or a parseable time; anything else is refused.
import { hexEqual, hmacHex } from "./crypto.ts";

export const MAX_SKEW_MS = 5 * 60 * 1000;

export function pullMessage(since: string, ts: number | string): string {
  return `pull|${since}|${ts}`;
}

export function ackMessage(
  ids: readonly string[],
  ts: number | string,
): string {
  return `ack|${ids.join(",")}|${ts}`;
}

export function signPull(secret: string, since: string, ts: number): string {
  return hmacHex(secret, pullMessage(since, ts));
}

export function signAck(
  secret: string,
  ids: readonly string[],
  ts: number,
): string {
  return hmacHex(secret, ackMessage(ids, ts));
}

function freshTs(ts: unknown, now: Date): string | null {
  const s = typeof ts === "number" ? String(ts) : ts;
  if (typeof s !== "string" || !/^\d{1,16}$/.test(s)) return null;
  return Math.abs(Number(s) - now.getTime()) <= MAX_SKEW_MS ? s : null;
}

function verify(
  secret: string | undefined,
  message: string,
  sig: unknown,
): boolean {
  if (typeof secret !== "string" || secret === "") return false;
  if (typeof sig !== "string" || sig.length !== 64) return false;
  const want = hmacHex(secret, message);
  // hexEqual: shape check, then timingSafeEqual over the decoded bytes.
  return hexEqual(sig, want);
}

export function verifyPull(args: {
  secret: string | undefined;
  since: unknown;
  ts: unknown;
  sig: unknown;
  now?: Date;
}): boolean {
  if (typeof args.since !== "string" || args.since.length > 64) return false;
  if (args.since !== "" && Number.isNaN(Date.parse(args.since))) return false;
  const ts = freshTs(args.ts, args.now ?? new Date());
  if (ts === null) return false;
  return verify(args.secret, pullMessage(args.since, ts), args.sig);
}

export function verifyAck(args: {
  secret: string | undefined;
  ids: unknown;
  ts: unknown;
  sig: unknown;
  now?: Date;
}): boolean {
  if (
    !Array.isArray(args.ids) ||
    args.ids.length > 1000 ||
    !args.ids.every(
      (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id),
    )
  ) {
    return false;
  }
  const ts = freshTs(args.ts, args.now ?? new Date());
  if (ts === null) return false;
  return verify(args.secret, ackMessage(args.ids as string[], ts), args.sig);
}

/**
 * WR-B01: one-time use of a verified signature. Call only after verify passed, so an
 * unauthenticated caller cannot fill the map. Entries older than MAX_SKEW_MS are dropped
 * (their ts would fail the freshness check anyway). One process, so memory is enough.
 */
export function replayGuard(): (sig: string, nowMs: number) => boolean {
  const seen = new Map<string, number>();
  return (sig, nowMs) => {
    for (const [k, t] of seen) if (nowMs - t > 2 * MAX_SKEW_MS) seen.delete(k);
    if (seen.has(sig)) return false;
    seen.set(sig, nowMs);
    return true;
  };
}
