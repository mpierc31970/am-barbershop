"use server";
// Catalog actions (13-37 choices 2-4; STAFF-07, D5, D161, D264; T-13-37-03, T-13-37-04).
// Public POST endpoints: every argument is untrusted. Thin callers of the functions the CLIs
// and 13-20 ship:
//   listings     -> staffSaveListing / staffMoveListing / staffRemoveScreenshot
//                   (catalog_listings: both staff roles; uploads go through
//                   /staff/api/catalog/upload, the 2 MB Server Action cap, P13-P21)
//   prices       -> priceCase (preview) then setPrice, the same input prices:set passes
//                   (prices_set: super_admin, step-up; an add-on crossing $0 needs the
//                   "I've checked these sites" box, the CLI's y/N)
//   announcement -> setAnnouncement / clearAnnouncement, as announce:set
//                   (announce_set: super_admin, step-up)
// @cds/db checks the matrix again. Errors are logged by class name only.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { InvalidInput } from "@cds/core";
import { ADDON_PATHS, type AddonPath } from "@cds/core/addons";
import type { CatalogItemKind } from "@cds/core/pricing";
import {
  CATALOG_AVAILABILITIES,
  clearAnnouncement,
  isSafeAnnouncementHref,
  priceCase,
  setAnnouncement,
  setPrice,
  staffMoveListing,
  staffRemoveScreenshot,
  staffSaveListing,
  type CatalogAvailability,
  type StaffCatalogEntry,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import { toCatalogManifestInput } from "../../../lib/catalog-view";
import {
  isMonthlyKind,
  isPriceKind,
  isPricedPath,
  pathAllowed,
  PRICE_MAX_CENTS,
  PRICED_PATH_LABELS,
  priceItemLabel,
  priceText,
  type PricedPath,
} from "../../../lib/price-labels";
import {
  errorName,
  runStaffAction,
  type ActionResult,
} from "../../../lib/staff-action";

type Failure = Extract<ActionResult<never>, { ok: false }>;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ID_RE = /^[a-z0-9]{15}$/;
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DAY_MS = 86_400_000;
/** announce:set's limits (the db checks them again). */
const TITLE_MAX = 80;
const BODY_MAX = 280;
const DAYS_ALLOWED = [7, 14, 30] as const;
/** The longest an announcement may run, Undo included (WR-C05). */
const MAX_DAYS = Math.max(...DAYS_ALLOWED);
const MAX_SHOTS = 6;

const CATALOG_PATH = "/staff/catalog";

function bad(message: string, field?: string): Failure {
  return {
    ok: false,
    code: "invalid_input",
    message,
    ...(field ? { field } : {}),
  };
}

function own(raw: unknown, key: string): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return undefined;
  return Object.prototype.hasOwnProperty.call(raw, key)
    ? (raw as Record<string, unknown>)[key]
    : undefined;
}

function manifests() {
  return ADDON_REGISTRY.list().map(toCatalogManifestInput);
}

function addonNames(): Record<string, string> {
  return Object.fromEntries(ADDON_REGISTRY.list().map((m) => [m.slug, m.name]));
}

/**
 * Revalidate the catalog page. Never throws (WR-C06): it runs after a committed write, so a
 * revalidation error must not read as "didn't save" and invite a retry.
 */
function refresh(): void {
  try {
    revalidatePath(CATALOG_PATH);
  } catch (err) {
    console.error("[staff catalog] revalidate failed", errorName(err));
  }
}

// ---------------------------------------------------------------- listings

export type ListingSaveInput = {
  slug: string;
  tagline: string;
  description: string;
  availability: CatalogAvailability;
  screenshots?: { id: string; alt: string }[];
};

