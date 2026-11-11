// MP3 check without a library (07-12 choice 8; CONT-27, T-07-12-05). Pure, no I/O.
// Skips an ID3v2 tag, then needs an MPEG audio Layer III frame header within the next 64 KB
// and a second, consistent frame header exactly one frame later. Duration comes from a
// Xing/Info frame count when present, else the constant-bitrate estimate. Anything else
// (WAV, PNG, random bytes, a lone frame sync) is null: the caller refuses it as UPL-AUDIO.

const SCAN_BYTES = 64 * 1024;

// Layer III bitrates in kbit/s by bitrate index (0 = free format, 15 = bad).
const BITRATES_V1 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1,
];
const BITRATES_V2 = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1,
];
// Sample rates by version bits (00 = 2.5, 10 = 2, 11 = 1) and index.
const SAMPLE_RATES: Record<number, readonly number[]> = {
  0: [11025, 12000, 8000],
  2: [22050, 24000, 16000],
  3: [44100, 48000, 32000],
};

type Frame = {
  version: number;
  sampleRate: number;
  bitrate: number;
  length: number;
  samples: number;
  mono: boolean;
  crc: boolean;
};

function frameAt(b: Uint8Array, i: number): Frame | null {
  if (i + 4 > b.length) return null;
  if (b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1]! >> 3) & 0x03;
  const layer = (b[i + 1]! >> 1) & 0x03;
  if (version === 1 || layer !== 0x01) return null;
  const crc = (b[i + 1]! & 0x01) === 0;
  const brIdx = (b[i + 2]! >> 4) & 0x0f;
  const srIdx = (b[i + 2]! >> 2) & 0x03;
  const padding = (b[i + 2]! >> 1) & 0x01;
  if (srIdx === 3) return null;
  const kbps = (version === 3 ? BITRATES_V1 : BITRATES_V2)[brIdx]!;
  if (kbps <= 0) return null;
  const sampleRate = SAMPLE_RATES[version]![srIdx]!;
  const bitrate = kbps * 1000;
  const coeff = version === 3 ? 144 : 72;
  const length = Math.floor((coeff * bitrate) / sampleRate) + padding;
  if (length < 24) return null;
  return {
    version,
    sampleRate,
    bitrate,
    length,
    samples: version === 3 ? 1152 : 576,
    mono: ((b[i + 3]! >> 6) & 0x03) === 0x03,
    crc,
  };
}

function id3End(b: Uint8Array): number {
  if (
    b.length >= 10 &&
    b[0] === 0x49 &&
    b[1] === 0x44 &&
    b[2] === 0x33 &&
    b[3] !== 0xff &&
    b[4] !== 0xff
  ) {
    const size =
      ((b[6]! & 0x7f) << 21) |
      ((b[7]! & 0x7f) << 14) |
      ((b[8]! & 0x7f) << 7) |
      (b[9]! & 0x7f);
    const footer = (b[5]! & 0x10) !== 0 ? 10 : 0;
    return 10 + size + footer;
  }
  return 0;
}

function u32(b: Uint8Array, i: number): number | null {
  if (i + 4 > b.length) return null;
  return (
    ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!
  );
}

/** Frame count from a Xing / Info header inside the first frame, else null. */
function xingFrames(b: Uint8Array, at: number, f: Frame): number | null {
  const side = f.version === 3 ? (f.mono ? 17 : 32) : f.mono ? 9 : 17;
  const off = at + 4 + (f.crc ? 2 : 0) + side;
  if (off + 12 > b.length) return null;
  const tag = String.fromCharCode(
    b[off]!,
    b[off + 1]!,
    b[off + 2]!,
    b[off + 3]!,
  );
  if (tag !== "Xing" && tag !== "Info") return null;
  const flags = u32(b, off + 4);
  if (flags === null || (flags & 0x01) === 0) return null;
  const frames = u32(b, off + 8);
  return frames !== null && frames > 0 ? frames : null;
}

export function mp3Info(bytes: Uint8Array): { durationS: number } | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return null;
  const start = id3End(bytes);
  if (start >= bytes.length) return null;
  const stop = Math.min(bytes.length - 4, start + SCAN_BYTES);
  for (let i = start; i <= stop; i += 1) {
    const f = frameAt(bytes, i);
    if (!f) continue;
    const next = frameAt(bytes, i + f.length);
    if (
      !next ||
      next.version !== f.version ||
      next.sampleRate !== f.sampleRate
    ) {
      continue;
    }
    const frames = xingFrames(bytes, i, f);
    const seconds =
      frames !== null
        ? (frames * f.samples) / f.sampleRate
        : ((bytes.length - i) * 8) / f.bitrate;
    return { durationS: Math.max(0, Math.round(seconds)) };
  }
  return null;
}
