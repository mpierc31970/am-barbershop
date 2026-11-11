// Image moderation sub-port selection (13-08 choice 2; STAFF-23, D248).
// Stand-in: skippedImageModerator never blocks and never calls anything; it reports
// `skipped`, which adds a reason but never changes the composite verdict. The real
// moderator (AWS Rekognition) is a GO-LIVE row. CDS_IMAGE_MODERATOR unset / "skip" → the
// stand-in; any other value throws (fail loud).
import type { ImageModerator, SubResult } from "../ports";

export const skippedImageModerator: ImageModerator = {
  name: "skipped",
  async check(): Promise<SubResult> {
    return { verdict: "skipped", reasons: ["stand-in"], provider: "skipped" };
  },
};

export function getImageModerator(): ImageModerator {
  const v = process.env.CDS_IMAGE_MODERATOR;
  if (v === undefined || v === "" || v === "skip") return skippedImageModerator;
  throw new Error(
    `CDS_IMAGE_MODERATOR="${v}" has no implementation yet (unset it to use the skipped stand-in)`,
  );
}
