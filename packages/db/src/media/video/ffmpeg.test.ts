// ffmpeg transcoder (07-13 choices 5-8; T-07-13-01, -02, -03, -08): args, timeouts, probe JSON
// and runProcess with an injected fake spawn.
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFrameArgs,
  buildProbeArgs,
  buildTranscodeArgs,
  createFfmpegTranscoder,
  parseProbeJson,
  posterAtSeconds,
  runProcess,
  SCALE_FILTER,
  stuckThresholdMs,
  TranscodeFailed,
  transcodeTimeoutMs,
  TranscoderUnavailable,
  type ChildLike,
  type SpawnImpl,
  type SpawnOptions,
} from "./ffmpeg";

const MIN = 60_000;

describe("buildTranscodeArgs", () => {
  const args = buildTranscodeArgs("/tmp/in.mp4", "/tmp/out.mp4");
  const at = (v: string) => args.indexOf(v);

  it("is an args array with the decided profile, in order", () => {
    expect(Array.isArray(args)).toBe(true);
    for (const a of args) {
      if (a !== SCALE_FILTER) expect(a.includes(" ")).toBe(false);
    }
    expect(at("-nostdin")).toBeGreaterThanOrEqual(0);
    expect(args[at("-protocol_whitelist") + 1]).toBe("file");
    expect(args[at("-f") + 1]).toBe("mov");
    expect(at("-f")).toBeLessThan(at("-i"));
    expect(args[at("-i") + 1]).toBe("/tmp/in.mp4");
    expect(args[at("-map_metadata") + 1]).toBe("-1");
    expect(args[at("-c:v") + 1]).toBe("libx264");
    expect(args[at("-profile:v") + 1]).toBe("high");
    expect(args[at("-preset") + 1]).toBe("veryfast");
    expect(args[at("-crf") + 1]).toBe("26");
    expect(args[at("-pix_fmt") + 1]).toBe("yuv420p");
    expect(args[at("-fpsmax") + 1]).toBe("30");
    expect(args[at("-vf") + 1]).toBe(SCALE_FILTER);
    expect(SCALE_FILTER).toContain("if(gte(iw,ih),1920,1080)");
    expect(SCALE_FILTER).toContain("force_divisible_by=2");
    expect(args[at("-c:a") + 1]).toBe("aac");
    expect(args[at("-b:a") + 1]).toBe("128k");
    expect(args[at("-movflags") + 1]).toBe("+faststart");
    expect(args[at("-threads") + 1]).toBe("1");
    expect(args.at(-1)).toBe("/tmp/out.mp4");
    // RESEARCH order: input, maps, video, audio, faststart, output
    expect(at("-i")).toBeLessThan(at("-map_metadata"));
    expect(at("-map_metadata")).toBeLessThan(at("-c:v"));
    expect(at("-c:v")).toBeLessThan(at("-c:a"));
    expect(at("-c:a")).toBeLessThan(at("-movflags"));
  });

  it("probe forces mov, file-only, JSON; frame uses -ss and one frame", () => {
    const p = buildProbeArgs("/tmp/x.mp4");
    expect(p[p.indexOf("-f") + 1]).toBe("mov");
    expect(p[p.indexOf("-protocol_whitelist") + 1]).toBe("file");
    expect(p[p.indexOf("-print_format") + 1]).toBe("json");
    expect(p.at(-1)).toBe("/tmp/x.mp4");
    const f = buildFrameArgs("/tmp/o.mp4", "/tmp/f.jpg", 1);
    expect(f[f.indexOf("-ss") + 1]).toBe("1.000");
    expect(f[f.indexOf("-frames:v") + 1]).toBe("1");
    expect(f[f.indexOf("-protocol_whitelist") + 1]).toBe("file");
    expect(f.at(-1)).toBe("/tmp/f.jpg");
  });
});

describe("timeouts and poster time", () => {
  it("transcode timeout stays below the stuck threshold", () => {
    expect(transcodeTimeoutMs(60)).toBe(25 * MIN);
    expect(transcodeTimeoutMs(1200)).toBe(3.5 * 1200 * 1000);
    expect(stuckThresholdMs(60)).toBe(30 * MIN);
    expect(stuckThresholdMs(1200)).toBe(4 * 1200 * 1000);
    for (const d of [0, 1, 60, 300, 428, 440, 450, 600, 1200, 7200, NaN, -5]) {
      expect(transcodeTimeoutMs(d)).toBeLessThan(stuckThresholdMs(d));
    }
  });

  it("poster at 1 s, or 10 % of a short clip", () => {
    expect(posterAtSeconds(30)).toBe(1);
    expect(posterAtSeconds(1.5)).toBeCloseTo(0.15);
    expect(posterAtSeconds(2)).toBeCloseTo(0.2);
  });
});

