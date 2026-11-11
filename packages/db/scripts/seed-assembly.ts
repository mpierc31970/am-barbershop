// Dev/test only (08-19). Lives in scripts because it injects TEMPLATES; packages/db/src never
// imports @cds/templates (TMPL-03).
//
// seedAssembledIntake: one of P6's intake fixtures (complete / minimal), sent to CDS, then
// assembled from its template into a published Home and About on a preview host (CONTEXT
// A4-Q4; ROADMAP P8 exit). Three callers share it so they never drift: the seed CLI
// (`npm run tenants:seed-dev -- --intake both --assemble`), the phase exit test
// (apps/web/test/assembly-exit.integration.test.tsx) and the Lighthouse runner.
//
// Refuses unless CDS_ENV is exactly "dev" (assertDevEnvironment; T-08-19-01). Idempotent: a
// fixture that is already assembled returns its existing preview host and status "already".
// Preview host suffix: CDS_PREVIEW_HOST_SUFFIX (dev and tests: sites.localhost).
// Registers add-on collections and manifests before anything reads the registry (05-04).
import "@cds/addon-registry/server";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { TEMPLATES } from "@cds/templates";
import {
  ensurePreviewHost,
  getCopyWriter,
  runAssemblyForOrg,
  type AssemblyResult,
  type AssemblyRunDeps,
} from "../src/assembly";
import type { AssemblyAlertDeps } from "../src/assembly/alerts";
import { withSuperuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import {
  getContentScanner,
  getSearchPinger,
} from "../src/content/scan-standin";
import { mintOrgContext } from "../src/context";
import { assertDevEnvironment } from "../src/dev-seed";
import { seedCompleteIntake, seedMinimalIntake } from "../src/dev-seed-intake";
import { sendToCds } from "../src/intake";
import type { ObjectStore } from "../src/storage";

export type AssemblyFixture = "complete" | "minimal";

export const ASSEMBLY_FIXTURES = {
  complete: {
    slug: "intake-complete",
    ownerEmail: "owner@intake-complete.test",
  },
  minimal: { slug: "intake-minimal", ownerEmail: "owner@intake-minimal.test" },
} as const;

export type SeedAssemblyOptions = {
  /** Defaults to ASSEMBLY_FIXTURES[which]. */
  slug?: string;
  ownerEmail?: string;
  /** Omitted = a random password nobody knows. Never logged or returned. */
  ownerPassword?: string;
  /** Staff email seam (tests capture); default is the configured transport. */
  email?: AssemblyAlertDeps;
  store?: ObjectStore;
};

export type SeedAssemblyResult = {
  orgId: string;
  /** The intake fixture was created by this call (false: it was already there). */
  created: boolean;
  previewHost: string;
  result: AssemblyResult;
};

const SEED_IP = "dev-seed";

function deps(opts: SeedAssemblyOptions): AssemblyRunDeps {
  return {
    templates: TEMPLATES,
    sections: composeSectionRegistry(CORE_SECTIONS, ADDON_REGISTRY.sections()),
    copy: getCopyWriter(),
    invalidator: recordingInvalidator(),
    scanner: getContentScanner(),
    pinger: getSearchPinger(),
    registry: ADDON_REGISTRY,
    ...(opts.store ? { store: opts.store, publicStore: opts.store } : {}),
    ...(opts.email ? { email: opts.email } : {}),
  };
}

/** The org's stage and owner (first owner membership). */
async function stageAndOwner(
  orgId: string,
): Promise<{ stage: string; owner: string | null }> {
  return withSuperuser(async (pb) => {
    const org = await pb
      .collection("organizations")
      .getOne(orgId, { fields: "id,stage" });
    const m = await pb.collection("memberships").getList(1, 1, {
      filter: pb.filter("organization = {:o} && role = 'owner'", { o: orgId }),
      sort: "created,id",
      fields: "id,user",
    });
    const user = m.items[0]?.user;
    return {
      stage: String(org.stage ?? ""),
      owner: typeof user === "string" && user !== "" ? user : null,
    };
  });
}

/**
 * Make sure the fixture is sent to CDS. The minimal fixture is left at `intake` by P6's
 * seed; it is the smallest intake that can be sent, so the owner's real Send to CDS moves
 * it to ready_for_build (fit check included). Later stages are left as they are.
 */
async function ensureSent(orgId: string): Promise<void> {
  const { stage, owner } = await stageAndOwner(orgId);
  if (stage !== "intake") return;
  if (!owner) throw new Error(`fixture org ${orgId} has no owner`);
  const ctx = mintOrgContext({
    orgId,
    actor: owner,
    role: "owner",
    grants: [],
    ip: SEED_IP,
  });
  const sent = await sendToCds(ctx, ADDON_REGISTRY);
  if (sent.stage !== "ready_for_build") {
    throw new Error(`fixture org ${orgId} was held for a fit review`);
  }
}

/**
 * DEV / TEST ONLY. Seed one intake fixture, send it to CDS and assemble its site. Returns
 * the org id, the preview host and the assembly result ("done", or "already" on a re-run).
 */
export async function seedAssembledIntake(
  which: AssemblyFixture,
  opts: SeedAssemblyOptions = {},
): Promise<SeedAssemblyResult> {
  assertDevEnvironment();
  const fixture = ASSEMBLY_FIXTURES[which];
  const seedOpts = {
    slug: opts.slug ?? fixture.slug,
    ownerEmail: opts.ownerEmail ?? fixture.ownerEmail,
    ...(opts.ownerPassword ? { ownerPassword: opts.ownerPassword } : {}),
  };
  const seeded =
    which === "complete"
      ? await seedCompleteIntake(seedOpts, {
          registry: ADDON_REGISTRY,
          ...(opts.store ? { store: opts.store } : {}),
        })
      : await seedMinimalIntake(seedOpts);
  await ensureSent(seeded.orgId);

  const result = await runAssemblyForOrg(seeded.orgId, deps(opts));
  if (result.status !== "done" && result.status !== "already") {
    const code = result.ledger.error?.code ?? result.errorCode ?? "";
    throw new Error(
      `assembly of ${seedOpts.slug} ended ${result.status}${code ? ` (${code})` : ""}`,
    );
  }
  // "already" carries no host: read the org's primary host (never writes when one exists).
  const previewHost =
    result.previewHost ?? (await ensurePreviewHost(seeded.orgId));
  return {
    orgId: seeded.orgId,
    created: seeded.created,
    previewHost,
    result,
  };
}
