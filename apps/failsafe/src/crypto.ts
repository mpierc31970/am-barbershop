// Fail-safe crypto (D291): AES-256-GCM for data at rest, HMAC-SHA256 for the signed pull.
// node:crypto only. The key is 32 bytes, base64, from FAILSAFE_DATA_KEY (env only).
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const CIPHER = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** One encrypted line on disk / in the routing file (all base64). */
export type Sealed = { iv: string; tag: string; data: string };

/** Decode FAILSAFE_DATA_KEY. Throws on a missing key or one that is not 32 bytes. */
export function loadKey(b64: string | undefined): Buffer {
  if (typeof b64 !== "string" || b64.trim() === "") {
    throw new Error("FAILSAFE_DATA_KEY is not set");
  }
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== 32) {
    throw new Error("FAILSAFE_DATA_KEY must be 32 bytes (base64)");
  }
  return key;
}

export function seal(key: Buffer, value: unknown): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

/** Decrypt a sealed value. Throws on tampering, a wrong key or a malformed envelope. */
export function unseal(key: Buffer, sealed: unknown): unknown {
  if (!sealed || typeof sealed !== "object") throw new Error("bad envelope");
  const { iv, tag, data } = sealed as Record<string, unknown>;
  if (
    typeof iv !== "string" ||
    typeof tag !== "string" ||
    typeof data !== "string"
  ) {
    throw new Error("bad envelope");
  }
  const ivBuf = Buffer.from(iv, "base64");
  const tagBuf = Buffer.from(tag, "base64");
  if (ivBuf.length !== IV_BYTES || tagBuf.length !== TAG_BYTES) {
    throw new Error("bad envelope");
  }
  const decipher = createDecipheriv(CIPHER, key, ivBuf, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(tagBuf);
  const plain = Buffer.concat([
    decipher.update(Buffer.from(data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString("utf8"));
}

export function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/** Timing-safe compare of two lowercase hex strings. False on any length or shape mismatch. */
export function hexEqual(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/.test(a) || !/^[a-f0-9]+$/.test(b)) return false;
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Short recipient hash for logs (mirrors the platform's loggingTransport). */
export function recipientHash(to: string): string {
  return createHash("sha256")
    .update(to.trim().toLowerCase())
    .digest("hex")
    .slice(0, 12);
}
