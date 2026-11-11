// getVideoTranscoder selector, the fake transcoder and the separate video queue (07-13
// choice 9; G11; RESEARCH Pitfall 5; T-07-13-11).
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { imageQueue, videoQueue } from "../queue";
import { createFakeTranscoder } from "./fake";
import { TranscodeFailed } from "./ffmpeg";
import { getVideoTranscoder, resetVideoTranscoderForTests } from "./transcoder";

const dir = mkdtempSync(join(tmpdir(), "cds-fake-tc-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("getVideoTranscoder", () => {
  beforeEach(() => resetVideoTranscoderForTests());

  it("unset or ffmpeg selects ffmpeg; fake selects the fake", () => {
    expect(getVideoTranscoder({}).name).toBe("ffmpeg");
    expect(getVideoTranscoder({ CDS_VIDEO_TRANSCODER: "ffmpeg" }).name).toBe(
      "ffmpeg",
    );
    expect(getVideoTranscoder({ CDS_VIDEO_TRANSCODER: "fake" }).name).toBe(
      "fake",
    );
    expect(
      getVideoTranscoder({
        CDS_VIDEO_TRANSCODER: "ffmpeg",
        CDS_FFMPEG_PATH: "/opt/ffmpeg",
      }).name,
    ).toBe("ffmpeg");
  });

  it("refuses fake in production and unknown values", () => {
    expect(() =>
      getVideoTranscoder({
        CDS_VIDEO_TRANSCODER: "fake",
        CDS_ENV: "production",
      }),
    ).toThrow(/production/);
    expect(() => getVideoTranscoder({ CDS_VIDEO_TRANSCODER: "x264" })).toThrow(
      "CDS_VIDEO_TRANSCODER must be ffmpeg or fake",
    );
  });
});

describe("createFakeTranscoder", () => {
  it("probes by path, copies on transcode, fails the first N, writes a JPEG frame", async () => {
    const t = createFakeTranscoder({ failTranscodes: 1 });
    expect((await t.probe("/x/in.mp4")).hasVideoStream).toBe(true);
    expect((await t.probe("/x/in.bad")).hasVideoStream).toBe(false);
    const inp = join(dir, "in.mp4");
    const out = join(dir, "out.mp4");
    writeFileSync(inp, new Uint8Array(1234));
    await expect(
      t.transcode({ inputPath: inp, outputPath: out, timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(TranscodeFailed);
    const r = await t.transcode({
      inputPath: inp,
      outputPath: out,
      timeoutMs: 1000,
    });
    expect(r).toEqual({ durationS: 10, width: 1280, height: 720, bytes: 1234 });
    expect(readFileSync(out).length).toBe(1234);
    expect(t.transcodes).toBe(2);
    const frame = join(dir, "frame.jpg");
    await t.extractFrame({
      inputPath: out,
      outputPath: frame,
      atSeconds: 1,
      timeoutMs: 1000,
    });
    expect(existsSync(frame)).toBe(true);
    const m = await sharp(readFileSync(frame)).metadata();
    expect(m).toMatchObject({ format: "jpeg", width: 320, height: 180 });
  });

  it("hang waits for the timeout and fails", async () => {
    const t = createFakeTranscoder({ hang: true });
    await expect(
      t.transcode({ inputPath: "a", outputPath: "b", timeoutMs: 20 }),
    ).rejects.toMatchObject({ reason: "timeout" });
  });
});

describe("videoQueue", () => {
  it("is separate from imageQueue: neither waits for the other", async () => {
    expect(videoQueue).not.toBe(imageQueue);
    let releaseVideo!: () => void;
    const videoHeld = new Promise<void>((r) => (releaseVideo = r));
    let videoDone = false;
    const v = videoQueue.run(async () => {
      await videoHeld;
      videoDone = true;
    });
    const img = await imageQueue.run(async () => "image ran");
    expect(img).toBe("image ran");
    expect(videoDone).toBe(false);
    let releaseImage!: () => void;
    const imageHeld = new Promise<void>((r) => (releaseImage = r));
    const i2 = imageQueue.run(() => imageHeld);
    releaseVideo();
    await v;
    expect(videoDone).toBe(true);
    expect(await videoQueue.run(async () => "video ran")).toBe("video ran");
    releaseImage();
    await i2;
  });
});
