// Range parsing and MIME mapping (07-09, CONT-19).
import { describe, expect, it } from "vitest";
import { PUBLIC_MEDIA_VARIANTS } from "../../storage/keys";
import { parseRangeHeader, publicMediaMime } from "./range";
import { publicKindForRow } from "./serve";

describe("parseRangeHeader", () => {
  it("resolves single ranges against the size", () => {
    expect(parseRangeHeader(null, 1000)).toBeNull();
    expect(parseRangeHeader("", 1000)).toBeNull();
    expect(parseRangeHeader("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader("bytes=900-", 1000)).toEqual({
      start: 900,
      end: 999,
    });
    expect(parseRangeHeader("bytes=-100", 1000)).toEqual({
      start: 900,
      end: 999,
    });
    expect(parseRangeHeader("bytes=-5000", 1000)).toEqual({
      start: 0,
      end: 999,
    });
    expect(parseRangeHeader("bytes=0-5000", 1000)).toEqual({
      start: 0,
      end: 999,
    });
    expect(parseRangeHeader("bytes=999-999", 1000)).toEqual({
      start: 999,
      end: 999,
    });
  });

  it("reports unsatisfiable ranges", () => {
    expect(parseRangeHeader("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=-0", 1000)).toBe("unsatisfiable");
  });

  it("ignores invalid or multi-range headers", () => {
    for (const h of [
      "bytes=5-2",
      "bytes=0-1,5-6",
      "items=0-1",
      "bytes=abc",
      "bytes=-",
      "bytes=1234567890123456-",
    ]) {
      expect(parseRangeHeader(h, 1000), h).toBeNull();
    }
    expect(parseRangeHeader("bytes=0-1", 0)).toBeNull();
    expect(parseRangeHeader("bytes=-5", 0)).toBeNull();
  });
});

describe("publicMediaMime", () => {
  it("maps every variant from the allowlist", () => {
    expect(publicMediaMime("w480")).toBe("image/webp");
    expect(publicMediaMime("w2560")).toBe("image/webp");
    expect(publicMediaMime("thumb")).toBe("image/webp");
    expect(publicMediaMime("poster.webp")).toBe("image/webp");
    expect(publicMediaMime("poster.jpg")).toBe("image/jpeg");
    expect(publicMediaMime("video.mp4")).toBe("video/mp4");
    expect(publicMediaMime("captions.vtt")).toBe("text/vtt; charset=utf-8");
    expect(publicMediaMime("audio.mp3")).toBe("audio/mpeg");
    for (const v of PUBLIC_MEDIA_VARIANTS)
      expect(publicMediaMime(v)).toBeTruthy();
  });
});

describe("publicKindForRow", () => {
  it("maps row kinds to public kinds", () => {
    expect(publicKindForRow("video")).toBe("video");
    expect(publicKindForRow("audio")).toBe("audio");
    for (const k of [
      "logo",
      "hero",
      "gallery",
      "team",
      "moodboard",
      "library",
    ]) {
      expect(publicKindForRow(k)).toBe("image");
    }
    expect(publicKindForRow("file")).toBeNull();
    expect(publicKindForRow(undefined)).toBeNull();
  });
});
