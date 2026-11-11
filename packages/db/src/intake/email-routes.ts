// "Where should your email go?" (ONB-09, ONB-10, D173; UI-SPEC Email routing; T-06-57..59,
// T-06-62). One default address used for everything, plus per-purpose overrides: website
// inquiries (up to 5), newsletter (one reply-to + a sender name), billing and account (one
// each). Every new address gets a one-click confirm email through the one send pipeline.
//
// Confirm tokens: 32 random bytes as base64url (43 chars), stored ONLY as their sha256 in
// org_email_routes.confirm_hash (never exported, never returned), valid 7 days, cleared on
// use (single use). describeRouteConfirm never changes state (link scanners follow GETs);
// confirmEmailRoute is for POST callers only (D-UI-P6-15). Resend has a 60 s cooldown, and
// every confirm send (add, change, restore, resend) is limited per org and per recipient
// address (beginConfirmSend, A-WR-01), checked before anything is written.
//
// Changing the default: a pending default row is created; the old default keeps working
// until the new one is confirmed, and confirming it deletes the old one in the same batch.
// The one-address overrides (newsletter, billing, account) work the same way (A-WR-05): a
// new address replaces only earlier pending (or bouncing) rows, and the confirmed one keeps
// working until the new one is confirmed.
//
// Org-scoped functions take an OrgContext (business read / write: Owner and Admin write,
// Editor reads). The confirm pair is token-only and public. recordBounce is for System /
// Platform contexts: it is the P12 SES bounce-webhook seam.
import { createHash, randomBytes } from "node:crypto";
import { InvalidInput, RateLimited } from "@cds/core";
import { normaliseEmail, type EmailPurpose } from "@cds/core/email";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody, type AuditEvent } from "../audit";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import {
  assertSystemContext,
  isPlatformContext,
  mintSystemContext,
  type OrgContext,
  type PlatformContext,
  type SystemContext,
} from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import { addSuppression, canSend } from "../email/suppressions";
import type { EmailTransport } from "../email/transport";
import { beginConfirmSend } from "../rate-limit";
import { newRecordId } from "../repository";
import {
  commit,
  rejectForeignOrg,
  runRead,
  runWrite,
  scopedGet,
  type Op,
} from "./shared";

const COLLECTION = "org_email_routes";

export const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_INQUIRY_ADDRESSES = 5;
export const SENDER_NAME_MAX = 120;

export const ROUTE_COPY = {
  duplicate: "This address is already on the list.",
  suppressed:
    "Emails to this address bounced before. Check the spelling, or use another address.",
  tooMany: `You can add up to ${MAX_INQUIRY_ADDRESSES} addresses for website inquiries.`,
  purpose: "Choose where this address should get email.",
  removeDefault:
    "Everything goes to this address, so it can't be removed. Change it instead.",
  alreadyConfirmed: "This address is already confirmed.",
  cooldown: "Sent. Check that inbox. You can send another in a minute.",
  noNewsletter: "Add a newsletter reply-to address first.",
  senderLong: `The sender name is longer than ${SENDER_NAME_MAX} characters.`,
  senderInvalid: "The sender name can't contain line breaks.",
  gone: "That address isn't on the list anymore. Reload the page and try again.",
} as const;

const OVERRIDES = ["inquiries", "newsletter", "billing", "account"] as const;
type OverridePurpose = (typeof OVERRIDES)[number];
const PURPOSE_ORDER: readonly EmailPurpose[] = ["default", ...OVERRIDES];

/** The words the confirm email and page use for each purpose (UI-SPEC Emails). */
const PURPOSE_LABELS: Readonly<Record<EmailPurpose, string>> = {
  default: "all its email",
  inquiries: "website inquiries",
  newsletter: "newsletter replies",
  billing: "billing from CDS",
  account: "account and support",
};

export type EmailRoute = {
  id: string;
  purpose: EmailPurpose;
  address: string;
  senderName: string;
  status: "waiting" | "confirmed" | "bouncing";
  /** A new default address waiting for its confirmation; the confirmed one still works. */
  pendingDefault: boolean;
};

