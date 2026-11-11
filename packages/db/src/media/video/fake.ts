// The fake VideoTranscoder (07-13; G11 stand-in). Tests and dev seeding with
// CDS_VIDEO_TRANSCODER=fake (refused in production by the selector). Never in the barrel.
//   - probe: a video stream unless the path ends `.bad`; 10 s, 1280x720 (overridable)
//   - transcode: copies input to output; the first `failTranscodes` calls fail; `hang` waits
//     for the job timeout; `gate` lets a test hold a job mid-run
//   - extractFrame: a 320x180 JPEG made with sharp
import { copyFile, stat, writeFile } from "node:fs/promises";
import type {
  FrameJob,
  TranscodeJob,
  TranscodeResult,
  VideoProbe,
  VideoTranscoder,
} from "../ports";
import { TranscodeFailed } from "./ffmpeg";

export type FakeTranscoderOptions = {
  probe?: (path: string) => VideoProbe;
  failTranscodes?: number;
  hang?: boolean;
  gate?: () => Promise<void>;
  result?: Partial<Omit<TranscodeResult, "bytes">>;
};

export type FakeTranscoder = VideoTranscoder & {
  readonly transcodes: number;
};

export function createFakeTranscoder(
  opts: FakeTranscoderOptions = {},
): FakeTranscoder {
  let transcodes = 0;
  let failuresLeft = opts.failTranscodes ?? 0;
  return {
    name: "fake",
    get transcodes() {
      return transcodes;
    },
    async probe(path: string): Promise<VideoProbe> {
      if (opts.probe) return opts.probe(path);
      return {
        hasVideoStream: !path.endsWith(".bad"),
        durationS: 10,
        width: 1280,
        height: 720,
      };
    },
    async transcode(job: TranscodeJob): Promise<TranscodeResult> {
      transcodes += 1;
      if (opts.gate) await opts.gate();
      if (opts.hang) {
        await new Promise((r) => setTimeout(r, job.timeoutMs));
        throw new TranscodeFailed("timeout", null);
      }
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new TranscodeFailed("exit", 1);
      }
      await copyFile(job.inputPath, job.outputPath);
      const st = await stat(job.outputPath);
      return {
        durationS: opts.result?.durationS ?? 10,
        width: opts.result?.width ?? 1280,
        height: opts.result?.height ?? 720,
        bytes: st.size,
      };
    },
    async extractFrame(job: FrameJob): Promise<void> {
      const sharp = (await import("sharp")).default;
      const jpg = await sharp({
        create: {
          width: 320,
          height: 180,
          channels: 3,
          background: { r: 20, g: 90, b: 160 },
        },
      })
        .jpeg()
        .toBuffer();
      await writeFile(job.outputPath, jpg);
    },
  };
}