export async function saveListingAction(
  raw: unknown,
): Promise<ActionResult<StaffCatalogEntry>> {
  const slug = own(raw, "slug");
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return bad("That add-on wasn't found.");
  }
  const availability = own(raw, "availability");
  if (
    typeof availability !== "string" ||
    !(CATALOG_AVAILABILITIES as readonly string[]).includes(availability)
  ) {
    return bad("Pick Available, Coming soon or Hidden.", "availability");
  }
  const tagline = own(raw, "tagline");
  const description = own(raw, "description");
  if (typeof tagline !== "string") return bad("Check the tagline.", "tagline");
  if (typeof description !== "string") {
    return bad("Check the description.", "description");
  }
  const shotsRaw = own(raw, "screenshots");
  let screenshots: { id: string; alt: string }[] | undefined;
  if (shotsRaw !== undefined) {
    if (!Array.isArray(shotsRaw) || shotsRaw.length > MAX_SHOTS) {
      return bad("Check the screenshots.", "screenshots");
    }
    screenshots = [];
    for (const s of shotsRaw) {
      const id = own(s, "id");
      const alt = own(s, "alt");
      if (
        typeof id !== "string" ||
        !ID_RE.test(id) ||
        typeof alt !== "string"
      ) {
        return bad("Check the screenshots.", "screenshots");
      }
      screenshots.push({ id, alt });
    }
  }
  const result = await runStaffAction("catalog_listings", {}, (ctx) =>
    staffSaveListing(
      ctx,
      {
        slug,
        tagline,
        description,
        availability,
        ...(screenshots ? { screenshots } : {}),
      },
      manifests(),
    ),
  );
  if (result.ok) refresh();
  return result;
}

export async function moveListingAction(
  slug: unknown,
  direction: unknown,
): Promise<ActionResult<{ order: string[] }>> {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return bad("That add-on wasn't found.");
  }
  if (direction !== "up" && direction !== "down")
    return bad("Pick up or down.");
  const result = await runStaffAction("catalog_listings", {}, async (ctx) => {
    const list = await staffMoveListing(ctx, slug, direction, manifests());
    return { order: list.map((e) => e.slug) };
  });
  if (result.ok) refresh();
  return result;
}

export async function removeScreenshotAction(
  slug: unknown,
  id: unknown,
): Promise<ActionResult<{ removed: true }>> {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return bad("That add-on wasn't found.");
  }
  if (typeof id !== "string" || !ID_RE.test(id)) {
    return bad("That screenshot wasn't found.");
  }
  const result = await runStaffAction("catalog_listings", {}, (ctx) =>
    staffRemoveScreenshot(ctx, { slug, id }, manifests()),
  );
  if (result.ok) refresh();
  return result;
}

// ---------------------------------------------------------------- prices

export type PriceTarget = {
  kind: CatalogItemKind;
  key: string;
  path: PricedPath;
};

export type PriceChangeInput = PriceTarget & {
  /** Whole cents, or null for "Price coming soon". */
  cents: number | null;
};

export type PricePreview = {
  label: string;
  pathLabel: string;
  monthly: boolean;
  oldText: string;
  newText: string;
  oldCents: number | null;
  newCents: number | null;
  /** A changed amount creates a new provider price (D161). */
  newProviderPrice: boolean;
  /** An add-on going to or from $0: included free for every site on the path. */
  crossesZero: boolean;
  toFree: boolean;
  /** Sites on this path (priceCase.pathOrgs). */
  pathOrgs: number;
};

function parseTarget(raw: unknown): PriceTarget | Failure {
  const kind = own(raw, "kind");
  const key = own(raw, "key");
  const path = own(raw, "path");
  if (!isPriceKind(kind)) return bad("That price wasn't found.");
  if (typeof key !== "string" || !KEY_RE.test(key)) {
    return bad("That price wasn't found.");
  }
  if (!isPricedPath(path)) return bad("Pick Standard or Studio.");
  if (!pathAllowed(kind, key, path)) {
    return bad("Studio Booking is offered on the Studio path only.");
  }
  if (priceItemLabel(kind, key, addonNames()) === "") {
    return bad("That price wasn't found.");
  }
  return { kind, key, path };
}