type Deps = { transport?: EmailTransport; now?: Date };

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function dateOf(raw: unknown): Date | null {
  if (typeof raw !== "string" || raw === "") return null;
  const d = new Date(raw.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function isPurpose(v: unknown): v is EmailPurpose {
  return (PURPOSE_ORDER as readonly unknown[]).includes(v);
}

function toRoute(r: RecordModel): EmailRoute {
  const confirmed = dateOf(r.confirmed_at) !== null;
  const purpose = isPurpose(r.purpose) ? r.purpose : "default";
  return {
    id: r.id,
    purpose,
    address: str(r.address),
    senderName: str(r.sender_name),
    status:
      dateOf(r.bounced_at) !== null
        ? "bouncing"
        : confirmed
          ? "confirmed"
          : "waiting",
    pendingDefault: purpose === "default" && !confirmed,
  };
}

function sortRoutes(rows: RecordModel[]): RecordModel[] {
  const rank = (r: RecordModel) =>
    PURPOSE_ORDER.indexOf(isPurpose(r.purpose) ? r.purpose : "default");
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      str(a.created).localeCompare(str(b.created)) ||
      a.id.localeCompare(b.id),
  );
}

function orgRoutes(pb: PocketBase, orgId: string): Promise<RecordModel[]> {
  return pb
    .collection(COLLECTION)
    .getFullList({
      filter: pb.filter("organization = {:org}", { org: orgId }),
    })
    .then(sortRoutes);
}

/** Always-audited batch (create / confirm / remove / bounce are never silent). */
async function sendBatch(
  pb: PocketBase,
  ctx: OrgContext | PlatformContext | SystemContext,
  ops: readonly Op[],
  event: AuditEvent,
): Promise<void> {
  const batch = pb.createBatch();
  for (const w of ops) {
    const col = batch.collection(w.collection);
    if (w.op === "create") col.create({ ...w.body, id: w.id });
    else if (w.op === "update") col.update(w.id, w.body);
    else col.delete(w.id);
  }
  batch.collection("audit_log").create(auditBody(ctx, event));
  await batch.send();
}

function confirmFields(now: Date): {
  token: string;
  body: Record<string, unknown>;
} {
  const { token, hash } = newToken();
  return {
    token,
    body: {
      confirm_hash: hash,
      confirm_expires: new Date(now.getTime() + CONFIRM_TTL_MS).toISOString(),
      last_confirm_sent_at: now.toISOString(),
    },
  };
}

async function orgName(pb: PocketBase, orgId: string): Promise<string> {
  const org = await pb
    .collection("organizations")
    .getOne(orgId, { fields: "name" });
  return str(org.name);
}

async function sendConfirm(
  ctx: OrgContext,
  name: string,
  purpose: EmailPurpose,
  address: string,
  token: string,
  deps: Deps,
): Promise<void> {
  await sendEmail(
    { kind: "org", ctx, orgId: ctx.orgId },
    "email.confirm",
    address,
    {
      orgName: name,
      purposeLabel: PURPOSE_LABELS[purpose],
      link: platformUrl(`/start/confirm-email?t=${token}`),
    },
    deps.transport ? { transport: deps.transport } : {},
  );
}

/** Refuses an address the org's suppression list blocks for transactional mail. */
async function assertDeliverable(
  ctx: OrgContext,
  address: string,
): Promise<void> {
  if (
    !(await canSend(
      { kind: "org", ctx, orgId: ctx.orgId },
      address,
      "transactional",
    ))
  ) {
    throw new InvalidInput(ROUTE_COPY.suppressed);
  }
}

// ---------------------------------------------------------------------------------------
// Org-scoped API

/** Every route of the org, default first; never includes the confirm hash. */
export async function listEmailRoutes(ctx: OrgContext): Promise<EmailRoute[]> {
  return runRead(ctx, async (pb) =>
    (await orgRoutes(pb, ctx.orgId)).map(toRoute),
  );
}

/**
 * Add an override address and send its confirm email. Inquiries take up to 5 addresses;
 * newsletter, billing and account take one each: a new one replaces an earlier pending or
 * bouncing row at once, and a working confirmed one when the new one is confirmed (the
 * newsletter sender name carries over).
 *
 * `replaces` (inquiries only) changes one of the org's inquiry rows: the new row is created
 * and that one deleted in the same batch, so the swap works at the cap and never leaves both
 * or neither (C-WR-04).
 */
export async function addEmailRoute(
  ctx: OrgContext,
  input: {
    purpose: Exclude<EmailPurpose, "default">;
    address: string;
    replaces?: string;
  },
  deps: Deps = {},
): Promise<EmailRoute> {
  if (typeof input !== "object" || input === null) {
    throw new InvalidInput(ROUTE_COPY.purpose);
  }
  rejectForeignOrg(ctx, input as Record<string, unknown>);
  const purpose = input.purpose as unknown;
  if (!(OVERRIDES as readonly unknown[]).includes(purpose)) {
    throw new InvalidInput(ROUTE_COPY.purpose);
  }
  const p = purpose as OverridePurpose;
  const replaces = (input as { replaces?: unknown }).replaces;
  if (
    replaces !== undefined &&
    (p !== "inquiries" || typeof replaces !== "string")
  ) {
    throw new InvalidInput(ROUTE_COPY.purpose);
  }
  const address = normaliseEmail(input.address);
  const now = deps.now ?? new Date();
  const out = await runWrite(ctx, async (pb) => {
    const all = (await orgRoutes(pb, ctx.orgId)).filter((r) => r.purpose === p);
    // Only a row of this org and purpose can be replaced (orgRoutes is org-scoped).
    const target =
      replaces === undefined ? null : all.find((r) => r.id === replaces);
    if (target === undefined) throw new InvalidInput(ROUTE_COPY.gone);
    const same = target ? all.filter((r) => r.id !== target.id) : all;
    if (same.some((r) => str(r.address).toLowerCase() === address)) {
      throw new InvalidInput(ROUTE_COPY.duplicate);
    }
    if (p === "inquiries" && same.length >= MAX_INQUIRY_ADDRESSES) {
      throw new InvalidInput(ROUTE_COPY.tooMany);
    }
    await assertDeliverable(ctx, address);
    beginConfirmSend(ctx.orgId, address);
    // A working (confirmed, not bouncing) address stays until the new one is confirmed.
    const replaced =
      p === "inquiries"
        ? target
          ? [target]
          : []
        : same.filter(
            (r) =>
              dateOf(r.confirmed_at) === null || dateOf(r.bounced_at) !== null,
          );
    const { token, body } = confirmFields(now);
    const id = newRecordId();
    const senderName = same.map((r) => str(r.sender_name)).find(Boolean);
    const ops: Op[] = [
      ...replaced.map((r): Op => ({
        collection: COLLECTION,
        op: "delete",
        id: r.id,
      })),
      {
        collection: COLLECTION,
        op: "create",
        id,
        body: {
          organization: ctx.orgId,
          purpose: p,
          address,
          ...(senderName ? { sender_name: senderName } : {}),
          ...body,
        },
      },
    ];
    await sendBatch(pb, ctx, ops, {
      action: `${COLLECTION}.create`,
      targetCollection: COLLECTION,
      targetId: id,
      meta: { purpose: p, replaced: replaced.length },
    });
    const row = await pb.collection(COLLECTION).getOne(id);
    return { route: toRoute(row), token, name: await orgName(pb, ctx.orgId) };
  });
  await sendConfirm(ctx, out.name, p, address, out.token, deps);
  return out.route;
}

/**
 * Start changing the default address: a pending default row gets the confirm email; the
 * current default keeps working until the new one is confirmed. A second change replaces
 * an earlier pending one.
 */
export async function changeDefaultRoute(
  ctx: OrgContext,
  address: string,
  deps: Deps = {},
): Promise<EmailRoute> {
  const addr = normaliseEmail(address);
  const now = deps.now ?? new Date();
  const out = await runWrite(ctx, async (pb) => {
    const defaults = (await orgRoutes(pb, ctx.orgId)).filter(
      (r) => r.purpose === "default",
    );
    const confirmed = defaults.filter((r) => dateOf(r.confirmed_at) !== null);
    const pending = defaults.filter((r) => dateOf(r.confirmed_at) === null);
    if (confirmed.some((r) => str(r.address).toLowerCase() === addr)) {
      throw new InvalidInput(ROUTE_COPY.duplicate);
    }
    await assertDeliverable(ctx, addr);
    beginConfirmSend(ctx.orgId, addr);
    const { token, body } = confirmFields(now);
    const id = newRecordId();
    const ops: Op[] = [
      ...pending.map((r): Op => ({
        collection: COLLECTION,
        op: "delete",
        id: r.id,
      })),
      {
        collection: COLLECTION,
        op: "create",
        id,
        body: {
          organization: ctx.orgId,
          purpose: "default",
          address: addr,
          ...body,
        },
      },
    ];
    await sendBatch(pb, ctx, ops, {
      action: `${COLLECTION}.create`,
      targetCollection: COLLECTION,
      targetId: id,
      meta: { purpose: "default", replaced: pending.length },
    });
    const row = await pb.collection(COLLECTION).getOne(id);
    return { route: toRoute(row), token, name: await orgName(pb, ctx.orgId) };
  });
  await sendConfirm(ctx, out.name, "default", addr, out.token, deps);
  return out.route;
}

/** Send a fresh confirm email (new token; the old link stops working). 60 s cooldown. */
export async function resendRouteConfirmation(
  ctx: OrgContext,
  id: string,
  deps: Deps = {},
): Promise<void> {
  const now = deps.now ?? new Date();
  const out = await runWrite(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, id);
    if (dateOf(row.confirmed_at) !== null) {
      throw new InvalidInput(ROUTE_COPY.alreadyConfirmed);
    }
    const last = dateOf(row.last_confirm_sent_at);
    if (last && now.getTime() - last.getTime() < RESEND_COOLDOWN_MS) {
      throw new RateLimited(ROUTE_COPY.cooldown);
    }
    beginConfirmSend(ctx.orgId, str(row.address));
    const { token, body } = confirmFields(now);
    await commit(
      pb,
      ctx,
      [{ collection: COLLECTION, op: "update", id: row.id, body }],
      {
        action: `${COLLECTION}.resend`,
        targetCollection: COLLECTION,
        targetId: row.id,
      },
    );
    return {
      token,
      purpose: isPurpose(row.purpose) ? row.purpose : "default",
      address: str(row.address),
      name: await orgName(pb, ctx.orgId),
    };
  });
  await sendConfirm(ctx, out.name, out.purpose, out.address, out.token, deps);
}

