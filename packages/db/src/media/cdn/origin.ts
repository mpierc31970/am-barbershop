// Origin fallback links (07-10; CONT-20 "short-lived signed Wasabi links", D278). While the
// CDN is down, public media is served by presigned GET links on the public media bucket.
// Don't hand-roll SigV4: aws4fetch `signQuery` (RESEARCH). Pure signing, no network call.
// Credentials come from env only; errors name variables, never values (T-07-10-01).
// Internal to @cds/db: not exported from the cdn barrel.
import { AwsClient } from "aws4fetch";
import { InvalidInput } from "@cds/core";
import { assertPublicMediaKey } from "../../storage/keys";
import { assertValidKey } from "../../storage/object-store";
import type { S3Config } from "../../storage/s3";
import { PUBLIC_MEDIA_KEY_RE } from "./bunny";

export type OriginConfig = S3Config;

/** Fallback link lifetime: 1 h (CONT-20). */
export const ORIGIN_LINK_TTL_S = 3600;

const ORIGIN_VARS = [
  "WASABI_MEDIA_BUCKET",
  "WASABI_ACCESS_KEY_ID",
  "WASABI_SECRET_ACCESS_KEY",
  "WASABI_REGION",
] as const;

export function originConfigFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): OriginConfig {
  const missing = ORIGIN_VARS.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      "Media origin is not configured: set " + missing.join(", "),
    );
  }
  return {
    bucket: env.WASABI_MEDIA_BUCKET!,
    accessKeyId: env.WASABI_ACCESS_KEY_ID!,
    secretAccessKey: env.WASABI_SECRET_ACCESS_KEY!,
    region: env.WASABI_REGION!,
  };
}

function amzDate(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** A presigned GET link for one public media object (never versions/, exports/, forms/...). */
export async function presignOriginUrl(
  cfg: OriginConfig,
  key: string,
  ttlS: number = ORIGIN_LINK_TTL_S,
  at?: Date,
): Promise<string> {
  assertValidKey(key);
  if (!PUBLIC_MEDIA_KEY_RE.test(key)) {
    throw new InvalidInput("not a public media key");
  }
  assertPublicMediaKey(key);
  if (!Number.isInteger(ttlS) || ttlS < 1 || ttlS > 604_800) {
    throw new InvalidInput("invalid link lifetime");
  }
  const endpoint = (
    cfg.endpoint ?? `https://s3.${cfg.region}.wasabisys.com`
  ).replace(/\/+$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  const url = `${endpoint}/${encodeURIComponent(cfg.bucket)}/${path}?X-Amz-Expires=${ttlS}`;
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: cfg.region,
    retries: 0,
  });
  const signed = await client.sign(url, {
    method: "GET",
    aws: { signQuery: true, datetime: at ? amzDate(at) : undefined },
  });
  return signed.url;
}
