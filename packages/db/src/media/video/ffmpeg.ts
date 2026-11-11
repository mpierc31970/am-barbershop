// The ffmpeg VideoTranscoder (07-13; CONTEXT Area 1 Q4 and decision 3, RESEARCH Pitfalls 4/5,
// plan choices 5-8; T-07-13-01, -02, -03, -05, -08). ffmpeg and ffprobe come from the OS
// (`CDS_FFMPEG_PATH` / `CDS_FFPROBE_PATH`), never an npm binary.
//
// Args arrays only, never a shell; stderr never logged. Every child runs with
//   - shell: false and an explicit minimal environment (PATH and LC_ALL only), so no secret
//     env var reaches it
//   - `-protocol_whitelist file` and a forced `-f mov` demuxer: no network, no playlists
//   - a SIGKILL timeout below the stuck threshold (choice 7), `nice -n 10` on Linux
// Output: H.264 High CRF 26 veryfast yuv420p, at most 30 fps, inside 1920x1080 (landscape) or
// 1080x1920 (portrait), never enlarged, even dimensions; AAC 128k stereo; +faststart; every
// metadata tag dropped (phone GPS / device, T-07-13-05).
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import type {
  FrameJob,
  TranscodeJob,
  TranscodeResult,
  VideoProbe,
  VideoTranscoder,
} from "../ports";

const MIN = 60_000;

export const PROBE_TIMEOUT_MS = 60_000;
export const FRAME_TIMEOUT_MS = 120_000;
const STDOUT_MAX = 1024 * 1024;
const STDERR_RING = 16 * 1024;

/** Choice 5: fit inside 1920x1080 (landscape) / 1080x1920 (portrait), square inside 1080. */
export const SCALE_FILTER =
  "scale=w='min(iw,if(gte(iw,ih),1920,1080))':h='min(ih,if(gte(iw,ih),1080,1920))':force_original_aspect_ratio=decrease:force_divisible_by=2";

function safeDuration(durationS: number): number {
  return Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
}

/** Transcode timeout: max(25 min, 3.5 x duration), always below the stuck threshold. */
export function transcodeTimeoutMs(durationS: number): number {
  return Math.max(25 * MIN, Math.ceil(3.5 * safeDuration(durationS) * 1000));
}

/** Stuck threshold (resolution e): max(30 min, 4 x duration). */
export function stuckThresholdMs(durationS: number): number {
  return Math.max(30 * MIN, Math.ceil(4 * safeDuration(durationS) * 1000));
}

/** Poster frame time (choice 8): 1 s, or 10 % of a clip of 2 s or less. */
export function posterAtSeconds(durationS: number): number {
  const d = safeDuration(durationS);
  return d <= 2 ? d * 0.1 : 1;
}

export function buildProbeArgs(input: string): string[] {
  return [
    "-v",
    "error",
    "-protocol_whitelist",
    "file",
    "-f",
    "mov",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    input,
  ];
}

export function buildTranscodeArgs(input: string, output: string): string[] {
  return [
    "-nostdin",
    "-hide_banner",
    "-y",
    "-protocol_whitelist",
    "file",
    "-f",
    "mov",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-sn",
    "-dn",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-preset",
    "veryfast",
    "-crf",
    "26",
    "-pix_fmt",
    "yuv420p",
    "-fpsmax",
    "30",
    "-vf",
    SCALE_FILTER,
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-threads",
    "1",
    output,
  ];
}

export function buildFrameArgs(
  input: string,
  output: string,
  atSeconds: number,
): string[] {
  const at = Number.isFinite(atSeconds) && atSeconds > 0 ? atSeconds : 0;
  return [
    "-nostdin",
    "-hide_banner",
    "-y",
    "-protocol_whitelist",
    "file",
    "-ss",
    at.toFixed(3),
    "-f",
    "mov",
    "-i",
    input,
    "-map_metadata",
    "-1",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    "-threads",
    "1",
    output,
  ];
}

type ProbeStream = {
  codec_type?: unknown;
  width?: unknown;
  height?: unknown;
  duration?: unknown;
  tags?: { rotate?: unknown } | null;
  side_data_list?: Array<{ rotation?: unknown }> | null;
};