/** Remove an override (or cancel a pending default change). The default can't be removed. */
export async function removeEmailRoute(
  ctx: OrgContext,
  id: string,
): Promise<void> {
  await runWrite(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, id);
    if (row.purpose === "default" && dateOf(row.confirmed_at) !== null) {
      throw new InvalidInput(ROUTE_COPY.removeDefault);
    }
    await sendBatch(
      pb,
      ctx,
      [{ collection: COLLECTION, op: "delete", id: row.id }],
      {
        action: `${COLLECTION}.remove`,
        targetCollection: COLLECTION,
        targetId: row.id,
        meta: { purpose: str(row.purpose) },
      },
    );
  });
}

/** The newsletter's sender name (empty = the business name). Needs a newsletter route. */
export async function setNewsletterSender(
  ctx: OrgContext,
  senderName: string,
): Promise<void> {
  if (typeof senderName !== "string") {
    throw new InvalidInput(ROUTE_COPY.senderInvalid);
  }
  const name = senderName.trim().replace(/\s+/g, " ");
  if (/[\r\n\u0000-\u001f\u007f]/.test(senderName.trim())) {
    throw new InvalidInput(ROUTE_COPY.senderInvalid);
  }
  if (name.length > SENDER_NAME_MAX) {
    throw new InvalidInput(ROUTE_COPY.senderLong);
  }
  await runWrite(ctx, async (pb) => {
    const rows = (await orgRoutes(pb, ctx.orgId)).filter(
      (r) => r.purpose === "newsletter",
    );
    if (rows.length === 0) throw new InvalidInput(ROUTE_COPY.noNewsletter);
    const ops: Op[] = rows
      .filter((r) => str(r.sender_name) !== name)
      .map((r) => ({
        collection: COLLECTION,
        op: "update",
        id: r.id,
        body: { sender_name: name },
      }));
    await commit(pb, ctx, ops, {
      action: `${COLLECTION}.sender`,
      targetCollection: COLLECTION,
      targetId: rows[0]!.id,
    });
  });
}

