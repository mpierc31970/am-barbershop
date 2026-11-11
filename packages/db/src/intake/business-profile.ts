// Business profile chokepoint (ONB-01, ONB-02, ONB-13; D257; CONTEXT A3-Q1; UI-SPEC stage 1;
// invariant 1, TEN-03, PD-21; T-06-52, T-06-54, T-06-56).
//
// One business_profile row per organization (unique index): the permanent home of the owner's
// business facts, saved field by field. saveBusinessProfile validates allow-listed keys only
// (validateProfilePatch: hours through validateHours, time zone through validateTimeZone),
// never lets input choose the organization, and upserts the org's own row. `org_name` updates
// organizations.name in the same batch. Reads: business read (Editor ok); writes: business
// write (Owner / Admin). Nothing here takes an org id: the org comes from the OrgContext.
// A save touching a screened key (FIT_SCREENED_KEYS: name, business type, public text) re-runs
// the fit check (A-CR-01, ONB-12, D215): a new non-clear reason moves an onboarding org to
// fit_review with a fit.hold audit row, in the same batch as the save.
// 13-52 (STAFF-25, D270): once the fit screen stops watching the org (stage past fit_review),
// a save that changes public text (LIVE_SCREENED_KEYS, the business name) runs the publish
// scan instead. Profile facts cannot be switched off, so held / unsure open a flag in the
// review queue (staff act there); an outage queues it for the hourly rescan (D248).
import { ImpersonationDenied, InvalidInput } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import { isSendingLocalPart } from "@cds/core/email";
import { sensitivePracticeOn } from "@cds/core/alerts";
import { businessTimeZone } from "@cds/core/today";
import {
  validateProfilePatch,
  type Address,
  type BusinessProfileValues,
  type SocialLink,
  type WeeklyHours,
} from "@cds/core/intake";
import {
  CUSTOM_LABEL_MAX,
  CUSTOM_PLATFORM,
  SOCIAL_COPY,
} from "@cds/core/social";
import { CDS_CHOOSE_PAIRING_ID } from "@cds/core/theme";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";
import {
  FIT_SCREENED_KEYS,
  fitHoldEvent,
  fitRescreens,
  getFitChecker,
  orgFitInput,
  rescreenFit,
  type FitChecker,
} from "../fit";
import { mapError, newRecordId, requirePermission } from "../repository";
import {
  SOCIAL_COLLECTION,
  checkSocialUrl,
  clearSocialCache,
  codeFor,
  linkOfRow,
  linksOfRows,
  ownHostsOf,
  readSocialRows,
  str as socialStr,
} from "../social/rows";
import { screen, type ScanOutcome } from "../content/screen";
import { afterListSave, type ListScanDeps } from "./list-screen";
import {
  asInput,
  commit,
  orgRow,
  rejectForeignOrg,
  runRead,
  runWrite,
  type Op,
} from "./shared";

const COLLECTION = "business_profile";

/** Public free text the publish scan reads on a live save (registry `public`, 13-52). */
export const LIVE_SCREENED_KEYS: readonly string[] = Object.freeze([
  "tagline",
  "headline",
  "about",
  "mission",
  "service_area",
]);
const ORG_NAME_MAX = 120;

// Defined in @cds/core/intake so client components can type props without @cds/db (10-18).
export type { BusinessProfile } from "@cds/core/intake";
import type { BusinessProfile } from "@cds/core/intake";

const EMPTY_ADDRESS: Address = { street: "", city: "", state: "", zip: "" };

