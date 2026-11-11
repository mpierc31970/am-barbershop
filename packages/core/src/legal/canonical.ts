// Canonical JSON for evidence hashing (D81, RESEARCH Pattern 2, RFC 8785-compatible when
// restricted). Keys sorted by UTF-16 code units, no whitespace, values limited to strings,
// safe integers, booleans, null, arrays and plain objects. Floats and undefined throw, so a
// genuine signature can never look tampered because of serialisation drift. Pure.
import { InvalidInput } from "../errors";

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") {
    return JSON.stringify(v);
  }
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) {
      throw new InvalidInput("evidence numbers must be safe integers");
    }
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object") {
    // IN-B03: a Date, Map or class instance would hash as {} or its own keys.
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      throw new InvalidInput("evidence objects must be plain objects");
    }
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => {
        if (o[k] === undefined) {
          throw new InvalidInput(`evidence field ${k} is undefined`);
        }
        return `${JSON.stringify(k)}:${canonicalJson(o[k])}`;
      })
      .join(",")}}`;
  }
  throw new InvalidInput("unsupported evidence value");
}
