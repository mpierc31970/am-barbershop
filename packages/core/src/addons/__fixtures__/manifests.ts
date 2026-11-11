// TEST-ONLY fixture manifests (ADDON-07, ADDON-09, ADDON-15). Never imported by production
// code and never registered by the app. Every later plan in phase 5 tests against these.
import { fixtureAddonSection } from "../../content/__fixtures__/fixture-addon";
import type {
  AddonManifest,
  CaptureConvertResult,
  CaptureOrgContext,
  FailsafeRequestView,
} from "../types";

/** An existing repo file, so repo-backed fileExists checks pass for fixture training. */
export const FIXTURE_HOW_TO = "docs/how-to/block-hero.md";
export const FIXTURE_PREMIUM_RUNBOOK = "docs/runbooks/fixture-premium.md";

/** Build a valid manifest; overrides replace top-level fields. */
export function fixtureManifest(
  overrides: Partial<AddonManifest> & { slug: string },
): AddonManifest {
  const slug = overrides.slug;
  return {
    name: `Fixture ${slug}`,
    summary: "Test-only add-on.",
    category: "content",
    version: "1.0.0",
    order: 950,
    visibility: "public",
    paths: ["standard"],
    requires: [],
    conflicts: [],
    nav: { placement: "tab", item: "website", label: "Fixture", icon: "Globe" },
    sections: [],
    collections: {},
    records: {},
    install: {},
    uninstall: { retain: "all" },
    training: [
      {
        id: slug,
        title: `Fixture ${slug}`,
        requirement: "ADDON-11",
        kind: "feature",
        howTo: FIXTURE_HOW_TO,
        video: null,
      },
    ],
    ...overrides,
  };
}

export const FIXTURE_QUOTE: AddonManifest = fixtureManifest({
  slug: "fixture-quote",
  name: "Fixture quote",
  order: 900,
  sections: [fixtureAddonSection],
  nav: {
    placement: "tab",
    item: "website",
    label: "Quotes",
    icon: "MessageSquareQuote",
  },
  install: {
    page: {
      slug: "fixture-quote",
      title: "Fixture quote",
      sections: [{ section_type: "fixture-quote", content: { text: "" } }],
    },
  },
  training: [
    {
      id: "fixture-quote",
      title: "Quote block (fixture)",
      requirement: "ADDON-11",
      kind: "block",
      howTo: FIXTURE_HOW_TO,
      video: null,
    },
  ],
});

export const FIXTURE_PRIVATE: AddonManifest = fixtureManifest({
  slug: "fixture-private",
  order: 910,
  visibility: "private",
});

export const FIXTURE_NEEDS: AddonManifest = fixtureManifest({
  slug: "fixture-needs",
  order: 920,
  requires: ["fixture-quote"],
});

export const FIXTURE_CONFLICTS: AddonManifest = fixtureManifest({
  slug: "fixture-conflicts",
  order: 930,
  conflicts: ["fixture-quote"],
});

/**
 * 13-18 (STAFF-14): the fixture premium add-on's own records. There is no PocketBase
 * collection for a fixture (it never ships), so its convertCapture writes one row here.
 */
export const FIXTURE_PREMIUM_ITEMS: {
  id: string;
  orgId: string;
  title: string;
  captureId: string;
}[] = [];

/** Requested slot text that the fixture's conflict check reports as already taken. */
export const FIXTURE_PREMIUM_TAKEN = "taken";

async function fixturePremiumConvert(
  ctx: CaptureOrgContext,
  request: FailsafeRequestView,
): Promise<CaptureConvertResult> {
  if (request.orgId !== ctx.orgId) return { conflict: "Wrong site." };
  if (request.preferred.trim().toLowerCase() === FIXTURE_PREMIUM_TAKEN) {
    return { conflict: "That time is already taken." };
  }
  const id = `fpi${String(FIXTURE_PREMIUM_ITEMS.length + 1).padStart(12, "0")}`;
  FIXTURE_PREMIUM_ITEMS.push({
    id,
    orgId: ctx.orgId,
    title: `Request from ${request.name}`,
    captureId: request.captureId,
  });
  return { ref: id };
}

export const FIXTURE_PREMIUM_OK: AddonManifest = fixtureManifest({
  slug: "fixture-premium",
  order: 940,
  externalDependencies: ["smtp"],
  collections: {
    fixture_premium_items: {
      kind: "base",
      feature: "addon:fixture-premium",
      export: ["id", "title"],
      writes: "generic",
    },
  },
  premium: {
    healthChecks: [{ id: "smtp-reachable", description: "SMTP answers." }],
    backups: { collections: ["fixture_premium_items"], offsite: true },
    dependencies: {
      smtp: {
        fallback: "Queue mail locally and retry.",
        testedBy: "fixture-premium.fallback.test.ts",
      },
    },
    captureMode: {
      description: "Requests queue on the off-server capture endpoint.",
      testedBy: "fixture-premium.capture.test.ts",
      convertCapture: fixturePremiumConvert,
      pendingRequestsSection: "fixture-premium-pending",
    },
    runbook: FIXTURE_PREMIUM_RUNBOOK,
  },
});

/**
 * P14 (14-39; LIFE-01, P14-P28): an add-on with one Leaving CDS item. Test-only; never in the
 * registry. Proves the checklist lists manifest items as "not applicable" in v1.0.
 */
export const FIXTURE_OFFBOARDING: AddonManifest = fixtureManifest({
  slug: "fixture-offboarding",
  order: 970,
  offboarding: {
    items: [
      {
        key: "gift_balances",
        label: "Gift card balances",
        notApplicable: "No gift card balances to settle.",
      },
    ],
  },
});

/**
 * 11-08 (DASH-21, DASH-26, DASH-35): an add-on with a Today card, Needs-you items, one
 * normal alert type and a tab under Marketing. Test-only; the registry contract test pairs
 * it with a fake server module.
 */
export const todayFixture: AddonManifest = fixtureManifest({
  slug: "today-fixture",
  order: 960,
  nav: {
    placement: "tab",
    item: "marketing",
    label: "Today fixture",
    icon: "Megaphone",
  },
  today: {
    card: { id: "today-fixture", title: "Fixture card" },
    needsYou: true,
  },
  alerts: [
    {
      type: "today-fixture.ping",
      level: "normal",
      label: "Fixture ping",
      example: "A test-only alert",
      feature: "addon:today-fixture",
      access: "read",
      section: "addon:today-fixture",
      defaultChannels: { email: true, push: true },
    },
  ],
});