const NO_VIDEO: VideoProbe = Object.freeze({
  hasVideoStream: false,
  durationS: 0,
  width: 0,
  height: 0,
}) as VideoProbe;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function rotationOf(s: ProbeStream): number {
  for (const d of Array.isArray(s.side_data_list) ? s.side_data_list : []) {
    if (d && d.rotation !== undefined) return num(d.rotation);
  }
  return num(s.tags?.rotate);
}

/** ffprobe JSON -> VideoProbe; malformed or audio-only input -> no video stream. */
export function parseProbeJson(stdout: string): VideoProbe {
  let data: { streams?: unknown; format?: { duration?: unknown } | null };
  try {
    data = JSON.parse(stdout) as typeof data;
  } catch {
    return { ...NO_VIDEO };
  }
  if (!data || typeof data !== "object") return { ...NO_VIDEO };
  const streams = Array.isArray(data.streams)
    ? (data.streams as ProbeStream[])
    : [];
  const v = streams.find((s) => s && s.codec_type === "video");
  if (!v) return { ...NO_VIDEO };
  let width = Math.max(0, Math.round(num(v.width)));
  let height = Math.max(0, Math.round(num(v.height)));
  const rot = Math.abs(Math.round(rotationOf(v))) % 180;
  if (rot === 90) [width, height] = [height, width];
  const durationS = Math.max(0, num(data.format?.duration) || num(v.duration));
  return { hasVideoStream: true, durationS, width, height };
}

/** A child exited non-zero or timed out. The message never carries stderr or paths. */
export class TranscodeFailed extends Error {
  readonly code = "transcode_failed";
  readonly reason: "exit" | "timeout";
  readonly exitCode: number | null;
  constructor(reason: "exit" | "timeout", exitCode: number | null = null) {
    super(
      reason === "timeout"
        ? "video processing timed out"
        : `video processing failed (exit ${exitCode ?? "?"})`,
    );
    this.name = "TranscodeFailed";
    this.reason = reason;
    this.exitCode = exitCode;
  }
}

/** The ffmpeg / ffprobe binary is missing (ENOENT). The route answers 503. */
export class TranscoderUnavailable extends Error {
  readonly code = "transcoder_unavailable";
  constructor() {
    super("video processing is not available");
    this.name = "TranscoderUnavailable";
  }
}

type Readable = {
  on(event: "data", fn: (chunk: Buffer | string) => void): unknown;
};

/** The slice of ChildProcess runProcess uses (tests inject an EventEmitter fake). */
export type ChildLike = {
  stdout?: Readable | null;
  stderr?: Readable | null;
  on(event: "error", fn: (err: NodeJS.ErrnoException) => void): unknown;
  on(
    event: "close",
    fn: (code: number | null, signal: string | null) => void,
  ): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
};

export type SpawnOptions = {
  shell: false;
  stdio: ["ignore", "ignore" | "pipe", "pipe"];
  env: Record<string, string>;
  windowsHide: true;
};

export type SpawnImpl = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildLike;

// The explicit env is a plain record; Next's ProcessEnv typing (NODE_ENV required) is widened
// here so @cds/web typechecks this file too.
const defaultSpawn: SpawnImpl = (command, args, options) =>
  nodeSpawn(command, args, {
    ...options,
    env: options.env as NodeJS.ProcessEnv,
  }) as unknown as ChildLike;

let niceBin: string | null | undefined;

/** `nice` on Linux when present, decided once per process (choice 6). */
export function niceBinary(): string | null {
  if (niceBin === undefined) {
    niceBin =
      process.platform !== "linux"
        ? null
        : existsSync("/usr/bin/nice")
          ? "/usr/bin/nice"
          : existsSync("/bin/nice")
            ? "/bin/nice"
            : null;
  }
  return niceBin;
}

export type RunOptions = {
  timeoutMs: number;
  spawnImpl?: SpawnImpl;
  /** Collect stdout (probe only). */
  stdout?: boolean;
  /** Override the per-process `nice` decision (tests). */
  nice?: string | null;
};

/** The child's whole environment: never the inherited one (choice 6). */
export function childEnv(): Record<string, string> {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C" };
}

