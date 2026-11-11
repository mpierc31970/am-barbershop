// ThresholdCell (13-45 choice 1; 13-UI-SPEC "Health" Threshold column): the warning and
// critical thresholds in words, Label ink-muted ("Warning after 2 h · Critical after 4 h").
// Either the two parts of a job's threshold or one ready line (platform rows). Server-safe.
import { HEALTH_COPY as C } from "./copy";

export type ThresholdCellProps =
  | { text: string; warning?: undefined; critical?: undefined }
  | { warning: string; critical: string | null; text?: undefined };

/** The words a ThresholdCell shows (exported for tests and plain-text views). */
export function thresholdText(p: ThresholdCellProps): string {
  if (typeof p.text === "string") return p.text;
  if (!p.warning) return "";
  return C.threshold(p.warning, p.critical ?? null);
}

export function ThresholdCell(props: ThresholdCellProps) {
  const text = thresholdText(props);
  return <span className="text-sm text-hub-ink-muted">{text || C.none}</span>;
}
