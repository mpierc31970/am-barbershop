// 13-27: test-only seeds for the apps/web Pipeline action integration test. Keeps the superuser
// client inside packages/db (Invariant 1): a site at a given stage with an owner and a confirmed
// default email route (optionally an assembled ledger or a fit-review case), plus read-backs for
// the organization row and its alerts.
import { randomBytes } from "node:crypto";
import { AUP_TEST_TERMS } from "@cds/core/onboarding";
import { superuser } from "../src/client";

export type PipelineSeedStage =
  | "intake"
  | "fit_review"
  | "ready_for_build"
  | "being_built"
  | "ready_for_review";

/** A done ledger with a two-slot report (same shape as the 13-14 Pipeline seeds). */
function doneLedger(at: string): Record<string, unknown> {
  return {
    template_id: "practitioner",
    template_version: 1,
    status: "done",
    attempts: 1,
    started_at: at,
    assembled_at: at,
    pages: {},
    report: {
      templateId: "practitioner",
      templateVersion: 1,
      slots: [
        { page: "home", slot: "hero.headline", source: "provided" },
        { page: "home", slot: "hero.image", source: "fallback" },
      ],
      polish: [],
      pages: [{ key: "home", label: "Home", outcome: "created", path: "/" }],
    },
  };
}

/**
 * One site at `stage` with an owner. `assembled` writes a done assembly ledger; `fitCase`
 * writes a business profile the keyword fit check holds for review.
 */
export async function seedPipelineOrg(opts: {
  name: string;
  stage: PipelineSeedStage;
  assembled?: boolean;
  fitCase?: boolean;
}): Promise<{ orgId: string; ownerEmail: string }> {
  const pb = await superuser();
  const tag = randomBytes(4).toString("hex");
  const ownerEmail = `pipe-${tag}@example.test`;
  const password = `pw-${randomBytes(8).toString("hex")}`;
  const user = await pb
    .collection("users")
    .create({ email: ownerEmail, password, passwordConfirm: password });
  const org = await pb.collection("organizations").create({
    name: opts.name,
    slug: `pipe-${tag}`,
    status: "active",
    path: "standard",
    stage: opts.stage,
  });
  await pb
    .collection("memberships")
    .create({ user: user.id, organization: org.id, role: "owner" });
  await pb.collection("business_profile").create({
    organization: org.id,
    business_type: opts.fitCase ? "cbd-shop" : "massage",
    description: opts.fitCase
      ? `Organic ${AUP_TEST_TERMS.review} tea`
      : "Relaxing massage studio",
    public_email: ownerEmail,
  });
  await pb.collection("org_intake").create({
    organization: org.id,
    selections: { addons: [], extras: [], carePlan: false, cadence: "monthly" },
    stages_saved: ["business"],
    submitted_at: "",
    ...(opts.assembled
      ? { assembly: doneLedger(new Date().toISOString()) }
      : {}),
  });
  await pb.collection("org_email_routes").create({
    organization: org.id,
    purpose: "default",
    address: ownerEmail,
    confirmed_at: new Date().toISOString(),
  });
  return { orgId: org.id, ownerEmail };
}

/** The organization fields the Pipeline moves. */
export async function pipelineOrgRow(
  orgId: string,
): Promise<{ stage: string; status: string; launchedAt: string }> {
  const row = await (
    await superuser()
  )
    .collection("organizations")
    .getOne(orgId, { fields: "stage,status,launched_at" });
  return {
    stage: String(row.stage ?? ""),
    status: String(row.status ?? ""),
    launchedAt: String(row.launched_at ?? ""),
  };
}

/** alerts rows of one type for one org (bound params only). */
export async function alertRowsFor(
  orgId: string,
  type: string,
): Promise<{ id: string; sourceKey: string }[]> {
  const pb = await superuser();
  const rows = await pb.collection("alerts").getFullList({
    filter: pb.filter("organization = {:o} && type = {:t}", {
      o: orgId,
      t: type,
    }),
  });
  return rows.map((r) => ({ id: r.id, sourceKey: String(r.source_key) }));
}
