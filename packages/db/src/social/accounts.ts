// My social accounts (11-35; DASH-14, D198; RESEARCH Pitfall 3, Pitfall 19; T-11-35-01..03).
//
// social_accounts is the one source of a site's social links: the footer icons, the Social
// block and JSON-LD sameAs read it (site-context.ts readPublicBusiness), and the intake contact
// step writes it (intake/business-profile.ts). This module is the hub repository:
//   - reads: content read (every member role); writes: settings write (Owner, Admin; UI-SPEC
//     Social "editing: Owner, Admin", the same as Business info; 11-50),
//     under the per-org lock, organization never taken from input (T-03-20)
//   - URLs: https only, preset host allowlist, a custom link may not point at the site's own
//     hosts (validateSocialUrl against every org_hosts hostname; T-11-35-01)
//   - one account per preset platform (SOCIAL-DUP); at most 20 accounts
//   - short codes: a preset gets its fixed code (`ig`), a custom account customCodeFor(label);
//     codes never change after creation (bio links are already shared)
//   - fallback (computed, never stored): a non-deleted page of the org owns the preset code, so
//     the page wins and the bio link is /go/<code> (T-11-35-02)
//   - every write is one PB batch with its `social.account_*` audit row, clears the in-process
//     short-code cache and, when given, invalidates org:<id>:social + org:<id>:live
import { InvalidInput } from "@cds/core";
import type { SocialLink } from "@cds/core/intake";
import {
  CUSTOM_PLATFORM,
  SOCIAL_ACCOUNTS_MAX,
  SOCIAL_COPY,
  isPresetKey,
  type SocialAccount,
} from "@cds/core/social";
import type PocketBase from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { auditBody, type AuditEvent } from "../audit";
import { withSuperuser } from "../client";
import { liveTag, type Invalidator } from "../content/ports";
import {
  asInput,
  rejectForeignOrg,
  run,
  scopedGet,
  type Op,
} from "../content/shared";
import {
  assertSiteContext,
  projectSocials,
  type SiteContext,
} from "../content/site-context";
import type { OrgContext } from "../context";
import { mapError, newRecordId, requirePermission } from "../repository";
import {
  SOCIAL_COLLECTION,
  checkSocialUrl,
  clearSocialCache,
  codeFor,
  labelOf,
  linksOfRows,
  ownHostsOf,
  pageOwnedCodes,
  readSocialRows,
  socialTag,
  str,
  toSocialAccount,
} from "./rows";

export { socialTag } from "./rows";
export type { SocialAccount } from "@cds/core/social";

export type SocialDeps = { invalidator?: Invalidator };

export const SOCIAL_REORDER_COPY =
  "The list changed while you were moving things. Refresh and try again.";

async function send(
  pb: PocketBase,
  ctx: OrgContext,
  ops: Op[],
  audit: AuditEvent,
): Promise<void> {
  const batch = pb.createBatch();
  for (const w of ops) {
    const col = batch.collection(w.collection);
    if (w.op === "create") col.create({ ...w.body, id: w.id });
    else if (w.op === "update") col.update(w.id, w.body);
    else col.delete(w.id);
  }
  batch.collection("audit_log").create(auditBody(ctx, audit));
  await batch.send();
}

function after(ctx: OrgContext, deps: SocialDeps): void {
  clearSocialCache(ctx.orgId);
  deps.invalidator?.invalidate([socialTag(ctx.orgId), liveTag(ctx.orgId)]);
}

async function accountById(
  pb: PocketBase,
  ctx: OrgContext,
  id: string,
): Promise<SocialAccount> {
  const row = await scopedGet(pb, ctx, SOCIAL_COLLECTION, id);
  return toSocialAccount(row, await pageOwnedCodes(pb, ctx.orgId));
}

// ---------------------------------------------------------------------------------------
// Reads

/** The org's accounts in footer order, each with its bio link path and fallback flag. */
/** Writes: settings write (Owner, Admin), then the content run (lock + content write). */
function writeRun<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  requirePermission(ctx, "settings", "write");
  return run(ctx, fn);
}