/**
 * Run one binary with an args array. Resolves `{ stdout }` on exit 0; a non-zero exit or a
 * timeout (SIGKILL) rejects with TranscodeFailed; ENOENT with TranscoderUnavailable. stderr is
 * kept to its last 16 KB in memory and never logged or put in an error message.
 */
export function runProcess(
  bin: string,
  args: string[],
  opts: RunOptions,
): Promise<{ stdout: string }> {
  const spawnImpl = opts.spawnImpl ?? defaultSpawn;
  const nice = opts.nice === undefined ? niceBinary() : opts.nice;
  const command = nice ? nice : bin;
  const argv = nice ? ["-n", "10", bin, ...args] : [...args];
  return new Promise((resolve, reject) => {
    let settled = false;
    let out = "";
    let outBytes = 0;
    let errTail = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    let child: ChildLike;
    try {
      child = spawnImpl(command, argv, {
        shell: false,
        stdio: ["ignore", opts.stdout ? "pipe" : "ignore", "pipe"],
        env: childEnv(),
        windowsHide: true,
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      reject(
        code === "ENOENT"
          ? new TranscoderUnavailable()
          : new TranscodeFailed("exit", null),
      );
      return;
    }
    child.stdout?.on("data", (chunk) => {
      if (outBytes >= STDOUT_MAX) return;
      const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      outBytes += s.length;
      out += s;
    });
    child.stderr?.on("data", (chunk) => {
      const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      errTail = (errTail + s).slice(-STDERR_RING);
    });
    child.on("error", (err) => {
      done(() =>
        reject(
          err?.code === "ENOENT"
            ? new TranscoderUnavailable()
            : new TranscodeFailed("exit", null),
        ),
      );
    });
    child.on("close", (code) => {
      done(() => {
        if (code === 0) resolve({ stdout: out });
        // `nice` exits 127 when it cannot find the binary it was asked to run.
        else if (nice && code === 127) reject(new TranscoderUnavailable());
        else reject(new TranscodeFailed("exit", code));
      });
    });
    timer = setTimeout(() => {
      done(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
        reject(new TranscodeFailed("timeout", null));
      });
    }, opts.timeoutMs);
    // errTail is deliberately unused beyond the ring: it contains paths (T-07-13-08).
    void errTail;
  });
}

export type FfmpegTranscoderOptions = {
  ffmpegPath?: string;
  ffprobePath?: string;
  spawnImpl?: SpawnImpl;
  nice?: string | null;
};

export function createFfmpegTranscoder(
  opts: FfmpegTranscoderOptions = {},
): VideoTranscoder {
  const ffmpeg = opts.ffmpegPath || "ffmpeg";
  const ffprobe = opts.ffprobePath || "ffprobe";
  const base = {
    ...(opts.spawnImpl ? { spawnImpl: opts.spawnImpl } : {}),
    ...(opts.nice !== undefined ? { nice: opts.nice } : {}),
  };

  async function probe(inputPath: string): Promise<VideoProbe> {
    try {
      const { stdout } = await runProcess(ffprobe, buildProbeArgs(inputPath), {
        ...base,
        timeoutMs: PROBE_TIMEOUT_MS,
        stdout: true,
      });
      return parseProbeJson(stdout);
    } catch (err) {
      if (err instanceof TranscoderUnavailable) throw err;
      // ffprobe refused the file: not a video we can use.
      return { ...NO_VIDEO };
    }
  }

  return {
    name: "ffmpeg",
    probe,
    async transcode(job: TranscodeJob): Promise<TranscodeResult> {
      await runProcess(
        ffmpeg,
        buildTranscodeArgs(job.inputPath, job.outputPath),
        { ...base, timeoutMs: job.timeoutMs },
      );
      const out = await probe(job.outputPath);
      if (!out.hasVideoStream) throw new TranscodeFailed("exit", null);
      const st = await stat(job.outputPath);
      return {
        durationS: out.durationS,
        width: out.width,
        height: out.height,
        bytes: st.size,
      };
    },
    async extractFrame(job: FrameJob): Promise<void> {
      await runProcess(
        ffmpeg,
        buildFrameArgs(job.inputPath, job.outputPath, job.atSeconds),
        { ...base, timeoutMs: job.timeoutMs || FRAME_TIMEOUT_MS },
      );
    },
  };
}
