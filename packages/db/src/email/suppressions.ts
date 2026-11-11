// The one suppression list (EMAIL-01, D138, D267; T-06-26, T-06-27). email_suppressions rows are
// keyed by (organization, email, scope); an empty organization means CDS itself is the sender.
// Those CDS rows are read and written only with a Platform/System context, never an OrgContext
// (the audit.ts rule). Marketing mail is blocked by any row for the sender; transactional only
// by scope "all" (suppressionBlocks).
import { InvalidInput } from "@cds/core";
import {
  normaliseEmail,
  suppressionBlocks,
  type EmailClass,
} from "@cds/core/email";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "../client";
import {
  assertOrgContext,
  assertSystemContext,
  isOrgContext,
  isPlatformContext,
  type OrgContext,
  type PlatformContext,
  type SystemContext,
} from "../context";

/** Who is sending: CDS itself, or one organization. */
export type SendAs =
  /** `noReply` (P12, D97): "CDS Support" from no-reply@, no Reply-To. */
  | { kind: "cds"; ctx: PlatformContext | SystemContext; noReply?: true }
  | { kind: "org"; ctx: OrgContext | SystemContext; orgId: string };

export type SuppressionReason =
  "unsubscribe" | "bounce" | "complaint" | "staff";
export type SuppressionScope = "marketing" | "all";

const ID_RE = /^[a-z0-9]{1,64}$/i;
const SOURCE_RE = /^[a-z0-9._-]{1,40}$/;
const REASONS: readonly string[] = [
  "unsubscribe",
  "bounce",
  "complaint",
  "staff",
];
const SCOPES: readonly string[] = ["marketing", "all"];

function assertPlatformOrSystem(ctx: unknown): void {
  if (isPlatformContext(ctx)) return;
  assertSystemContext(ctx);
}

/** Validates the sender against its context; returns the organization key ("" = CDS). */
export function senderOrgKey(as: SendAs): string {
  if (typeof as !== "object" || as === null) {
    throw new InvalidInput("missing sender");
  }
  if (as.kind === "cds") {
    assertPlatformOrSystem(as.ctx);
    return "";
  }
  if (
    as.kind !== "org" ||
    typeof as.orgId !== "string" ||
    !ID_RE.test(as.orgId)
  ) {
    throw new InvalidInput("invalid sender organization");
  }
  if (isOrgContext(as.ctx)) {
    if (as.ctx.orgId !== as.orgId) {
      throw new InvalidInput("an organization cannot send as another");
    }
    return as.orgId;
  }
  assertSystemContext(as.ctx);
  return as.orgId;
}

async function rowsFor(
  org: string,
  email: string,
): Promise<{ scope: SuppressionScope }[]> {
  const list = await withSuperuser((pb) =>
    pb.collection("email_suppressions").getFullList({
      filter: pb.filter("email = {:e} && organization = {:org}", {
        e: email,
        org,
      }),
      fields: "scope",
    }),
  );
  return list.map((r) => ({ scope: r.scope as SuppressionScope }));
}

/** False when the suppression list blocks this class of mail from this sender. */
export async function canSend(
  as: SendAs,
  email: string,
  cls: EmailClass,
): Promise<boolean> {
  const org = senderOrgKey(as);
  const addr = normaliseEmail(email);
  if (cls !== "marketing" && cls !== "transactional") {
    throw new InvalidInput("invalid email class");
  }
  return !suppressionBlocks(cls, await rowsFor(org, addr));
}

/** True when any row exists for the sender and address (either scope). */
export async function isSuppressed(
  as: SendAs,
  email: string,
): Promise<boolean> {
  const org = senderOrgKey(as);
  return (await rowsFor(org, normaliseEmail(email))).length > 0;
}

function orgFor(
  ctx: OrgContext | PlatformContext | SystemContext,
  organization: string | null,
): string {
  if (isOrgContext(ctx)) {
    if (organization === null || organization !== ctx.orgId) {
      throw new InvalidInput(
        "an organization can only suppress addresses for itself",
      );
    }
    return ctx.orgId;
  }
  if (!isPlatformContext(ctx)) assertSystemContext(ctx);
  if (organization === null) return "";
  if (typeof organization !== "string" || !ID_RE.test(organization)) {
    throw new InvalidInput("invalid organization");
  }
  return organization;
}

/** Idempotent: one row per (organization, email, scope). */
export async function addSuppression(
  ctx: OrgContext | PlatformContext | SystemContext,
  input: {
    organization: string | null;
    email: string;
    reason: SuppressionReason;
    scope: SuppressionScope;
    sourceType: string;
  },
): Promise<void> {
  if (isOrgContext(ctx)) assertOrgContext(ctx);
  const organization = orgFor(ctx, input.organization);
  const email = normaliseEmail(input.email);
  if (!REASONS.includes(input.reason)) throw new InvalidInput("invalid reason");
  if (!SCOPES.includes(input.scope)) throw new InvalidInput("invalid scope");
  if (
    typeof input.sourceType !== "string" ||
    !SOURCE_RE.test(input.sourceType)
  ) {
    throw new InvalidInput("invalid source type");
  }
  const exists = async () =>
    (await rowsFor(organization, email)).some((r) => r.scope === input.scope);
  if (await exists()) return;
  try {
    await withSuperuser((pb) =>
      pb.collection("email_suppressions").create({
        organization,
        email,
        reason: input.reason,
        scope: input.scope,
        source_type: input.sourceType,
      }),
    );
  } catch (err) {
    // A concurrent insert hit the unique index: the row exists, which is the goal.
    if (
      err instanceof ClientResponseError &&
      err.status === 400 &&
      (await exists())
    ) {
      return;
    }
    throw err;
  }
}