// ---------------------------------------------------------------------------------------
// Token-only confirm (public; the page reads with describe, the POST action confirms)

type Found = { row: RecordModel; expired: boolean; orgName: string };

async function findByToken(
  pb: PocketBase,
  token: unknown,
  now: Date,
): Promise<Found | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("confirm_hash = {:h}", { h: hashToken(token) }),
  });
  const row = res.items[0];
  if (!row || dateOf(row.confirmed_at) !== null) return null;
  const expires = dateOf(row.confirm_expires);
  return {
    row,
    expired: expires === null || now.getTime() > expires.getTime(),
    orgName: await orgName(pb, str(row.organization)),
  };
}

function describeOf(f: Found) {
  const purpose = isPurpose(f.row.purpose) ? f.row.purpose : "default";
  return {
    orgName: f.orgName,
    address: str(f.row.address),
    purposeLabel: PURPOSE_LABELS[purpose],
  };
}

/** What a confirm link is for. Never changes state (link scanners, D-UI-P6-15). */
export async function describeRouteConfirm(
  token: string,
  opts: { now?: Date } = {},
): Promise<{
  orgName: string;
  address: string;
  purposeLabel: string;
  state: "valid" | "expired";
} | null> {
  const now = opts.now ?? new Date();
  const found = await withSuperuser((pb) => findByToken(pb, token, now));
  if (!found) return null;
  return { ...describeOf(found), state: found.expired ? "expired" : "valid" };
}

