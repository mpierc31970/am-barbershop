// The form.submission notification (CONT-25, D112, D173; T-07-15-06, T-07-15-12; 07-15).
//
// Recipients (choice 8): every confirmed, non-bouncing org_email_routes address of the
// form's notify_route purpose (at most 5), else the confirmed default address; none at all =
// no email (the message is in the Inbox), counted as skipped. One sendEmail per address, sent
// as the org with Reply-To = the visitor's email (validated by sendEmail). Failures are
// counted and logged without any address; they never lose the message (already saved).
// Internal: never exported from the forms barrel.
import type { EmailPurpose } from "@cds/core/email";
import type PocketBase from "pocketbase";
import { withSuperuser } from "../client";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { systemCtx } from "./shared";

const MAX_RECIPIENTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const failures: number[] = [];
const skipped: number[] = [];

function prune(list: number[], now: number): void {
  while (list.length > 0 && list[0]! <= now - DAY_MS) list.shift();
}

/** Counts only (monitor-safe): notification failures and skips in the last 24 h. */
export function formsNotifyStats(now: number = Date.now()): {
  failures24h: number;
  skipped24h: number;
} {
  prune(failures, now);
  prune(skipped, now);
  return { failures24h: failures.length, skipped24h: skipped.length };
}

/** Test-only: forget the counters. */
export function resetFormsNotifyStatsForTests(): void {
  if (!process.env.VITEST)
    throw new Error("resetFormsNotifyStatsForTests is test-only");
  failures.length = 0;
  skipped.length = 0;
}

async function routeAddresses(
  pb: PocketBase,
  orgId: string,
  purpose: EmailPurpose,
): Promise<string[]> {
  const res = await pb
    .collection("org_email_routes")
    .getList(1, MAX_RECIPIENTS, {
      filter: pb.filter(
        "organization = {:org} && purpose = {:p} && confirmed_at != '' && bounced_at = ''",
        { org: orgId, p: purpose },
      ),
      fields: "address",
      sort: "created,id",
    });
  return [
    ...new Set(
      res.items
        .map((r) => (typeof r.address === "string" ? r.address : ""))
        .filter((a) => a !== ""),
    ),
  ];
}

/** Where a form's notification goes: its route, else the confirmed default, else nowhere. */
export async function notifyAddresses(
  pb: PocketBase,
  orgId: string,
  purpose: EmailPurpose,
): Promise<string[]> {
  if (purpose !== "default") {
    const own = await routeAddresses(pb, orgId, purpose);
    if (own.length > 0) return own;
  }
  return routeAddresses(pb, orgId, "default");
}

export type SubmissionNotice = {
  formId: string;
  formName: string;
  notifyRoute: EmailPurpose;
  submissionId: string;
  pageTitle: string | null;
  answers: { label: string; value: string }[];
  newsletter: boolean | null;
  replyTo: string | null;
  submittedAt: Date;
};

/**
 * Forms Pro auto-reply (BILL-14, D233; 10-36 choice 2): one `form.auto_reply` to the address
 * the visitor submitted, sent as the org. Never throws; a failure is logged by submission id
 * (never the address) and counted with the notification failures (monitor check 22).
 */
export async function sendAutoReply(
  orgId: string,
  submissionId: string,
  reply: { to: string; subject: string; body: string },
  deps: { transport?: EmailTransport } = {},
): Promise<"sent" | "suppressed" | "held" | "skipped" | "failed"> {
  try {
    const orgName = await withSuperuser(async (pb) => {
      const org = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "name" });
      return String(org.name ?? "");
    });
    const res = await sendEmail(
      { kind: "org", ctx: systemCtx("form.submit"), orgId },
      "form.auto_reply",
      reply.to,
      { orgName, subject: reply.subject, body: reply.body },
      { transport: deps.transport },
    );
    return res.status;
  } catch {
    failures.push(Date.now());
    console.error(`[forms] auto-reply failed for submission ${submissionId}`);
    return "failed";
  }
}

/** Send one form.submission per recipient. Never throws; returns what happened. */
export async function sendSubmissionNotice(
  orgId: string,
  notice: SubmissionNotice,
  deps: { transport?: EmailTransport } = {},
): Promise<{ sent: number; failed: number; skipped: boolean }> {
  let to: string[] = [];
  let siteName = "";
  try {
    ({ to, siteName } = await withSuperuser(async (pb) => {
      const org = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "name" });
      return {
        to: await notifyAddresses(pb, orgId, notice.notifyRoute),
        siteName: String(org.name ?? ""),
      };
    }));
  } catch {
    failures.push(Date.now());
    console.error("[forms] notification failed: recipients unavailable");
    return { sent: 0, failed: 1, skipped: false };
  }
  if (to.length === 0) {
    skipped.push(Date.now());
    return { sent: 0, failed: 0, skipped: true };
  }
  const inboxLink = platformUrl(
    `/hub/inbox?form=${encodeURIComponent(notice.formId)}&message=${encodeURIComponent(notice.submissionId)}`,
  );
  let sent = 0;
  let failed = 0;
  for (const address of to) {
    try {
      await sendEmail(
        { kind: "org", ctx: systemCtx("form.submit"), orgId },
        "form.submission",
        address,
        {
          siteName,
          formName: notice.formName,
          pageTitle: notice.pageTitle,
          answers: notice.answers,
          newsletter: notice.newsletter,
          replyable: notice.replyTo !== null,
          inboxLink,
          submittedAt: notice.submittedAt,
        },
        {
          transport: deps.transport,
          ...(notice.replyTo !== null ? { replyTo: notice.replyTo } : {}),
        },
      );
      sent += 1;
    } catch {
      failed += 1;
      failures.push(Date.now());
      console.error("[forms] notification failed");
    }
  }
  return { sent, failed, skipped: false };
}
