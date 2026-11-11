// Send to CDS (CONTEXT A3-Q4; ONB-01, ONB-02; TEN-15; T-06-60). Owner-only: the permission
// matrix gives intake send to the owner, and its impersonation deny list refuses staff acting
// as the owner. Refused while any required item is missing (the pure still-needed rules
// decide, with the selected add-ons' intake fields). One audited batch sets
// org_intake.submitted_at and moves the org to ready_for_build; an org held in fit_review
// stays there (CDS clears the fit case first), but its submit time is recorded. The fit
// check runs again first (A-CR-01, ONB-12, D215): the profile and name can change after
// Submit, so a new non-clear reason holds the org in fit_review instead (audited fit.hold).
import { InvalidInput } from "@cds/core";
import type { AddonRegistry } from "@cds/core/addons";
import { addonIntakeFields, stillNeeded } from "@cds/core/intake";
import { auditBody } from "../audit";
import {
  fitHoldEvent,
  getFitChecker,
  orgFitInput,
  rescreenFit,
  type FitChecker,
} from "../fit";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import type { OrgContext } from "../context";
import { mapError, newRecordId, requirePermission } from "../repository";
import { ClientResponseError } from "pocketbase";
import { loadIntake } from "./snapshot";

export const INTAKE_INCOMPLETE_COPY =
  "A few things are still needed before CDS can start. Finish the items marked Needed.";

/** Send to CDS was refused: `missing` lists the required field ids still empty. */
export class IntakeIncomplete extends InvalidInput {
  override readonly code: string = "intake_incomplete";
  readonly missing: string[];
  constructor(missing: string[]) {
    super(INTAKE_INCOMPLETE_COPY);
    this.missing = missing;
  }
}

export const ALREADY_SENT_COPY = "This site has already been sent to CDS.";

export async function sendToCds(
  ctx: OrgContext,
  registry: AddonRegistry,
  deps: { fitChecker?: FitChecker } = {},
): Promise<{ submittedAt: Date; stage: "ready_for_build" | "fit_review" }> {
  requirePermission(ctx, "intake_send", "run");
  return withOrgLock(ctx.orgId, () =>
    withSuperuser(async (pb) => {
      const l = await loadIntake(pb, ctx);
      // A-WR-03: only an org still in setup may send, and only once. Any other stage
      // (ready_for_build, not in setup, later build stages) is never moved back.
      // R2-WR-01: an org at intake whose intake is already sent is an approve that raced a
      // Send (or whose reconcile failed): Send finishes the move and keeps the first
      // submitted_at, instead of refusing and leaving the org stuck.
      const finish = l.stage === "intake" && l.intake.submittedAt !== null;
      if (
        !finish &&
        ((l.stage !== "intake" && l.stage !== "fit_review") ||
          l.intake.submittedAt !== null)
      ) {
        throw new InvalidInput(ALREADY_SENT_COPY);
      }
      const extra = addonIntakeFields(registry, l.intake.selections);
      const { required } = stillNeeded(l.snapshot, extra);
      if (required.length > 0) {
        throw new IntakeIncomplete(required.map((i) => i.fieldId));
      }
      const fit = await rescreenFit(
        pb,
        ctx.orgId,
        l.stage,
        orgFitInput(l.snapshot.orgName, l.snapshot.profile),
        deps.fitChecker ?? getFitChecker(),
      );
      const submittedAt =
        finish && l.intake.submittedAt ? l.intake.submittedAt : new Date();
      const stage: "fit_review" | "ready_for_build" =
        l.stage === "fit_review" || fit ? "fit_review" : "ready_for_build";
      const batch = pb.createBatch();
      // On finish, the intake row already records the first send and is left as it is.
      if (finish) {
        // nothing to write on org_intake
      } else if (l.intakeRowId) {
        batch.collection("org_intake").update(l.intakeRowId, {
          submitted_at: submittedAt.toISOString(),
        });
      } else {
        batch.collection("org_intake").create({
          id: newRecordId(),
          organization: ctx.orgId,
          selections: {},
          submitted_at: submittedAt.toISOString(),
        });
      }
      if (stage !== l.stage) {
        batch.collection("organizations").update(ctx.orgId, { stage });
      }
      if (fit) {
        batch
          .collection("audit_log")
          .create(auditBody(ctx, fitHoldEvent(ctx.orgId, fit, "send")));
      }
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "intake.send",
          targetCollection: "org_intake",
          targetId: l.intakeRowId ?? "",
          meta: finish ? { stage, reconcile: true } : { stage },
        }),
      );
      await batch.send();
      return { submittedAt, stage };
    }),
  ).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}