function defaults(): BusinessProfileValues {
  return {
    tagline: "",
    business_type: "",
    business_type_other: "",
    description: "",
    phone: "",
    public_email: "",
    address: { ...EMPTY_ADDRESS },
    service_area: "",
    time_zone: "",
    hours: null,
    socials: [],
    about: "",
    mission: "",
    headline: "",
    font_pairing: CDS_CHOOSE_PAIRING_ID,
    ga4_id: "",
    legal_name: "",
    privacy_contact: "",
    legal_region: "",
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function hoursOf(v: unknown): WeeklyHours | null {
  // A stored {} (never set) reads as "not set"; real hours always carry every day.
  if (!isRecord(v) || Object.keys(v).length === 0) return null;
  return v as WeeklyHours;
}

function fromRow(
  row: RecordModel | null,
  orgName: string,
  socials: SocialLink[] = [],
): BusinessProfile {
  const d = defaults();
  if (!row) return { ...d, id: "", orgName, socials };
  const address = isRecord(row.address)
    ? {
        street: str(row.address.street),
        city: str(row.address.city),
        state: str(row.address.state),
        zip: str(row.address.zip),
      }
    : d.address;
  return {
    id: row.id,
    orgName,
    tagline: str(row.tagline),
    business_type: str(row.business_type),
    business_type_other: str(row.business_type_other),
    description: str(row.description),
    phone: str(row.phone),
    public_email: str(row.public_email),
    address,
    service_area: str(row.service_area),
    time_zone: str(row.time_zone),
    hours: hoursOf(row.hours),
    socials,
    about: str(row.about),
    mission: str(row.mission),
    headline: str(row.headline),
    font_pairing: str(row.font_pairing) || d.font_pairing,
    ga4_id: str(row.ga4_id),
    legal_name: str(row.legal_name),
    privacy_contact: str(row.privacy_contact),
    legal_region: str(row.legal_region),
  };
}

function orgNameOf(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new InvalidInput("The business name must be text.");
  }
  const v = raw.trim();
  if (v === "") throw new InvalidInput("Add your business name.");
  // A-WR-10: one line of plain text (no control characters).
  if (/[\u0000-\u001f\u007f-\u009f]/.test(v)) {
    throw new InvalidInput(
      "Remove the hidden control characters from the business name.",
    );
  }
  if (v.length > ORG_NAME_MAX) {
    throw new InvalidInput(
      `Keep the business name to ${ORG_NAME_MAX} characters or fewer.`,
    );
  }
  return v;
}

/** The org's business profile; defaults (never written) when the row is missing. */
export async function getBusinessProfile(
  ctx: OrgContext,
): Promise<BusinessProfile> {
  return runRead(ctx, async (pb) => {
    const org = await pb
      .collection("organizations")
      .getOne(ctx.orgId, { fields: "name" });
    const [row, socialRows] = await Promise.all([
      orgRow(pb, ctx, COLLECTION),
      readSocialRows(pb, ctx.orgId),
    ]);
    return fromRow(row, str(org.name), linksOfRows(socialRows));
  });
}

/** Save the given keys only (allow-listed); `org_name` renames the organization. */
export async function saveBusinessProfile(
  ctx: OrgContext,
  patch: unknown,
  deps: { fitChecker?: FitChecker } & ListScanDeps = {},
): Promise<BusinessProfile> {
  // Validate before any read or write: a bad field writes nothing.
  const input = asInput(patch, "The change");
  rejectForeignOrg(ctx, input);
  const values = validateProfilePatch(input);
  // P14 (14-25, P14-P20, T-14-25-02): the owner sets only the local part, behind domain write
  // (Owner). sending_domain / sending_status / sending_domain_verified are system-only: the
  // allow-list drops them silently, like any unknown key.
  const sendingLocal = Object.hasOwn(input, "sending_local_part")
    ? sendingLocalPartOf(input.sending_local_part)
    : undefined;
  if (sendingLocal !== undefined) requirePermission(ctx, "domain", "write");
  const stored: Record<string, unknown> =
    sendingLocal !== undefined ? { sending_local_part: sendingLocal } : {};
  const orgName = Object.hasOwn(input, "org_name")
    ? orgNameOf(input.org_name)
    : undefined;
  const screened = FIT_SCREENED_KEYS.some((k) => Object.hasOwn(input, k));
  // 11-35 (DASH-14, Pitfall 3): socials are an intake answer, stored in social_accounts.
  const socials = values.socials;
  delete values.socials;
  // 13-52: the public text this save changes (empty strings add nothing to the site).
  const liveTexts = [
    ...(orgName !== undefined ? [orgName] : []),
    ...LIVE_SCREENED_KEYS.map((k) => (values as Record<string, unknown>)[k]),
  ].filter((t): t is string => typeof t === "string" && t.trim() !== "");
  // Set inside the write (closure), read after it.
  const scan: {
    outcome: ScanOutcome | null;
    target: { collection: string; id: string };
  } = { outcome: null, target: { collection: COLLECTION, id: "" } };

  const result = await runWrite(ctx, async (pb) => {
    const current = await orgRow(pb, ctx, COLLECTION);
    if (liveTexts.length > 0) {
      const org = await pb
        .collection("organizations")
        .getOne(ctx.orgId, { fields: "stage" });
      // The fit screen covers onboarding; after it, the publish scan does (D270).
      if (!fitRescreens(str(org.stage))) {
        scan.outcome = await screen(ctx, deps, liveTexts, []);
      }
    }
    const ops: Op[] = [];
    if (socials !== undefined) {
      ops.push(...(await socialSyncOps(pb, ctx, socials)));
    }
    let id = current?.id ?? "";
    const body = { ...values, ...stored };
    if (current) {
      if (Object.keys(body).length > 0) {
        ops.push({
          collection: COLLECTION,
          op: "update",
          id: current.id,
          body,
        });
      }
    } else if (Object.keys(body).length > 0) {
      id = newRecordId();
      ops.push({
        collection: COLLECTION,
        op: "create",
        id,
        body: { ...body, organization: ctx.orgId },
      });
    }
    // Only the name and the fit hold: design never rides along (theme-writer.test WR-01).
    const orgPatch: { name?: string; stage?: "fit_review" } = {};
    if (orgName !== undefined) orgPatch.name = orgName;
    if (screened) {
      const org = await pb
        .collection("organizations")
        .getOne(ctx.orgId, { fields: "name,stage" });
      const fit = await rescreenFit(
        pb,
        ctx.orgId,
        str(org.stage),
        orgFitInput(orgName ?? str(org.name), { ...current, ...values }),
        deps.fitChecker ?? getFitChecker(),
      );
      if (fit) {
        orgPatch.stage = "fit_review";
        ops.push({
          collection: "audit_log",
          op: "create",
          id: newRecordId(),
          body: auditBody(ctx, fitHoldEvent(ctx.orgId, fit, "profile")),
        });
      }
    }
    if (Object.keys(orgPatch).length > 0) {
      ops.push({
        collection: "organizations",
        op: "update",
        id: ctx.orgId,
        body: orgPatch,
      });
    }
    await commit(pb, ctx, ops, {
      action: `${COLLECTION}.${current ? "update" : "create"}`,
      targetCollection: COLLECTION,
      targetId: id,
      meta: {
        fields: [
          ...Object.keys(values),
          ...Object.keys(stored),
          ...(socials !== undefined ? ["socials"] : []),
          ...(orgName ? ["org_name"] : []),
        ],
      },
    });
    scan.target = id
      ? { collection: COLLECTION, id }
      : { collection: "organizations", id: ctx.orgId };
    const org = await pb
      .collection("organizations")
      .getOne(ctx.orgId, { fields: "name" });
    const row = id ? await pb.collection(COLLECTION).getOne(id) : null;
    const socialRows = await readSocialRows(pb, ctx.orgId);
    return fromRow(row, str(org.name), linksOfRows(socialRows));
  });
  if (socials !== undefined) clearSocialCache(ctx.orgId);
  if (scan.outcome !== null) {
    await afterListSave(ctx, deps, scan.outcome, scan.target);
  }
  return result;
}

/**
 * The intake contact step's social links -> social_accounts ops (11-35 choice 5). A link equal
 * to an existing account (same platform and URL) keeps that row, its name and its short code;
 * new links are checked like the hub (https, host, own host; one per preset) and get a code;
 * accounts no longer listed are removed. Order follows the list. Deletes come first so a
 * freed code can be reused in the same batch.
 */
function sameUrl(a: string, b: string): boolean {
  const norm = (v: string): string => {
    try {
      return new URL(v.trim()).href;
    } catch {
      return v.trim();
    }
  };
  return a.trim() === b.trim() || norm(a) === norm(b);
}

async function socialSyncOps(
  pb: PocketBase,
  ctx: OrgContext,
  links: readonly SocialLink[],
): Promise<Op[]> {
  const rows = await readSocialRows(pb, ctx.orgId);
  const unused = new Map(rows.map((r) => [r.id, r]));
  const kept: { row: RecordModel; index: number }[] = [];
  const fresh: { link: SocialLink; index: number }[] = [];
  links.forEach((link, index) => {
    const match = [...unused.values()].find((r) => {
      const l = linkOfRow(r);
      return (
        l !== null && l.platform === link.platform && sameUrl(l.url, link.url)
      );
    });
    if (match) {
      unused.delete(match.id);
      kept.push({ row: match, index });
    } else {
      fresh.push({ link, index });
    }
  });
  const ops: Op[] = [];
  for (const r of unused.values()) {
    ops.push({ collection: SOCIAL_COLLECTION, op: "delete", id: r.id });
  }
  const platforms = new Set(kept.map((k) => socialStr(k.row.platform)));
  const taken = kept.map((k) => socialStr(k.row.short_code));
  for (const k of kept) {
    if (k.row.order !== k.index) {
      ops.push({
        collection: SOCIAL_COLLECTION,
        op: "update",
        id: k.row.id,
        body: { order: k.index },
      });
    }
  }
  const hosts = fresh.length > 0 ? await ownHostsOf(pb, ctx.orgId) : [];
  for (const { link, index } of fresh) {
    const platform =
      link.platform === "other" ? CUSTOM_PLATFORM : link.platform;
    const url = checkSocialUrl(platform, link.url, hosts);
    if (platform !== CUSTOM_PLATFORM && platforms.has(platform)) {
      throw new InvalidInput(SOCIAL_COPY.dup);
    }
    platforms.add(platform);
    const label =
      platform === CUSTOM_PLATFORM
        ? (
            link.label?.trim() || new URL(url).hostname.replace(/^www\./, "")
          ).slice(0, CUSTOM_LABEL_MAX)
        : "";
    const code = codeFor(platform, label, taken);
    taken.push(code);
    ops.push({
      collection: SOCIAL_COLLECTION,
      op: "create",
      id: newRecordId(),
      body: {
        organization: ctx.orgId,
        platform,
        label,
        url,
        short_code: code,
        order: index,
      },
    });
  }
  return ops;
}

/** The stored row as a BusinessProfile (snapshot / assembly read it in their own client). */
export const profileFromRow = fromRow;

// ---------------------------------------------------------------------------------------
// Alert facts for Your profile and alerts (11-24; DASH-36, DASH-37, D305, D313).

export type SensitivePracticeSetting = "on" | "off" | "";

export type AlertProfileFacts = {
  /** Stored value; "" = automatic by business type. */
  sensitiveSetting: SensitivePracticeSetting;
  /** What alerts use now (sensitivePracticeOn). */
  sensitiveOn: boolean;
  /** The business time zone (quiet hours and the 7am digest run in it). */
  timeZone: string;
};

/** A member-level read (no feature gate) with the usual PB error mapping. */
function mappedRead<T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> {
  return withSuperuser(fn).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

function settingOf(v: unknown): SensitivePracticeSetting {
  return v === "on" || v === "off" ? v : "";
}

export const SENSITIVE_PRACTICE_AUDIT = "business.sensitive_practice_set";

/**
 * Switch sensitive-practice mode on or off (DASH-37, D305; T-11-24-03). Owner and Admin only
 * (settings:write and business:write), never impersonating staff (a privacy choice is the
 * business's own). Always audited, in the same batch as the write, with the old and new
 * stored values. Creates the org's business_profile row when it has none yet.
 */
export async function setSensitivePractice(
  ctx: OrgContext,
  value: "on" | "off",
): Promise<AlertProfileFacts> {
  assertOrgContext(ctx);
  requirePermission(ctx, "settings", "write");
  if (ctx.impersonator) {
    throw new ImpersonationDenied(
      "staff cannot change sensitive-practice mode",
    );
  }
  if (value !== "on" && value !== "off") {
    throw new InvalidInput("Sensitive-practice mode is on or off.");
  }
  await runWrite(ctx, async (pb) => {
    const current = await orgRow(pb, ctx, COLLECTION);
    const id = current?.id ?? newRecordId();
    const before = settingOf(current?.sensitive_practice);
    const batch = pb.createBatch();
    if (current) {
      batch.collection(COLLECTION).update(id, { sensitive_practice: value });
    } else {
      batch.collection(COLLECTION).create({
        id,
        organization: ctx.orgId,
        sensitive_practice: value,
      });
    }
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: SENSITIVE_PRACTICE_AUDIT,
        targetCollection: COLLECTION,
        targetId: id,
        meta: { from: before, to: value },
      }),
    );
    await batch.send();
  });
  return readAlertProfileFacts(ctx);
}