function parseChange(raw: unknown): PriceChangeInput | Failure {
  const target = parseTarget(raw);
  if ("ok" in target) return target;
  const cents = own(raw, "cents");
  if (cents === null) return { ...target, cents: null };
  if (
    typeof cents !== "number" ||
    !Number.isSafeInteger(cents) ||
    cents < 0 ||
    cents > PRICE_MAX_CENTS
  ) {
    return bad("Enter an amount from $0.00 to $100,000.00.", "amount");
  }
  return { ...target, cents };
}

function previewOf(
  input: PriceChangeInput,
  c: { currentCents: number | null; pathOrgs: number },
): PricePreview {
  const monthly = isMonthlyKind(input.kind);
  const toFree = input.cents === 0 && c.currentCents !== 0;
  const fromFree = c.currentCents === 0 && input.cents !== 0;
  return {
    label: priceItemLabel(input.kind, input.key, addonNames()),
    pathLabel: PRICED_PATH_LABELS[input.path],
    monthly,
    oldText: priceText(c.currentCents, monthly),
    newText: priceText(input.cents, monthly),
    oldCents: c.currentCents,
    newCents: input.cents,
    newProviderPrice: input.cents !== null && input.cents !== c.currentCents,
    crossesZero: input.kind === "addon" && (toFree || fromFree),
    toFree: input.kind === "addon" && toFree,
    pathOrgs: c.pathOrgs,
  };
}

/** The case prices:set prints before it saves (read-only; super_admin, step-up first). */
export async function previewPriceAction(
  raw: unknown,
): Promise<ActionResult<PricePreview>> {
  const input = parseChange(raw);
  if ("ok" in input) return input;
  return runStaffAction("prices_set", { stepUp: true }, async (ctx) => {
    const c = await priceCase(ctx, {
      kind: input.kind,
      key: input.key,
      path: input.path as AddonPath,
    });
    return previewOf(input, c);
  });
}

/**
 * Saves one price through setPrice, exactly as prices:set: monthly kinds set monthlyCents,
 * one-time kinds oneTimeCents, null = "Price coming soon". An add-on crossing $0 is refused
 * unless `sitesChecked` is true (re-read here, never trusted from the preview).
 */
export async function savePriceAction(
  raw: unknown,
): Promise<ActionResult<{ message: string }>> {
  const input = parseChange(raw);
  if ("ok" in input) return input;
  const sitesChecked = own(raw, "sitesChecked") === true;
  const result = await runStaffAction(
    "prices_set",
    { stepUp: true },
    async (ctx) => {
      const path = input.path as AddonPath;
      if (input.kind === "addon") {
        const c = await priceCase(ctx, {
          kind: input.kind,
          key: input.key,
          path,
        });
        if (previewOf(input, c).crossesZero && !sitesChecked) {
          throw new InvalidInput(
            "Tick “I've checked these sites” to save this price.",
          );
        }
      }
      const monthly = isMonthlyKind(input.kind);
      const { after } = await setPrice(ctx, {
        kind: input.kind,
        key: input.key,
        path,
        ...(monthly
          ? { monthlyCents: input.cents }
          : { oneTimeCents: input.cents }),
      });
      const cents = monthly ? after.monthlyCents : after.oneTimeCents;
      return {
        message:
          cents === null
            ? "Price saved. New quotes show “Price coming soon”."
            : `Price saved. New quotes use ${priceText(cents, monthly)}.`,
      };
    },
  );
  if (result.ok) refresh();
  return result;
}

// ---------------------------------------------------------------- announcement

export type AnnouncementFormInput = {
  title: string;
  body?: string;
  href?: string;
  paths?: AddonPath[];
  /** 7, 14 or 30 days from now. */
  days?: number;
  /**
   * Undo of End announcement: restores the original end (ISO), instead of `days`. Bounded like
   * `days` (WR-C05): after now and at most 30 days ahead; null (no end) is refused.
   */
  endsAt?: string | null;
};

