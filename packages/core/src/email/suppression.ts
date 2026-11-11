// The pure suppression rule (EMAIL-01, D138, D267). A "marketing" suppression (unsubscribe)
// blocks marketing mail only; an "all" suppression (hard bounce, complaint) blocks everything.
import type { EmailClass } from "./types";

export function suppressionBlocks(
  cls: EmailClass,
  rows: readonly { scope: "marketing" | "all" }[],
): boolean {
  return rows.some(
    (r) =>
      r.scope === "all" || (cls === "marketing" && r.scope === "marketing"),
  );
}
