// packages/core/src/qr/encode.ts (P14, DOM-10).
// Owner: 14-07 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Hand-written QR Code encoder (ISO/IEC 18004) for the launch-review phone check (D172, P14-P11):
// byte mode (UTF-8), error correction level M only, versions 1-10. No npm dependency (supply chain).
// Pure TS: no Node imports, safe anywhere, but used server-side only (the SVG is rendered inline).

export interface QrMatrix {
  /** Modules per side, `17 + 4 * version` (no quiet zone). */
  size: number;
  /** `modules[row][col]`, `true` = dark. */
  modules: boolean[][];
  version: number;
}

const MAX_VERSION = 10;

/** ECC level M block structure, versions 1-10: [EC codewords per block, number of blocks]. */
const ECC_M: readonly (readonly [number, number])[] = [
  [0, 0], // unused (index = version)
  [10, 1],
  [16, 1],
  [26, 1],
  [18, 2],
  [24, 2],
  [16, 4],
  [18, 4],
  [22, 4],
  [22, 5],
  [26, 5],
];

/** Format-info bits for level M (ISO table 12: L=01, M=00, Q=11, H=10). */
const ECC_M_FORMAT = 0b00;

// ---------------------------------------------------------------------------------------------
// GF(256) with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D).

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

/** Generator polynomial coefficients (highest degree dropped, monic), cached per degree. */
const GENERATORS = new Map<number, number[]>();

function generator(degree: number): number[] {
  const cached = GENERATORS.get(degree);
  if (cached) return cached;
  // Product of (x - a^i) for i in 0..degree-1, stored highest-to-lowest without the leading 1.
  const g = new Array<number>(degree).fill(0);
  g[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      g[j] = gfMul(g[j]!, root);
      if (j + 1 < degree) g[j] ^= g[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  GENERATORS.set(degree, g);
  return g;
}

/** Reed-Solomon error-correction codewords for one block. */
export function qrReedSolomon(
  data: readonly number[],
  degree: number,
): number[] {
  const g = generator(degree);
  const rem = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = (b ^ rem.shift()!) & 0xff;
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(g[i]!, factor);
  }
  return rem;
}

// ---------------------------------------------------------------------------------------------
// Format and version information (BCH codes).

/** 15-bit format word for level M and `mask` (BCH(15,5), XOR 0x5412). */
export function qrFormatBits(mask: number): number {
  const data = (ECC_M_FORMAT << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18-bit version word for versions 7+ (BCH(18,6), generator 0x1F25). */
export function qrVersionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// ---------------------------------------------------------------------------------------------
// Capacity.

function rawDataModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

function totalCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8);
}

function dataCodewords(version: number): number {
  const [ec, blocks] = ECC_M[version]!;
  return totalCodewords(version) - ec * blocks;
}

function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = 17 + 4 * version;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < count; pos -= step)
    out.splice(1, 0, pos);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Codeword assembly.

function buildCodewords(bytes: Uint8Array, version: number): number[] {
  const capacityBits = dataCodewords(version) * 8;
  const bits: number[] = [];
  const put = (value: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4); // byte mode
  put(bytes.length, countBits(version));
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacityBits - bits.length)); // terminator
  put(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]!;
    data.push(b);
  }
  for (let pad = 0xec; data.length < dataCodewords(version); pad ^= 0xec ^ 0x11)
    data.push(pad);

  const [ecLen, numBlocks] = ECC_M[version]!;
  const total = totalCodewords(version);
  const shortBlocks = numBlocks - (total % numBlocks);
  const shortLen = Math.floor(total / numBlocks);
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const len = shortLen - ecLen + (i < shortBlocks ? 0 : 1);
    const block = data.slice(k, k + len);
    k += len;
    dataBlocks.push(block);
    ecBlocks.push(qrReedSolomon(block, ecLen));
  }
  const out: number[] = [];
  const maxData = shortLen - ecLen + 1;
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]!);
  }
  for (let i = 0; i < ecLen; i++)
    for (const block of ecBlocks) out.push(block[i]!);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Matrix.

class Grid {
  readonly modules: boolean[][];
  readonly fn: boolean[][];
  readonly size: number;
  constructor(size: number) {
    this.size = size;
    this.modules = Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    );
    this.fn = Array.from({ length: size }, () =>
      new Array<boolean>(size).fill(false),
    );
  }
  setFn(row: number, col: number, dark: boolean): void {
    this.modules[row]![col] = dark;
    this.fn[row]![col] = true;
  }
}

function drawFinder(g: Grid, centerRow: number, centerCol: number): void {
  for (let dr = -4; dr <= 4; dr++) {
    for (let dc = -4; dc <= 4; dc++) {
      const r = centerRow + dr;
      const c = centerCol + dc;
      if (r < 0 || r >= g.size || c < 0 || c >= g.size) continue;
      const ring = Math.max(Math.abs(dr), Math.abs(dc));
      g.setFn(r, c, ring !== 2 && ring !== 4);
    }
  }
}

function drawAlignment(g: Grid, centerRow: number, centerCol: number): void {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      g.setFn(
        centerRow + dr,
        centerCol + dc,
        Math.max(Math.abs(dr), Math.abs(dc)) !== 1,
      );
    }
  }
}

