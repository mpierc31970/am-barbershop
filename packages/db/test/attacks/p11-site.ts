// P11 site attacks (11-09, TEN-03, invariant 1): social_accounts, site_daily_stats and
// data_exports. Every collection is writes: custom, so the generic repo is read-only and
// org B's get of org A's row is NotFound. Their writers (11-35 social, 11-18/11-31 stats,
// 11-40 downloads) add `<collection>:<area>` write attacks here.
import { NotFound } from "@cds/core";
import { expect } from "vitest";
import {
  downloadLinkPath,
  openDataDownload,
  readDataDownloadState,
} from "../../src/downloads";
import { tenantDownloadKey } from "../../src/storage";
import { readOnlyAttack, type AttackEnv, type AttackMap } from "./env";

/**
 * 11-40: org A's owner, holding a genuinely signed link to org B's ready download, gets
 * NotFound, and org A's panel never shows org B's row. (The row lives in org B: the suite
 * asserts org A's rows are left unchanged.)
 */
function downloadsAttack(env: AttackEnv): () => Promise<void> {
  return async () => {
    const seed = env.seed();
    const expires = new Date(Date.now() + 86_400_000);
    expires.setMilliseconds(0);
    const row = await env
      .pb()
      .collection("data_exports")
      .create({
        organization: seed.B.org,
        requested_by: seed.B.owner,
        status: "ready",
        object_key: tenantDownloadKey(seed.B.org, new Date()),
        size_bytes: 10,
        requested_at: new Date().toISOString(),
        ready_at: new Date().toISOString(),
        expires_at: expires.toISOString(),
      });
    const link = new URL(
      downloadLinkPath(row.id, expires.getTime()),
      "http://x",
    ).searchParams;
    await expect(
      openDataDownload(seed.ctxA, row.id, {
        exp: link.get("exp"),
        sig: link.get("sig"),
      }),
    ).rejects.toThrow(NotFound);
    const stateA = await readDataDownloadState(seed.ctxA);
    expect(stateA.latest?.id).not.toBe(row.id);
    await env.pb().collection("data_exports").delete(row.id);
  };
}

export function attacks(env: AttackEnv): AttackMap {
  return {
    social_accounts: readOnlyAttack(env, "social_accounts"),
    site_daily_stats: readOnlyAttack(env, "site_daily_stats"),
    data_exports: readOnlyAttack(env, "data_exports"),
    "data_exports:downloads": downloadsAttack(env),
  };
}