export async function listSocialAccounts(
  ctx: OrgContext,
): Promise<SocialAccount[]> {
  requirePermission(ctx, "content", "read");
  return withSuperuser(async (pb) => {
    const [rows, pageCodes] = await Promise.all([
      readSocialRows(pb, ctx.orgId),
      pageOwnedCodes(pb, ctx.orgId),
    ]);
    return rows.map((r) => toSocialAccount(r, pageCodes));
  }).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

/**
 * The visitor-safe social links of a site (footer, Social block, sameAs): the same projection
 * readPublicBusiness uses, at most 12, known platforms and http(s) URLs only.
 */
export async function socialLinksForSite(
  site: SiteContext,
): Promise<SocialLink[]> {
  assertSiteContext(site);
  const rows = await withSuperuser((pb) => readSocialRows(pb, site.orgId));
  return projectSocials(linksOfRows(rows));
}

// ---------------------------------------------------------------------------------------
// Writes

export type AddSocialAccountInput = {
  platform: string;
  label?: string;
  url: string;
};

export async function addSocialAccount(
  ctx: OrgContext,
  input: AddSocialAccountInput | Record<string, unknown>,
  deps: SocialDeps = {},
): Promise<SocialAccount> {
  const raw = asInput(input, "The account");
  rejectForeignOrg(ctx, raw);
  const platform = raw.platform;
  if (
    typeof platform !== "string" ||
    (platform !== CUSTOM_PLATFORM && !isPresetKey(platform))
  ) {
    throw new InvalidInput(SOCIAL_COPY.platform);
  }
  const label = platform === CUSTOM_PLATFORM ? labelOf(raw.label) : "";
  const id = newRecordId();
  await writeRun(ctx, async (pb) => {
    const rows = await readSocialRows(pb, ctx.orgId);
    if (rows.length >= SOCIAL_ACCOUNTS_MAX) {
      throw new InvalidInput(SOCIAL_COPY.full);
    }
    const url = checkSocialUrl(
      platform,
      raw.url,
      await ownHostsOf(pb, ctx.orgId),
    );
    const dup =
      platform === CUSTOM_PLATFORM
        ? rows.some((r) => str(r.url) === url)
        : rows.some((r) => str(r.platform) === platform);
    if (dup) throw new InvalidInput(SOCIAL_COPY.dup);
    const order = rows.reduce(
      (max, r) =>
        typeof r.order === "number" && r.order >= max ? r.order + 1 : max,
      0,
    );
    const shortCode = codeFor(
      platform,
      label,
      rows.map((r) => str(r.short_code)),
    );
    await send(
      pb,
      ctx,
      [
        {
          collection: SOCIAL_COLLECTION,
          op: "create",
          id,
          body: {
            organization: ctx.orgId,
            platform,
            label,
            url,
            short_code: shortCode,
            order,
          },
        },
      ],
      {
        action: "social.account_added",
        targetCollection: SOCIAL_COLLECTION,
        targetId: id,
        meta: { platform },
      },
    );
  });
  after(ctx, deps);
  return withSuperuser((pb) => accountById(pb, ctx, id));
}

/** Change an account's address (and a custom account's name). Platform and code never change. */
export async function updateSocialAccount(
  ctx: OrgContext,
  id: string,
  patch: { label?: string; url?: string } | Record<string, unknown>,
  deps: SocialDeps = {},
): Promise<SocialAccount> {
  const raw = asInput(patch, "The change");
  rejectForeignOrg(ctx, raw);
  await writeRun(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, SOCIAL_COLLECTION, id);
    const platform = str(row.platform);
    const body: Record<string, unknown> = {};
    if (Object.hasOwn(raw, "url")) {
      const url = checkSocialUrl(
        platform,
        raw.url,
        await ownHostsOf(pb, ctx.orgId),
      );
      if (platform === CUSTOM_PLATFORM) {
        const rows = await readSocialRows(pb, ctx.orgId);
        if (rows.some((r) => r.id !== row.id && str(r.url) === url)) {
          throw new InvalidInput(SOCIAL_COPY.dup);
        }
      }
      body.url = url;
    }
    if (Object.hasOwn(raw, "label") && platform === CUSTOM_PLATFORM) {
      body.label = labelOf(raw.label);
    }
    if (Object.keys(body).length === 0) return;
    await send(
      pb,
      ctx,
      [{ collection: SOCIAL_COLLECTION, op: "update", id: row.id, body }],
      {
        action: "social.account_updated",
        targetCollection: SOCIAL_COLLECTION,
        targetId: row.id,
        meta: { platform, fields: Object.keys(body) },
      },
    );
  });
  after(ctx, deps);
  return withSuperuser((pb) => accountById(pb, ctx, id));
}

/** Remove one account; returns it as it was (the hub's Undo re-adds it). */
export async function removeSocialAccount(
  ctx: OrgContext,
  id: string,
  deps: SocialDeps = {},
): Promise<SocialAccount> {
  const removed = await writeRun(ctx, async (pb) => {
    const account = await accountById(pb, ctx, id);
    await send(
      pb,
      ctx,
      [{ collection: SOCIAL_COLLECTION, op: "delete", id: account.id }],
      {
        action: "social.account_removed",
        targetCollection: SOCIAL_COLLECTION,
        targetId: account.id,
        meta: { platform: account.platform },
      },
    );
    return account;
  });
  after(ctx, deps);
  return removed;
}

/** Footer order. `ids` must be exactly the org's accounts (no missing, extra, foreign or repeat). */
export async function reorderSocialAccounts(
  ctx: OrgContext,
  ids: unknown,
  deps: SocialDeps = {},
): Promise<void> {
  if (!Array.isArray(ids) || ids.some((v) => typeof v !== "string")) {
    throw new InvalidInput(SOCIAL_REORDER_COPY);
  }
  const list = ids as string[];
  await writeRun(ctx, async (pb) => {
    const rows = await readSocialRows(pb, ctx.orgId);
    const own = new Set(rows.map((r) => r.id));
    if (
      list.length !== rows.length ||
      new Set(list).size !== list.length ||
      !list.every((id) => own.has(id))
    ) {
      throw new InvalidInput(SOCIAL_REORDER_COPY);
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ops: Op[] = [];
    list.forEach((id, i) => {
      if (byId.get(id)?.order !== i) {
        ops.push({
          collection: SOCIAL_COLLECTION,
          op: "update",
          id,
          body: { order: i },
        });
      }
    });
    if (ops.length === 0) return;
    await send(pb, ctx, ops, {
      action: "social.account_reordered",
      targetCollection: SOCIAL_COLLECTION,
      targetId: "",
      meta: { count: list.length },
    });
  });
  after(ctx, deps);
}
