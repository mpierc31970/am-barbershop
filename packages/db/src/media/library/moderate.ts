// Image moderation on upload (13-11; STAFF-23, STAFF-25, D248, D270; RESEARCH Pitfall 8).
// Internal: called by upload.ts after the variant pipeline, before the asset row commits, so
// the asset and its flag land in one write.
//   - held     -> asset status `held` (kept, never served: every read gates on `ready`) + flag
//   - unsure   -> flag only (the asset is usable)
//   - rejected or slower than the timeout -> flag `error`, status `queued` (review:run rescans)
//   - skipped / unchecked / clean -> nothing (the stand-in never blocks an upload)
// The moderator never sees the file name or the owner; reasons are short provider strings.
// The demo org (13-24, STAFF-18, D293) is never sent to the moderator and never flagged.
import type { OrgContext } from "../../context";
import { orgIsDemo } from "../../demo/flag";
import { contentFlagBody } from "../../content/flags";
import type { ImageModerator, SubResult } from "../../content/ports";
import { getImageModerator } from "../../content/scan/image";

export const IMAGE_MODERATION_TIMEOUT_MS = 2000;

export type ModerateImageDeps = {
  /** Defaults to getImageModerator() (CDS_IMAGE_MODERATOR; stand-in: skipped). */
  moderator?: ImageModerator;
  timeoutMs?: number;
};

export type ImageModeration = {
  /** True when the asset must be stored as `held` (not usable). */
  held: boolean;
  /** A content_flags create body for the caller's batch, or null. */
  flag: Record<string, unknown> | null;
};

class ModerationTimeout extends Error {
  override name = "ModerationTimeout";
}

async function checkWithTimeout(
  moderator: ImageModerator,
  input: Parameters<ImageModerator["check"]>[0],
  timeoutMs: number,
): Promise<SubResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ModerationTimeout()), timeoutMs);
  });
  try {
    return await Promise.race([moderator.check(input), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Moderate one stored image. `asset.url` names the stored web variant (private store key);
 * `asset.bytes` is that variant, so a provider never needs to fetch a private object.
 */
export async function moderateImage(
  ctx: OrgContext,
  asset: { id: string; url: string; bytes?: Uint8Array },
  deps: ModerateImageDeps = {},
): Promise<ImageModeration> {
  if (await orgIsDemo(ctx.orgId)) return { held: false, flag: null };
  const moderator = deps.moderator ?? getImageModerator();
  const timeoutMs =
    typeof deps.timeoutMs === "number" && deps.timeoutMs > 0
      ? deps.timeoutMs
      : IMAGE_MODERATION_TIMEOUT_MS;
  const target = { targetCollection: "media_assets", targetId: asset.id };
  let res: SubResult;
  try {
    res = await checkWithTimeout(
      moderator,
      {
        orgId: ctx.orgId,
        texts: [],
        urls: [],
        images: [
          asset.bytes
            ? { url: asset.url, bytes: asset.bytes }
            : { url: asset.url },
        ],
      },
      timeoutMs,
    );
  } catch (err) {
    const reason =
      err instanceof ModerationTimeout
        ? "image moderator timed out"
        : "image moderator unavailable";
    return {
      held: false,
      flag: contentFlagBody(ctx, {
        ...target,
        verdict: "error",
        reasons: [reason],
        status: "queued",
        source: "image",
      }),
    };
  }
  const reasons = Array.isArray(res?.reasons) ? res.reasons : [];
  if (res?.verdict === "held" || res?.verdict === "unsure") {
    return {
      held: res.verdict === "held",
      flag: contentFlagBody(ctx, {
        ...target,
        verdict: res.verdict,
        reasons,
        status: "open",
        source: "image",
      }),
    };
  }
  return { held: false, flag: null };
}