function drawFormat(g: Grid, mask: number): void {
  const bits = qrFormatBits(mask);
  const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
  const n = g.size;
  // Copy 1, around the top-left finder.
  for (let i = 0; i <= 5; i++) g.setFn(i, 8, bit(i));
  g.setFn(7, 8, bit(6));
  g.setFn(8, 8, bit(7));
  g.setFn(8, 7, bit(8));
  for (let i = 9; i < 15; i++) g.setFn(8, 14 - i, bit(i));
  // Copy 2, split between the top-right and bottom-left finders.
  for (let i = 0; i < 8; i++) g.setFn(8, n - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) g.setFn(n - 15 + i, 8, bit(i));
  g.setFn(n - 8, 8, true); // dark module, (4v + 9, 8)
}

function drawVersion(g: Grid, version: number): void {
  if (version < 7) return;
  const bits = qrVersionBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = g.size - 11 + (i % 3);
    g.setFn(a, b, dark);
    g.setFn(b, a, dark);
  }
}

function drawFunctionPatterns(g: Grid, version: number): void {
  const n = g.size;
  for (let i = 0; i < n; i++) {
    g.setFn(6, i, i % 2 === 0);
    g.setFn(i, 6, i % 2 === 0);
  }
  drawFinder(g, 3, 3);
  drawFinder(g, 3, n - 4);
  drawFinder(g, n - 4, 3);
  const pos = alignmentPositions(version);
  const last = pos.length - 1;
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0)
      )
        continue;
      drawAlignment(g, pos[i]!, pos[j]!);
    }
  }
  drawFormat(g, 0); // reserve; rewritten once the mask is chosen
  drawVersion(g, version);
}

function drawCodewords(g: Grid, codewords: readonly number[]): void {
  const n = g.size;
  const totalBits = codewords.length * 8;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < n; vert++) {
      const row = upward ? n - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        if (g.fn[row]![col] || i >= totalBits) continue;
        g.modules[row]![col] =
          ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

function maskHit(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function applyMask(g: Grid, mask: number): void {
  for (let r = 0; r < g.size; r++) {
    for (let c = 0; c < g.size; c++) {
      if (!g.fn[r]![c] && maskHit(mask, r, c))
        g.modules[r]![c] = !g.modules[r]![c];
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Mask penalty (ISO 18004 §7.8.3, rules N1-N4).

const FINDER_LIKE_A = [
  true,
  false,
  true,
  true,
  true,
  false,
  true,
  false,
  false,
  false,
  false,
];
const FINDER_LIKE_B = [
  false,
  false,
  false,
  false,
  true,
  false,
  true,
  true,
  true,
  false,
  true,
];

function lineScore(line: readonly boolean[]): number {
  let score = 0;
  // N1: runs of 5+ same-colour modules.
  let run = 1;
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && line[i] === line[i - 1]) {
      run++;
    } else {
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
  }
  // N3: 1:1:3:1:1 finder-like pattern with 4 light modules on one side.
  for (let i = 0; i + 11 <= line.length; i++) {
    let a = true;
    let b = true;
    for (let k = 0; k < 11; k++) {
      if (line[i + k] !== FINDER_LIKE_A[k]) a = false;
      if (line[i + k] !== FINDER_LIKE_B[k]) b = false;
    }
    if (a) score += 40;
    if (b) score += 40;
  }
  return score;
}

function penalty(m: readonly boolean[][]): number {
  const n = m.length;
  let score = 0;
  for (let r = 0; r < n; r++) score += lineScore(m[r]!);
  for (let c = 0; c < n; c++) score += lineScore(m.map((row) => row[c]!));
  // N2: 2x2 blocks of one colour.
  for (let r = 0; r + 1 < n; r++) {
    for (let c = 0; c + 1 < n; c++) {
      const v = m[r]![c];
      if (v === m[r]![c + 1] && v === m[r + 1]![c] && v === m[r + 1]![c + 1])
        score += 3;
    }
  }
  // N4: dark/light balance, 10 points per 5% step away from 50%.
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const total = n * n;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * 10;
  return score;
}

// ---------------------------------------------------------------------------------------------

/** Byte-mode capacity at level M for `version` (1-10). */
function byteCapacity(version: number): number {
  return Math.floor((dataCodewords(version) * 8 - 4 - countBits(version)) / 8);
}

/**
 * Encode `text` (UTF-8 bytes) as a QR Code at level M, in the smallest version 1-10 that fits,
 * with the lowest-penalty mask (ties go to the lowest mask id).
 * Throws `RangeError` when the text is longer than version 10-M holds (213 bytes).
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (bytes.length <= byteCapacity(v)) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    throw new RangeError(
      `QR text too long: ${bytes.length} bytes (max ${byteCapacity(MAX_VERSION)})`,
    );
  }

  const size = 17 + 4 * version;
  const codewords = buildCodewords(bytes, version);
  const base = new Grid(size);
  drawFunctionPatterns(base, version);
  drawCodewords(base, codewords);

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const g = new Grid(size);
    for (let r = 0; r < size; r++) {
      g.modules[r] = base.modules[r]!.slice();
      g.fn[r] = base.fn[r]!.slice();
    }
    applyMask(g, mask);
    drawFormat(g, mask);
    const score = penalty(g.modules);
    if (score < bestScore) {
      bestScore = score;
      best = g.modules;
    }
  }
  return { size, modules: best!, version };
}
