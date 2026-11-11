// Image width candidates (07-12 choice 3; D255). Pure. The one rule for which image variants
// exist and their pixel widths, used by promote, the resolvers and srcset:
//   - wN (480, 960, 1600) exists only when N < the upright width (never enlarged)
//   - w2560 is always there: the private web.webp, `webWidth` pixels wide
export type ImageWidthVariant = "w480" | "w960" | "w1600" | "w2560";
export type WidthCandidate = readonly [ImageWidthVariant, number];

const SMALL: readonly (readonly ["w480" | "w960" | "w1600", number])[] = [
  ["w480", 480],
  ["w960", 960],
  ["w1600", 1600],
];

const valid = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

export function imageWidthCandidates(
  width: number,
  webWidth: number,
): ReadonlyArray<WidthCandidate> {
  const out: WidthCandidate[] = [];
  if (valid(width)) {
    for (const [v, n] of SMALL) if (n < width) out.push([v, n]);
  }
  const web = valid(webWidth)
    ? Math.round(webWidth)
    : valid(width)
      ? Math.min(2560, Math.round(width))
      : 0;
  out.push(["w2560", web]);
  return out;
}

/** The `src` variant: w1600 when it exists, else the widest candidate no wider than 1600 px. */
export const IMAGE_SRC_VARIANT = "w1600" as const;

export function largestCandidateUpTo(
  candidates: ReadonlyArray<WidthCandidate>,
  cap: ImageWidthVariant = IMAGE_SRC_VARIANT,
): WidthCandidate {
  const capPx = Number(cap.slice(1));
  let best: WidthCandidate | null = null;
  for (const c of candidates) {
    if (c[1] <= capPx && (!best || c[1] > best[1])) best = c;
  }
  // Every candidate is wider than the cap: the narrowest one.
  if (!best) {
    for (const c of candidates) if (!best || c[1] < best[1]) best = c;
  }
  return best ?? ["w2560", 0];
}
