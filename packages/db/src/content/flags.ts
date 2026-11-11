// Screening flags (D248, CONTEXT A5). Internal: never exported from index.ts, so no caller
// can write or forge a flag. The organization always comes from the context (TEN-03);
// reasons are short scanner strings, capped, never the content itself.
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";

const MAX_REASONS = 10;
const MAX_REASON_LENGTH = 200;

export type ContentFlagSource = "text" | "image" | "link" | "scan";

export type ContentFlagInput = {
  targetCollection: string;
  targetId: string;
  verdict: "unsure" | "held" | "error";
  reasons: string[];
  /**
   * 13-11 (D248, STAFF-23): an `error` (provider outage) defaults to "queued" so review:run
   * rescans it; held and unsure default to "open".
   */
  status?: "open" | "queued";
  /** 13-11: which scanner raised it. `error` defaults to "scan" (the composite). */
  source?: ContentFlagSource;
};

const SOURCES: readonly ContentFlagSource[] = ["text", "image", "link", "scan"];

/** The content_flags create body, for a caller that commits the flag in its own batch. */
export function contentFlagBody(
  ctx: OrgContext,
  input: ContentFlagInput,
): Record<string, unknown> {
  assertOrgContext(ctx);
  const reasons = (Array.isArray(input.reasons) ? input.reasons : [])
    .filter((r): r is string => typeof r === "string")
    .slice(0, MAX_REASONS)
    .map((r) => r.slice(0, MAX_REASON_LENGTH));
  const status =
    input.status === "open" || input.status === "queued"
      ? input.status
      : input.verdict === "error"
        ? "queued"
        : "open";
  const source =
    input.source && SOURCES.includes(input.source)
      ? input.source
      : input.verdict === "error"
        ? "scan"
        : undefined;
  return {
    organization: ctx.orgId,
    target_collection: input.targetCollection,
    target_id: input.targetId,
    verdict: input.verdict,
    reasons,
    status,
    ...(source ? { source } : {}),
    ...(status === "queued" ? { rescan_attempts: 0 } : {}),
  };
}

export async function recordContentFlag(
  ctx: OrgContext,
  input: ContentFlagInput,
): Promise<void> {
  const body = contentFlagBody(ctx, input);
  await withSuperuser((pb) => pb.collection("content_flags").create(body));
}