/**
 * Sensitive-practice mode and the business time zone, for any member of the org (every role
 * has a Profile; these two facts carry no business detail). Reads three fields of the org's
 * own row only.
 */
export async function readAlertProfileFacts(
  ctx: OrgContext,
): Promise<AlertProfileFacts> {
  assertOrgContext(ctx);
  return mappedRead(async (pb) => {
    const row = await pb.collection(COLLECTION).getList(1, 1, {
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
      fields: "business_type,sensitive_practice,time_zone",
    });
    const r = row.items[0];
    const setting = settingOf(r?.sensitive_practice);
    return {
      sensitiveSetting: setting,
      sensitiveOn: sensitivePracticeOn(setting, str(r?.business_type)),
      timeZone: businessTimeZone(str(r?.time_zone)),
    };
  });
}

// ---------------------------------------------------------------- own-domain sending (P14)

export const SENDING_LOCAL_PART_AUDIT = "email.sending_local_part";

/** The validated, lowercased local part (P14-P20); SEND-LOCAL-INVALID otherwise. */
function sendingLocalPartOf(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!isSendingLocalPart(v)) {
    throw new InvalidInput(P14_COPY.SEND_LOCAL_INVALID);
  }
  return v;
}

export type SendingState = "none" | "pending" | "verified" | "failed";

