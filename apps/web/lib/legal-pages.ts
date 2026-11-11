// Public policy page resolver (09-09; AGR-01, AGR-07; CONTEXT A3-Q4, D215, D216). Pure: reads
// only the compiled POLICY_SET (choice 1), so /legal pages render even when PocketBase is down.
// Every URL resolves to exactly one compiled version or to null (not-found).
import {
  isPolicyKey,
  POLICY_SET,
  type PolicySet,
  type PolicyVersion,
} from "@cds/core/legal";

export type EarlierVersion = { version: number; until: string };

export type LegalPage = {
  policy: PolicyVersion;
  current: PolicyVersion;
  isCurrent: boolean;
  /** effectiveAt of the next version when `policy` is not current (choice 3). */
  replacedOn: string | null;
  /** Every non-current version, newest first, with the day it was replaced. */
  earlier: readonly EarlierVersion[];
};

const VERSION_SEGMENT = /^v([1-9][0-9]{0,3})$/;

/** `v<N>` (no leading zero, 1-9999) -> N; anything else -> null (choice 2, T-09-09-03). */
export function parseVersionSegment(seg: string): number | null {
  const m = VERSION_SEGMENT.exec(seg);
  return m ? Number(m[1]) : null;
}

export function resolveLegalPage(
  key: string,
  version?: number,
  set: PolicySet = POLICY_SET,
): LegalPage | null {
  if (!isPolicyKey(key)) return null;
  const versions = set.policies
    .filter((p) => p.key === key)
    .slice()
    .sort((a, b) => a.version - b.version);
  const current = versions[versions.length - 1];
  if (!current) return null;
  const idx =
    version === undefined
      ? versions.length - 1
      : versions.findIndex((p) => p.version === version);
  if (idx < 0) return null;
  const policy = versions[idx]!;
  const isCurrent = policy === current;
  const earlier: EarlierVersion[] = [];
  for (let i = versions.length - 2; i >= 0; i--) {
    earlier.push({
      version: versions[i]!.version,
      until: versions[i + 1]!.effectiveAt,
    });
  }
  return {
    policy,
    current,
    isCurrent,
    replacedOn: isCurrent ? null : versions[idx + 1]!.effectiveAt,
    earlier,
  };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "2026-10-01" -> "1 Oct 2026", hand-formatted (no locale); other input is returned as is. */
export function formatLegalDate(isoDay: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  if (!m) return isoDay;
  const month = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!month || day < 1 || day > 31) return isoDay;
  return `${day} ${month} ${m[1]}`;
}
