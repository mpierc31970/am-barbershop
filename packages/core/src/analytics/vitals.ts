// Core Web Vitals histograms (11-06; DASH-11). Real-visitor LCP, INP and CLS are stored as
// fixed-bucket counts per org per day, so p75 is computed without keeping raw events.
// Bucket i covers (i*step, (i+1)*step] (bucket 0 also takes 0); the last bucket is
// overflow (> max). p75 reports a bucket's upper edge, so 1000 ms samples read as 1000.

export type VitalMetric = "lcp" | "inp" | "cls";
export type VitalRating = "good" | "needs-work" | "poor";
/** Counts per bucket; length = max/step + 1 (last is overflow). */
export type Histogram = number[];

export const VITAL_BUCKETS = Object.freeze({
  lcp: Object.freeze({ max: 8000, step: 250 }), // ms
  inp: Object.freeze({ max: 1000, step: 25 }), // ms
  cls: Object.freeze({ max: 1, step: 0.025 }), // unitless
});

/** Google thresholds: good <= first, poor > second. */
export const VITAL_THRESHOLDS = Object.freeze({
  lcp: Object.freeze([2500, 4000] as const),
  inp: Object.freeze([200, 500] as const),
  cls: Object.freeze([0.1, 0.25] as const),
});

export function bucketCount(metric: VitalMetric): number {
  const { max, step } = VITAL_BUCKETS[metric];
  return Math.round(max / step) + 1;
}

export function emptyHistogram(metric: VitalMetric): Histogram {
  return new Array<number>(bucketCount(metric)).fill(0);
}

export function bucketIndex(metric: VitalMetric, value: number): number {
  const { step } = VITAL_BUCKETS[metric];
  const last = bucketCount(metric) - 1;
  if (!Number.isFinite(value) || value <= 0) return 0;
  // Round the ratio first so float noise (0.1 / 0.025) does not push a value up a bucket.
  const i = Math.ceil(Math.round((value / step) * 1e6) / 1e6) - 1;
  return Math.min(Math.max(i, 0), last);
}

function normalise(metric: VitalMetric, hist: readonly number[]): Histogram {
  const out = emptyHistogram(metric);
  for (let i = 0; i < out.length; i++) {
    const n = hist[i];
    out[i] = typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
  }
  return out;
}

/** Returns a new histogram with one more sample. Non-finite values are ignored. */
export function addToHistogram(
  metric: VitalMetric,
  hist: readonly number[],
  value: number,
): Histogram {
  const out = normalise(metric, hist);
  if (!Number.isFinite(value)) return out;
  out[bucketIndex(metric, value)] += 1;
  return out;
}

export function mergeHistograms(
  metric: VitalMetric,
  ...hists: readonly (readonly number[])[]
): Histogram {
  const out = emptyHistogram(metric);
  for (const h of hists) {
    const n = normalise(metric, h);
    for (let i = 0; i < out.length; i++) out[i] += n[i];
  }
  return out;
}

/** Upper edge of the bucket holding the 75th percentile (overflow → max), or null if empty. */
export function p75(
  metric: VitalMetric,
  hist: readonly number[],
): number | null {
  const h = normalise(metric, hist);
  const total = h.reduce((s, n) => s + n, 0);
  if (total === 0) return null;
  const { max, step } = VITAL_BUCKETS[metric];
  const target = Math.ceil(total * 0.75);
  let seen = 0;
  for (let i = 0; i < h.length; i++) {
    seen += h[i];
    if (seen >= target) {
      if (i === h.length - 1) return max;
      return Math.round((i + 1) * step * 1000) / 1000;
    }
  }
  return max;
}

export function rateVital(metric: VitalMetric, value: number): VitalRating {
  const [good, poor] = VITAL_THRESHOLDS[metric];
  if (value <= good) return "good";
  if (value <= poor) return "needs-work";
  return "poor";
}
