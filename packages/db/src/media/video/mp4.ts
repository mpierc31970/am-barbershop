// MP4 by magic bytes (07-13 choice 4; T-07-13-02). Any ISO-BMFF file whose first box is `ftyp`
// counts (MP4, M4V, 3GP and QuickTime `qt  `, which iPhones record); ffprobe must then see a
// video stream with `-f mov` forced. AVI, MKV/WebM and anything else are UPL-VIDEO-TYPE.
import { open } from "node:fs/promises";

const FTYP = [0x66, 0x74, 0x79, 0x70]; // "ftyp"

export function sniffMp4(bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return false;
  const size =
    ((bytes[0]! << 24) >>> 0) +
    (bytes[1]! << 16) +
    (bytes[2]! << 8) +
    bytes[3]!;
  // 1 = a 64-bit size follows the type; otherwise a box is at least its 8-byte header.
  if (size !== 1 && size < 8) return false;
  for (let i = 0; i < 4; i += 1) {
    if (bytes[4 + i] !== FTYP[i]) return false;
  }
  for (let i = 8; i < 12; i += 1) {
    const c = bytes[i]!;
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/** The first `n` bytes of a file, without reading the rest. */
export async function readHead(path: string, n = 64): Promise<Uint8Array> {
  const fh = await open(path, "r");
  try {
    const buf = new Uint8Array(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}