function parseAnnouncement(raw: unknown):
  | {
      title: string;
      body: string;
      href: string;
      paths: AddonPath[];
      endsAt: (now: Date) => Date;
    }
  | Failure {
  const rawTitle = own(raw, "title");
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  if (title === "" || title.length > TITLE_MAX || /[\r\n]/.test(title)) {
    return bad(
      `Enter a title, one line, up to ${TITLE_MAX} characters.`,
      "title",
    );
  }
  const rawBody = own(raw, "body");
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  if (body.length > BODY_MAX) {
    return bad(`Keep the body to ${BODY_MAX} characters.`, "body");
  }
  const rawHref = own(raw, "href");
  const href = typeof rawHref === "string" ? rawHref.trim() : "";
  if (href !== "" && !isSafeAnnouncementHref(href)) {
    return bad("Use an https:// link or a /hub/ path.", "href");
  }
  const rawPaths = own(raw, "paths") ?? [];
  if (!Array.isArray(rawPaths) || rawPaths.length > ADDON_PATHS.length) {
    return bad("Pick Standard, Studio or both.", "paths");
  }
  const paths: AddonPath[] = [];
  for (const p of rawPaths) {
    // Any site path (an Undo restores a CLI-set "shop" target); the form offers two.
    if (!(ADDON_PATHS as readonly unknown[]).includes(p)) {
      return bad("Pick Standard, Studio or both.", "paths");
    }
    if (!paths.includes(p)) paths.push(p);
  }
  const rawEnds = own(raw, "endsAt");
  if (rawEnds !== undefined) {
    // WR-C05: the browser's end date is untrusted. No "never ends", and never past the
    // longest `days` choice (checked against now in setAnnouncementAction).
    if (rawEnds === null) {
      return bad(
        "An announcement needs an end. Post it again with 7, 14 or 30 days.",
        "days",
      );
    }
    const t =
      typeof rawEnds === "string" && rawEnds.length <= 40
        ? Date.parse(rawEnds)
        : NaN;
    if (Number.isNaN(t)) return bad("That end date isn't valid.", "days");
    return { title, body, href, paths, endsAt: () => new Date(t) };
  }
  const days = own(raw, "days") ?? 14;
  if (!(DAYS_ALLOWED as readonly unknown[]).includes(days)) {
    return bad("Pick 7, 14 or 30 days.", "days");
  }
  return {
    title,
    body,
    href,
    paths,
    endsAt: (now) => new Date(now.getTime() + (days as number) * DAY_MS),
  };
}

/** announce:set: replaces the active announcement (super_admin, step-up). */
export async function setAnnouncementAction(
  raw: unknown,
): Promise<ActionResult<{ id: string; replaced: number }>> {
  const v = parseAnnouncement(raw);
  if ("ok" in v) return v;
  const result = await runStaffAction(
    "announce_set",
    { stepUp: true },
    async (ctx) => {
      const now = new Date();
      const endsAt = v.endsAt(now);
      if (endsAt.getTime() <= now.getTime()) {
        throw new InvalidInput("That announcement has already ended.");
      }
      if (endsAt.getTime() > now.getTime() + MAX_DAYS * DAY_MS) {
        throw new InvalidInput(
          `An announcement runs ${MAX_DAYS} days at most.`,
        );
      }
      const r = await setAnnouncement(
        ctx,
        {
          title: v.title,
          body: v.body,
          href: v.href,
          paths: v.paths,
          startsAt: now,
          endsAt,
        },
        { now: () => now },
      );
      return { id: r.id, replaced: r.ended.length };
    },
  );
  if (result.ok) refresh();
  return result;
}

/** announce:set --clear: ends the announcement showing now (super_admin, step-up). */
export async function clearAnnouncementAction(): Promise<
  ActionResult<{ ended: number }>
> {
  const result = await runStaffAction(
    "announce_set",
    { stepUp: true },
    async (ctx) => {
      const r = await clearAnnouncement(ctx);
      return { ended: r.ended.length };
    },
  );
  if (result.ok) refresh();
  return result;
}
