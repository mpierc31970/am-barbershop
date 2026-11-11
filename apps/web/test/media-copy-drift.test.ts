// 07-17 choice 2: the media copy @cds/ui/hub needs before any request is mirrored from
// @cds/db, never re-typed by hand; this test pins the two together.
import {
  AUDIO_COPY,
  AUDIO_MAX_BYTES,
  CHUNK_LIMITS,
  CHUNK_PART_BYTES,
  USAGE_COPY,
  VIDEO_COPY,
  VIDEO_MAX_BYTES,
  VTT_MAX_BYTES,
} from "@cds/db";
import { describe, expect, it } from "vitest";
import {
  MEDIA_COPY,
  MEDIA_LIMITS,
  videoTooBigCopy,
} from "../../../packages/ui/src/hub/media/copy";
import { MAX_PART_BYTES } from "../../../packages/ui/src/hub/media/upload";

const MB = 1024 * 1024;

describe("media copy drift (@cds/ui vs @cds/db)", () => {
  it("video copy", () => {
    expect(MEDIA_COPY.videoProcessing).toBe(VIDEO_COPY.processing);
    expect(MEDIA_COPY.videoFailed).toBe(VIDEO_COPY.failed);
    expect(MEDIA_COPY.videoFailedFinal).toBe(VIDEO_COPY.failedFinal);
    expect(MEDIA_COPY.videoWaiting).toBe(VIDEO_COPY.waiting);
    expect(MEDIA_COPY.videoType).toBe(VIDEO_COPY.type);
    expect(MEDIA_COPY.captions).toBe(VIDEO_COPY.captions);
  });

  it("too-big, audio and usage copy", () => {
    for (const bytes of [412 * MB, 251 * MB, 250 * MB + 1, 1024 * MB]) {
      expect(videoTooBigCopy(bytes)).toBe(CHUNK_LIMITS.video.tooBig(bytes));
    }
    expect(MEDIA_COPY.audio).toBe(AUDIO_COPY);
    expect(MEDIA_COPY.usageFull).toBe(USAGE_COPY.member);
  });

  it("limits", () => {
    expect(MEDIA_LIMITS.video).toBe(VIDEO_MAX_BYTES);
    expect(MEDIA_LIMITS.audio).toBe(AUDIO_MAX_BYTES);
    expect(MEDIA_LIMITS.captions).toBe(VTT_MAX_BYTES);
    expect(MAX_PART_BYTES).toBe(CHUNK_PART_BYTES);
  });
});