/**
 * Confirm the address behind a token. POST callers only (never a GET handler). Single use:
 * the hash is cleared. Confirming a default, newsletter, billing or account address deletes
 * the other rows of that purpose in the same batch. Returns null for an unknown, used, malformed or expired token.
 */
export async function confirmEmailRoute(
  token: string,
  opts: { now?: Date } = {},
): Promise<{ orgName: string; address: string; purposeLabel: string } | null> {
  const now = opts.now ?? new Date();
  const first = await withSuperuser((pb) => findByToken(pb, token, now));
  if (!first || first.expired) return null;
  const orgId = str(first.row.organization);
  return withOrgLock(orgId, () =>
    withSuperuser(async (pb) => {
      // Re-read under the lock: a concurrent confirm or resend may have used the token.
      const found = await findByToken(pb, token, now);
      if (!found || found.expired) return null;
      const row = found.row;
      const ops: Op[] = [
        {
          collection: COLLECTION,
          op: "update",
          id: row.id,
          body: {
            confirmed_at: now.toISOString(),
            confirm_hash: "",
            confirm_expires: "",
          },
        },
      ];
      // One-address purposes: the confirmed address replaces the old one (A-WR-05).
      if (row.purpose !== "inquiries") {
        for (const other of await orgRoutes(pb, orgId)) {
          if (other.purpose === row.purpose && other.id !== row.id) {
            ops.push({ collection: COLLECTION, op: "delete", id: other.id });
          }
        }
      }
      await sendBatch(
        pb,
        mintSystemContext({ job: "email-route-confirm" }),
        ops,
        {
          action: `${COLLECTION}.confirm`,
          organization: orgId,
          targetCollection: COLLECTION,
          targetId: row.id,
          meta: { purpose: str(row.purpose) },
        },
      );
      return describeOf(found);
    }),
  );
}

// ---------------------------------------------------------------------------------------
// Bounces (P12 seam: the SES bounce/complaint webhook calls this)

/**
 * A hard bounce marks bounced_at on every route with this address (every org, or only
 * `orgId`) and adds a scope "all" suppression per affected org, so the owner sees
 * "Bouncing" and the address can't be added again. A soft bounce is transient and changes
 * nothing. Returns the number of routes marked.
 */
export async function recordBounce(
  ctx: SystemContext | PlatformContext,
  input: { email: string; hard: boolean; orgId?: string },
): Promise<number> {
  if (!isPlatformContext(ctx)) assertSystemContext(ctx);
  const email = normaliseEmail(input.email);
  if (input.orgId !== undefined && !/^[a-z0-9]{1,64}$/i.test(input.orgId)) {
    throw new InvalidInput("invalid organization");
  }
  if (input.hard !== true) return 0;
  const now = new Date().toISOString();
  const rows = await withSuperuser((pb) =>
    pb.collection(COLLECTION).getFullList({
      filter:
        input.orgId === undefined
          ? pb.filter("address = {:e}", { e: email })
          : pb.filter("address = {:e} && organization = {:org}", {
              e: email,
              org: input.orgId,
            }),
    }),
  );
  const byOrg = new Map<string, RecordModel[]>();
  for (const r of rows) {
    const org = str(r.organization);
    byOrg.set(org, [...(byOrg.get(org) ?? []), r]);
  }
  if (input.orgId !== undefined && !byOrg.has(input.orgId)) {
    byOrg.set(input.orgId, []);
  }
  let marked = 0;
  for (const [org, list] of byOrg) {
    await withOrgLock(org, () =>
      withSuperuser((pb) =>
        sendBatch(
          pb,
          ctx,
          list.map((r) => ({
            collection: COLLECTION,
            op: "update" as const,
            id: r.id,
            body: { bounced_at: now },
          })),
          {
            action: `${COLLECTION}.bounce`,
            organization: org,
            targetCollection: COLLECTION,
            targetId: list[0]?.id ?? "",
            meta: { routes: list.length },
          },
        ),
      ),
    );
    marked += list.length;
    await addSuppression(ctx, {
      organization: org,
      email,
      reason: "bounce",
      scope: "all",
      sourceType: "bounce",
    });
  }
  return marked;
}
