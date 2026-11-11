// mp3Info (07-12 choice 8; CONT-27): synthetic frames built byte by byte.
// Header FF FB 90 64 = MPEG-1 Layer III, no CRC, 128 kbit/s, 44.1 kHz, no padding, joint
// stereo: frame length floor(144 * 128000 / 44100) = 417 bytes.
import { describe, expect, it } from "vitest";
import { mp3Info } from "./mp3";

const FRAME_LEN = 417;

function frame(fill = 0): Uint8Array {
  const f = new Uint8Array(FRAME_LEN).fill(fill);
  f.set([0xff, 0xfb, 0x90, 0x64], 0);
  return f;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function id3(size: number): Uint8Array {
  const tag = new Uint8Array(10 + size);
  tag.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00], 0);
  tag[6] = (size >> 21) & 0x7f;
  tag[7] = (size >> 14) & 0x7f;
  tag[8] = (size >> 7) & 0x7f;
  tag[9] = size & 0x7f;
  return tag;
}

/** First frame carrying a Xing header with `frames` (stereo MPEG-1: side info 32 bytes). */
function xingFrame(frames: number, tag = "Xing"): Uint8Array {
  const f = frame();
  const off = 4 + 32;
  for (let i = 0; i < 4; i += 1) f[off + i] = tag.charCodeAt(i);
  f.set([0, 0, 0, 1], off + 4);
  f.set(
    [
      (frames >>> 24) & 0xff,
      (frames >>> 16) & 0xff,
      (frames >>> 8) & 0xff,
      frames & 0xff,
    ],
    off + 8,
  );
  return f;
}

function seeded(n: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = 0x12345678;
  for (let i = 0; i < n; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

describe("mp3Info", () => {
  it("accepts an ID3v2 tag plus two frames, duration from CBR", () => {
    const info = mp3Info(concat(id3(200), frame(), frame()));
    expect(info).not.toBeNull();
    expect(info!.durationS).toBe(0);
  });

  it("estimates CBR duration over many frames", () => {
    // 1000 frames * 417 bytes * 8 / 128000 = 26.06 s
    const frames = Array.from({ length: 1000 }, () => frame());
    expect(mp3Info(concat(...frames))).toEqual({ durationS: 26 });
  });

  it("uses a Xing frame count: frames * 1152 / 44100", () => {
    const bytes = concat(id3(30), xingFrame(3000), frame(), frame());
    // 3000 * 1152 / 44100 = 78.37 s
    expect(mp3Info(bytes)).toEqual({ durationS: 78 });
    expect(mp3Info(concat(xingFrame(3000, "Info"), frame()))).toEqual({
      durationS: 78,
    });
  });

  it("refuses a WAV, a PNG, random bytes and a lone frame", () => {
    const wav = new Uint8Array(2000);
    wav.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], 0);
    expect(mp3Info(wav)).toBeNull();
    const png = new Uint8Array(2000);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    expect(mp3Info(png)).toBeNull();
    expect(mp3Info(seeded(200_000))).toBeNull();
    expect(mp3Info(frame())).toBeNull();
    expect(mp3Info(concat(frame(), new Uint8Array(500)))).toBeNull();
    expect(mp3Info(new Uint8Array(0))).toBeNull();
  });

  it("refuses frames past the 64 KB scan window after the tag", () => {
    expect(
      mp3Info(concat(id3(10), new Uint8Array(70 * 1024), frame(), frame())),
    ).toBeNull();
  });
});