/** Settings › Email sending row (14-25): the system-set state and the owner's local part. */
export type SendingView = {
  state: SendingState;
  /** The own sending domain ("" when none). */
  domain: string;
  /** The stored local part, "hello" when unset. */
  localPart: string;
};

function sendingViewOf(row: RecordModel | null): SendingView {
  const domain = str(row?.sending_domain).trim();
  const status = str(row?.sending_status);
  const local = str(row?.sending_local_part);
  const localPart = isSendingLocalPart(local) ? local : "hello";
  if (domain === "") return { state: "none", domain: "", localPart };
  const state: SendingState =
    row?.sending_domain_verified === true
      ? "verified"
      : status === "failed"
        ? "failed"
        : "pending";
  return { state, domain, localPart };
}

/**
 * The org's own-domain sending state (business read: every role that sees Settings › Email).
 * Reads four fields of the org's own row only.
 */
export async function getSendingView(ctx: OrgContext): Promise<SendingView> {
  assertOrgContext(ctx);
  return runRead(ctx, async (pb) => {
    const res = await pb.collection(COLLECTION).getList(1, 1, {
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
      fields:
        "id,sending_domain,sending_status,sending_local_part,sending_domain_verified",
    });
    return sendingViewOf(res.items[0] ?? null);
  });
}

/**
 * Set the own-domain From local part (14-25 choice 3; ONB-10, P14-P20). Owner only
 * (`domain:write`); allowed while impersonating (P14-P12), and always audited in the same
 * batch with the old and new local part. Creates the profile row when missing.
 */
export async function setSendingLocalPart(
  ctx: OrgContext,
  localPart: unknown,
): Promise<SendingView> {
  assertOrgContext(ctx);
  requirePermission(ctx, "domain", "write");
  const next = sendingLocalPartOf(localPart);
  return runWrite(ctx, async (pb) => {
    const current = await orgRow(pb, ctx, COLLECTION);
    const id = current?.id ?? newRecordId();
    const before = str(current?.sending_local_part);
    const batch = pb.createBatch();
    if (current) {
      batch.collection(COLLECTION).update(id, { sending_local_part: next });
    } else {
      batch.collection(COLLECTION).create({
        id,
        organization: ctx.orgId,
        sending_local_part: next,
      });
    }
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: SENDING_LOCAL_PART_AUDIT,
        targetCollection: COLLECTION,
        targetId: id,
        meta: { from: before, to: next },
      }),
    );
    await batch.send();
    const row = await pb.collection(COLLECTION).getOne(id);
    return sendingViewOf(row);
  });
}
