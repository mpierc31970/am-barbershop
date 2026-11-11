// Staff media alerts (07-27; D278 fallback start / cap, D221 over-allowance; choices 4 and 5).
// Recipient only from env: CDS_STAFF_ALERT_EMAIL, else CDS_SUPPORT_EMAIL, else no send (logged,
// counted `alertsSkipped`). Mail goes through the one send path as CDS, so the logged-not-sent
// transport stand-in applies until SES. Logs never carry the address.
//
// Over-allowance: platform_meta OVER_ALLOWANCE_KEY holds the comma-joined org ids already
// alerted (capped at 200). `full` is against each org's own allowance, 2 GB + packs (10-33,
// BILL-13; mediaUsageByOrg). An org at `full` not in the list gets one alert; an org back under
// the allowance leaves the list, so a later crossing alerts again. A failed send leaves the
// org off the list, so the next hourly run retries.
import { withSuperuser } from "../../client";
import type { SystemContext } from "../../context";
import { supportEmail } from "../../email/env";
import type { EmailData } from "../../email/render/templates";
import { sendEmail } from "../../email/send";
import type { EmailTransport } from "../../email/transport";
import { readPlatformMeta, writePlatformMeta } from "../../platform-meta";
import { formatGb, mediaUsageByOrg, type MediaUsage } from "../cdn/usage";

export const OVER_ALLOWANCE_KEY = "media:over_allowance_alerted";
const OVER_ALLOWANCE_MAX = 200;
const ID_RE = /^[a-z0-9]{15}$/;
const NAME_CHUNK = 50;

export type MediaAlertData = EmailData["media.alert"];
export type AlertStatus = "sent" | "skipped" | "failed";

export function staffAlertAddress(): string | null {
  const a = process.env.CDS_STAFF_ALERT_EMAIL?.trim();
  if (a) return a;
  return supportEmail();
}

type SendFn = typeof sendEmail;

export async function sendMediaAlert(
  ctx: SystemContext,
  data: MediaAlertData,
  deps: { transport?: EmailTransport; send?: SendFn } = {},
): Promise<{ status: AlertStatus }> {
  const to = staffAlertAddress();
  if (!to) {
    console.warn("[jobs/media] alert not sent: no staff alert address");
    return { status: "skipped" };
  }
  try {
    const r = await (deps.send ?? sendEmail)(
      { kind: "cds", ctx },
      "media.alert",
      to,
      data,
      { transport: deps.transport },
    );
    if (r.status === "sent") return { status: "sent" };
    console.warn("[jobs/media] alert not sent: staff address suppressed");
    return { status: "skipped" };
  } catch (err) {
    const msg = err instanceof Error ? err.name : "error";
    console.error(`[jobs/media] alert ${data.event} failed: ${msg}`);
    return { status: "failed" };
  }
}

/** One superuser read per 50 ids; ids bound through pb.filter. */
export async function orgNamesFor(
  ids: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const valid = ids.filter((id) => ID_RE.test(id));
  for (let i = 0; i < valid.length; i += NAME_CHUNK) {
    const chunk = valid.slice(i, i + NAME_CHUNK);
    const params: Record<string, string> = {};
    const expr = chunk
      .map((id, j) => {
        params[`o${j}`] = id;
        return `id = {:o${j}}`;
      })
      .join(" || ");
    const rows = await withSuperuser((pb) =>
      pb.collection("organizations").getFullList({
        filter: pb.filter(expr, params),
        fields: "id,name",
      }),
    );
    for (const r of rows) out.set(String(r.id), String(r.name ?? ""));
  }
  return out;
}

export type AllowanceAlertDeps = {
  usage?: () => Promise<ReadonlyMap<string, MediaUsage>>;
  orgNames?: (ids: readonly string[]) => Promise<Map<string, string>>;
  read?: (key: string) => Promise<string | null>;
  write?: (ctx: SystemContext, key: string, value: string) => Promise<void>;
  send?: (
    ctx: SystemContext,
    data: MediaAlertData,
  ) => Promise<{ status: AlertStatus }>;
  transport?: EmailTransport;
};

export type AllowanceAlertResult = {
  alerted: number;
  skipped: number;
  failed: number;
};

export async function alertOverAllowance(
  ctx: SystemContext,
  now: Date,
  deps: AllowanceAlertDeps = {},
): Promise<AllowanceAlertResult> {
  const usage = await (deps.usage ?? (() => mediaUsageByOrg(ctx)))();
  const read = deps.read ?? readPlatformMeta;
  const write = deps.write ?? writePlatformMeta;
  const send =
    deps.send ??
    ((c: SystemContext, d: MediaAlertData) =>
      sendMediaAlert(c, d, { transport: deps.transport }));

  const raw = (await read(OVER_ALLOWANCE_KEY)) ?? "";
  const prev = raw.split(",").filter((id) => ID_RE.test(id));
  const full = new Set(
    [...usage].filter(([, u]) => u.level === "full").map(([id]) => id),
  );
  // Orgs back under the allowance drop off the list (a later crossing alerts again).
  const keep = prev.filter((id) => full.has(id));
  const prevSet = new Set(prev);
  const fresh = [...full].filter((id) => !prevSet.has(id));

  const result: AllowanceAlertResult = { alerted: 0, skipped: 0, failed: 0 };
  if (fresh.length > 0) {
    const names = await (deps.orgNames ?? orgNamesFor)(fresh);
    for (const id of fresh) {
      const u = usage.get(id)!;
      const r = await send(ctx, {
        event: "over-allowance",
        at: now,
        orgName: names.get(id) ?? null,
        detail: `Using ${formatGb(u.usedBytes)} of its ${formatGb(u.allowanceBytes)} of media.`,
        link: null,
      });
      if (r.status === "sent") {
        result.alerted += 1;
        keep.push(id);
      } else if (r.status === "skipped") result.skipped += 1;
      else result.failed += 1;
    }
  }
  const next = keep.slice(-OVER_ALLOWANCE_MAX).join(",");
  if (next !== raw) await write(ctx, OVER_ALLOWANCE_KEY, next);
  return result;
}