describe("parseProbeJson", () => {
  it("reads the video stream and duration", () => {
    const json = JSON.stringify({
      streams: [
        { codec_type: "audio" },
        { codec_type: "video", width: 1920, height: 1080 },
      ],
      format: { duration: "12.5" },
    });
    expect(parseProbeJson(json)).toEqual({
      hasVideoStream: true,
      durationS: 12.5,
      width: 1920,
      height: 1080,
    });
  });

  it("swaps width and height for a rotated stream", () => {
    const side = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          width: 1920,
          height: 1080,
          side_data_list: [{ rotation: -90 }],
        },
      ],
      format: { duration: "3" },
    });
    expect(parseProbeJson(side)).toMatchObject({ width: 1080, height: 1920 });
    const tag = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          width: 1920,
          height: 1080,
          tags: { rotate: "270" },
        },
      ],
      format: { duration: "3" },
    });
    expect(parseProbeJson(tag)).toMatchObject({ width: 1080, height: 1920 });
  });

  it("audio-only and malformed input have no video stream", () => {
    const audio = JSON.stringify({
      streams: [{ codec_type: "audio" }],
      format: { duration: "4" },
    });
    expect(parseProbeJson(audio).hasVideoStream).toBe(false);
    expect(parseProbeJson("{nope")).toEqual({
      hasVideoStream: false,
      durationS: 0,
      width: 0,
      height: 0,
    });
  });
});

type Fake = ChildLike &
  EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    killed: string | null;
  };

function fakeSpawn(): {
  impl: SpawnImpl;
  calls: Array<{ command: string; args: string[]; options: SpawnOptions }>;
  child: () => Fake;
} {
  const calls: Array<{
    command: string;
    args: string[];
    options: SpawnOptions;
  }> = [];
  let last: Fake | null = null;
  const impl: SpawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const c = new EventEmitter() as Fake;
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.killed = null;
    c.kill = (sig) => {
      c.killed = String(sig);
      return true;
    };
    last = c;
    return c;
  };
  return { impl, calls, child: () => last! };
}

describe("runProcess", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("spawns without a shell, with only PATH and LC_ALL, and resolves on exit 0", async () => {
    const s = fakeSpawn();
    const p = runProcess("ffprobe", ["-v", "error"], {
      timeoutMs: 1000,
      spawnImpl: s.impl,
      nice: null,
      stdout: true,
    });
    s.child().stdout.emit("data", Buffer.from('{"a":1}'));
    s.child().stderr.emit("data", Buffer.from("/secret/path noise"));
    s.child().emit("close", 0, null);
    await expect(p).resolves.toEqual({ stdout: '{"a":1}' });
    const call = s.calls[0]!;
    expect(call.command).toBe("ffprobe");
    expect(call.options.shell).toBe(false);
    expect(Object.keys(call.options.env).sort()).toEqual(["LC_ALL", "PATH"]);
    expect(call.options.env.LC_ALL).toBe("C");
  });

  it("prefixes nice -n 10 when nice is present", async () => {
    const s = fakeSpawn();
    const p = runProcess("ffmpeg", ["-x"], {
      timeoutMs: 1000,
      spawnImpl: s.impl,
      nice: "/usr/bin/nice",
    });
    s.child().emit("close", 0, null);
    await p;
    expect(s.calls[0]!.command).toBe("/usr/bin/nice");
    expect(s.calls[0]!.args).toEqual(["-n", "10", "ffmpeg", "-x"]);
  });

  it("a non-zero exit is TranscodeFailed without stderr in the message", async () => {
    const s = fakeSpawn();
    const p = runProcess("ffmpeg", [], {
      timeoutMs: 1000,
      spawnImpl: s.impl,
      nice: null,
    });
    s.child().stderr.emit(
      "data",
      "/tmp/cds-video/org/asset/input.mp4: Invalid data",
    );
    s.child().emit("close", 1, null);
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscodeFailed);
    expect((err as TranscodeFailed).code).toBe("transcode_failed");
    expect((err as TranscodeFailed).exitCode).toBe(1);
    expect((err as Error).message).not.toContain("/tmp");
    expect((err as Error).message).not.toContain("Invalid");
  });

  it("a timeout kills with SIGKILL", async () => {
    vi.useFakeTimers();
    const s = fakeSpawn();
    const p = runProcess("ffmpeg", [], {
      timeoutMs: 5000,
      spawnImpl: s.impl,
      nice: null,
    });
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5001);
    const err = await caught;
    expect(err).toBeInstanceOf(TranscodeFailed);
    expect((err as TranscodeFailed).reason).toBe("timeout");
    expect(s.child().killed).toBe("SIGKILL");
  });

  it("ENOENT is TranscoderUnavailable", async () => {
    const s = fakeSpawn();
    const p = runProcess("ffmpeg", [], {
      timeoutMs: 1000,
      spawnImpl: s.impl,
      nice: null,
    });
    s.child().emit(
      "error",
      Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }),
    );
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TranscoderUnavailable);
    expect((err as TranscoderUnavailable).code).toBe("transcoder_unavailable");
  });
});

describe("createFfmpegTranscoder", () => {
  it("probe runs ffprobe and a refused file has no video stream", async () => {
    const s = fakeSpawn();
    const t = createFfmpegTranscoder({
      ffprobePath: "/opt/ffprobe",
      spawnImpl: s.impl,
      nice: null,
    });
    const p = t.probe("/tmp/a.mp4");
    await Promise.resolve();
    expect(s.calls[0]!.command).toBe("/opt/ffprobe");
    s.child().emit("close", 1, null);
    await expect(p).resolves.toMatchObject({ hasVideoStream: false });
  });

  it("probe propagates a missing binary", async () => {
    const s = fakeSpawn();
    const t = createFfmpegTranscoder({ spawnImpl: s.impl, nice: null });
    const p = t.probe("/tmp/a.mp4");
    await Promise.resolve();
    s.child().emit("error", Object.assign(new Error("x"), { code: "ENOENT" }));
    await expect(p).rejects.toBeInstanceOf(TranscoderUnavailable);
  });
});
