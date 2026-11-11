// 07-17 Task 1: media copy and view helpers (07-UI-SPEC "Media", "Media picker",
// "Copywriting Contract"; CONT-14, CONT-19, CONT-21).
import { describe, expect, it } from "vitest";
import {
  MEDIA_ACCEPT,
  MEDIA_COPY,
  MEDIA_PAGE_SIZE,
  POLL_MS,
  deleteLabel,
  deleteTitle,
  deletedToast,
  describeNotice,
  formatDuration,
  isPolling,
  keepLabel,
  leftCount,
  pickerEmpty,
  pickerTitle,
  readyToast,
  tileMeta,
  tileName,
  uploadedToast,
  pickerUseLabel,
  videoBadge,
  videoTooBigCopy,
} from "./copy";

const MB = 1024 * 1024;

describe("media copy", () => {
  it("counts and notices read naturally", () => {
    expect(describeNotice(12)).toBe("12 photos need a description");
    expect(describeNotice(1)).toBe("1 photo needs a description");
    expect(leftCount(12)).toBe("12 left");
    expect(uploadedToast(5)).toBe(
      "5 photos uploaded. Add their descriptions so everyone can see them.",
    );
    expect(readyToast("Tour.mp4")).toBe("Tour.mp4 is ready.");
  });

  it("picker titles and primaries follow the kind and count", () => {
    expect(pickerTitle("image")).toBe("Choose a photo");
    expect(pickerTitle("image", true)).toBe("Choose photos");
    expect(pickerTitle("video")).toBe("Choose a video");
    expect(pickerTitle("audio")).toBe("Choose audio");
    expect(pickerUseLabel("image", 1)).toBe("Use this photo");
    expect(pickerUseLabel("image", 3)).toBe("Use 3 photos");
    expect(pickerUseLabel("video", 1)).toBe("Use this video");
    expect(pickerUseLabel("audio", 1)).toBe("Use this audio");
    expect(pickerEmpty("video")).toBe(
      "No videos yet. Upload an MP4 here, or paste a YouTube link in the video settings instead.",
    );
  });

  it("delete dialog copy per kind", () => {
    expect(deleteTitle("IMG_2041.jpg")).toBe("Delete IMG_2041.jpg?");
    expect(deleteLabel("image")).toBe("Delete photo");
    expect(keepLabel("image")).toBe("Keep photo");
    expect(deleteLabel("video")).toBe("Delete video");
    expect(keepLabel("audio")).toBe("Keep audio");
    expect(deletedToast("image")).toBe("Photo deleted.");
    expect(deletedToast("video")).toBe("Video deleted.");
    expect(MEDIA_COPY.deleteUnusedBody).toBe(
      "It's deleted for good and stops loading anywhere.",
    );
  });

  it("UI-SPEC strings are verbatim", () => {
    expect(MEDIA_COPY.emptyHeading).toBe("No media yet");
    expect(MEDIA_COPY.keepOpen).toBe(
      "Keep this page open until the upload finishes.",
    );
    expect(videoTooBigCopy(412 * MB)).toBe(
      "This video is 412 MB. The limit is 250 MB: export a shorter or smaller copy, or upload it to YouTube and paste the link.",
    );
    expect(MEDIA_COPY.altHelper).toBe(
      "Describe the photo for people who can't see it, like 'Loaves cooling on a rack' (also called alt text).",
    );
    expect(MEDIA_PAGE_SIZE).toBe(60);
    expect(POLL_MS).toBe(10_000);
    expect(MEDIA_ACCEPT).toContain("video/mp4");
    expect(MEDIA_ACCEPT).toContain("audio/mpeg");
  });

  it("formats durations", () => {
    expect(formatDuration(42)).toBe("0:42");
    expect(formatDuration(192)).toBe("3:12");
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("tile meta per kind", () => {
    expect(
      tileMeta({
        kind: "image",
        width: 2560,
        height: 1707,
        bytes: Math.round(1.8 * MB),
        durationS: 0,
      }),
    ).toBe("2560 × 1707 · 1.8 MB");
    expect(
      tileMeta({
        kind: "video",
        width: 0,
        height: 0,
        bytes: 18 * MB,
        durationS: 42,
      }),
    ).toBe("0:42 · 18.0 MB");
    expect(
      tileMeta({
        kind: "audio",
        width: 0,
        height: 0,
        bytes: Math.round(4.4 * MB),
        durationS: 192,
      }),
    ).toBe("3:12 · 4.4 MB");
  });

  it("tile names carry the kind and the state", () => {
    expect(
      tileName({
        name: "IMG_2041.jpg",
        kind: "image",
        needsDescription: true,
      }),
    ).toBe("IMG_2041.jpg, photo, needs description");
    expect(
      tileName({
        name: "Tour.mp4",
        kind: "video",
        needsDescription: false,
        videoState: "optimizing",
      }),
    ).toBe("Tour.mp4, video, optimizing");
    expect(
      tileName({ name: "Song.mp3", kind: "audio", needsDescription: false }),
    ).toBe("Song.mp3, audio");
  });

  it("video badges by state", () => {
    expect(videoBadge("waiting")).toEqual({
      label: "Waiting to optimize",
      tone: "waiting-optimize",
    });
    expect(videoBadge("optimizing")).toEqual({
      label: "Optimizing",
      tone: "optimizing",
    });
    expect(videoBadge("failed")?.tone).toBe("failed");
    expect(videoBadge("failed-final")?.label).toBe("Couldn't optimize");
    expect(videoBadge("ready")).toBeNull();
    expect(videoBadge(undefined)).toBeNull();
  });

  it("polls only while a video is waiting or optimizing", () => {
    expect(isPolling({ a: "ready", b: "failed" })).toBe(false);
    expect(isPolling({ a: "ready", b: "waiting" })).toBe(true);
    expect(isPolling(["optimizing"])).toBe(true);
    expect(isPolling([])).toBe(false);
  });
});
