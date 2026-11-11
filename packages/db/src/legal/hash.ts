// sha256 for legal evidence (AGR-01). Strings are hashed as UTF-8; @cds/core/legal stays
// node-free, so the db package owns the hash at runtime.
import { createHash } from "node:crypto";

/** Lowercase hex sha256 of a UTF-8 string or raw bytes. */
export function sha256Hex(data: string | Uint8Array): string {
  const h = createHash("sha256");
  if (typeof data === "string") h.update(data, "utf8");
  else h.update(data);
  return h.digest("hex");
}
