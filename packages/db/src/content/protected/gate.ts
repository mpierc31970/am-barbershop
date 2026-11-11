// The visitor side of page passwords (CONT-28, CONT-33; D235 #12, D255; 07-32 choices 3, 5;
// T-07-32-01, T-07-32-04, T-07-32-08; Pitfall 12).
// invariant 1: org from the context only; never return or log a hash, a password or a cookie.
//
// - readPageGate(site, pageId): one bound-param read of the site's own page, per request and
//   never through a cache; returns only { protected, version } (never the hash). A foreign,
//   unknown or malformed id is null.
// - verifyPagePassword: the row is read first (a foreign page is NotFound before any bucket
//   is touched); a page that is not protected is open without counting; otherwise one slot
//   of the per-(org, page, IP) limiter is taken before the compare and given back on
//   success, so only wrong attempts count. A password over PAGE_PASSWORD_MAX is wrong
//   without hashing.
import { CdsError, NotFound, RateLimited } from "@cds/core";
import { GATE_COPY } from "@cds/core/content";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "../../client";
import {
  pageGateRetryAfterS,
  releasePageGateAttempt,
  takePageGateAttempt,
} from "../../rate-limit";
import { isProtected } from "../project";
import { assertSiteContext, type SiteContext } from "../site-context";
import { PAGE_PASSWORD_MAX, verifyPagePasswordHash } from "./password";

export { GATE_COPY };

const ID_RE = /^[a-z0-9]{15}$/;

/** The password was wrong (GATE-WRONG). */
export class WrongPagePassword extends CdsError {
  override readonly code = "gate_wrong";
  constructor() {
    super(GATE_COPY.wrong);
  }
}

/** Too many wrong tries from this IP for this page (GATE-RATE). */
export class GateRateLimited extends RateLimited {
  readonly retryAfterS: number;
  constructor(retryAfterS: number) {
    super(GATE_COPY.rate);
    this.retryAfterS = retryAfterS;
  }
}

export type PageGate = { protected: boolean; version: number };

type GateRow = {
  id: string;
  protected: boolean;
  version: number;
  hash: string;
};

async function gateRow(
  site: SiteContext,
  pageId: unknown,
): Promise<GateRow | null> {
  assertSiteContext(site);
  if (typeof pageId !== "string" || !ID_RE.test(pageId)) return null;
  return withSuperuser(async (pb) => {
    try {
      const r = await pb.collection("pages").getFirstListItem(
        pb.filter("id = {:id} && organization = {:org}", {
          id: pageId,
          org: site.orgId,
        }),
        {
          fields: "id,kind,password_protected,password_hash,password_version",
        },
      );
      return {
        id: r.id,
        protected: isProtected(r),
        version: Number(r.password_version) || 0,
        hash: typeof r.password_hash === "string" ? r.password_hash : "",
      };
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return null;
      throw err;
    }
  });
}

/** The live gate state of one of the site's pages; null when it is not the site's page. */
export async function readPageGate(
  site: SiteContext,
  pageId: string,
): Promise<PageGate | null> {
  const row = await gateRow(site, pageId);
  return row ? { protected: row.protected, version: row.version } : null;
}

/**
 * Check a visitor's password. Right -> `{ version, open: false }` (mint a cookie for that
 * version); not protected -> `{ version, open: true }`. Throws WrongPagePassword,
 * GateRateLimited or NotFound.
 */
export async function verifyPagePassword(
  site: SiteContext,
  pageId: string,
  password: unknown,
  opts: { ip: string },
): Promise<{ version: number; open: boolean }> {
  const row = await gateRow(site, pageId);
  if (!row) throw new NotFound();
  if (!row.protected) return { version: row.version, open: true };
  const ip = typeof opts.ip === "string" ? opts.ip : "";
  const t = takePageGateAttempt(site.orgId, row.id, ip);
  if (t === null) {
    throw new GateRateLimited(
      Math.max(1, pageGateRetryAfterS(site.orgId, row.id, ip)),
    );
  }
  const ok =
    typeof password === "string" &&
    password.length <= PAGE_PASSWORD_MAX &&
    (await verifyPagePasswordHash(row.hash, password));
  if (!ok) throw new WrongPagePassword();
  releasePageGateAttempt(site.orgId, row.id, ip, t);
  return { version: row.version, open: false };
}
