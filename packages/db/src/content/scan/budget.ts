// Web Risk monthly budget (13-08 choice 4; P13-P27, D295; T-13-08-01).
//
// Every Web Risk lookup is reserved here first. Under the platform_meta lock "lock:webrisk"
// (the CLI and the app can both scan) the counter `scan:webrisk:<YYYY-MM>` is read and
// increased by the number allowed; nothing past CDS_WEBRISK_MONTHLY_CAP (default 100000, the
// free tier) is ever allowed, so Web Risk can never bill past the cap. The month is the
// America/Los_Angeles calendar month (Google Cloud bills in Pacific time), so our counter
// never resets before Google's does.
//
// The first time a reservation comes up short in a month, one `scan.budget_cap` mail goes to
// staffAlertAddress() (claim `scan:webrisk:alerted:<YYYY-MM>`, taken under the same lock). No
// staff address → logged, no claim, nothing sent. A failed send clears the claim so a later
// scan retries. Logs carry class names only, never the address.
import { mintSystemContext } from "../../context";
import type { EmailTransport } from "../../email/transport";
import { sendEmail } from "../../email/send";
import { staffAlertAddress } from "../../media/ops/alerts";
import {
  acquirePlatformLock,
  readPlatformMeta,
  releasePlatformLock,
  writePlatformMeta,
} from "../../platform-meta";

export const WEBRISK_DEFAULT_CAP = 100_000;
const LOCK_KEY = "lock:webrisk";
const LOCK_STALE_MS = 30_000;
const LOCK_TRIES = 40;
const LOCK_WAIT_MS = 50;
const BUDGET_CTX = mintSystemContext({ job: "scan-budget" });

let warnedBadCap = false;

/** CDS_WEBRISK_MONTHLY_CAP as a whole number ≥ 0; unset or invalid → 100000 (one warning). */
export function webRiskMonthlyCap(): number {
  const raw = process.env.CDS_WEBRISK_MONTHLY_CAP?.trim();
  if (raw === undefined || raw === "") return WEBRISK_DEFAULT_CAP;
  if (/^\d{1,12}$/.test(raw)) return Number(raw);
  if (!warnedBadCap) {
    warnedBadCap = true;
    console.warn(
      `[content/scan] CDS_WEBRISK_MONTHLY_CAP is not a whole number; using ${WEBRISK_DEFAULT_CAP}`,
    );
  }
  return WEBRISK_DEFAULT_CAP;
}

/** "2026-10" for the Pacific-time month containing `now`. */
export function webRiskMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${y}-${m}`;
}

function counterKey(month: string): string {
  return `scan:webrisk:${month}`;
}

function alertedKey(month: string): string {
  return `scan:webrisk:alerted:${month}`;
}

function asCount(v: string | null): number {
  if (v === null || !/^\d{1,12}$/.test(v.trim())) return 0;
  return Number(v.trim());
}

/** Lookups used so far in `now`'s month (for GET /api/monitor/status, 13-40). */
export async function webRiskMonthLookups(
  now: Date = new Date(),
): Promise<number> {
  return asCount(await readPlatformMeta(counterKey(webRiskMonth(now))));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withWebRiskLock<T>(now: Date, fn: () => Promise<T>): Promise<T> {
  let token: string | null = null;
  for (let i = 0; i < LOCK_TRIES && token === null; i++) {
    if (i > 0) await sleep(LOCK_WAIT_MS);
    token = await acquirePlatformLock(LOCK_KEY, {
      now: i === 0 ? now : new Date(now.getTime() + i * LOCK_WAIT_MS),
      staleMs: LOCK_STALE_MS,
    });
  }
  if (token === null) throw new Error("webrisk budget lock busy");
  try {
    return await fn();
  } finally {
    await releasePlatformLock(LOCK_KEY, token);
  }
}

export type ReserveOptions = {
  now: Date;
  /** Defaults to webRiskMonthlyCap(). */
  cap?: number;
  transport?: EmailTransport;
  send?: typeof sendEmail;
};

/**
 * Reserve up to `n` Web Risk lookups for this month. Returns how many may be made (0 at the
 * cap). Raises the one-per-month staff alert when a reservation comes up short.
 */
export async function reserveWebRiskLookups(
  n: number,
  opts: ReserveOptions,
): Promise<number> {
  const want = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (want === 0) return 0;
  const now = opts.now;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("reserveWebRiskLookups needs a valid now");
  }
  const cap =
    typeof opts.cap === "number" && Number.isFinite(opts.cap) && opts.cap >= 0
      ? Math.floor(opts.cap)
      : webRiskMonthlyCap();
  const month = webRiskMonth(now);

  const { allowed, used, alertTo } = await withWebRiskLock(now, async () => {
    const before = asCount(await readPlatformMeta(counterKey(month)));
    const ok = Math.max(0, Math.min(want, cap - before));
    if (ok > 0) {
      await writePlatformMeta(
        BUDGET_CTX,
        counterKey(month),
        String(before + ok),
      );
    }
    let to: string | null = null;
    if (ok < want) {
      const claimed = await readPlatformMeta(alertedKey(month));
      if (claimed === null || claimed === "") {
        to = staffAlertAddress();
        if (to) {
          await writePlatformMeta(
            BUDGET_CTX,
            alertedKey(month),
            now.toISOString(),
          );
        } else {
          console.warn(
            "[content/scan] webrisk cap alert not sent: no staff alert address",
          );
        }
      }
    }
    return { allowed: ok, used: before + ok, alertTo: to };
  });

  if (alertTo) {
    try {
      const r = await (opts.send ?? sendEmail)(
        { kind: "cds", ctx: BUDGET_CTX, noReply: true },
        "scan.budget_cap",
        alertTo,
        { month, cap, used },
        { transport: opts.transport },
      );
      if (r.status !== "sent") {
        console.warn(
          "[content/scan] webrisk cap alert not sent: staff address suppressed",
        );
      }
    } catch (err) {
      console.error(
        `[content/scan] webrisk cap alert failed: ${err instanceof Error ? err.name : typeof err}`,
      );
      // Let a later scan retry the alert.
      await writePlatformMeta(BUDGET_CTX, alertedKey(month), "").catch(
        () => undefined,
      );
    }
  }
  return allowed;
}
