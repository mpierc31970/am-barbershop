"use client";
// /hub/review client islands (14-34 choices 2-4; DOM-10, D172). Small wrappers that wire the
// @cds/ui/hub/review components to the POST server actions in `actions/launch-review.ts` (and
// the P6 resend in `actions/email-routes.ts`), then navigate back to the checklist with the
// UI-SPEC toast. Rendered only for the Owner (read mode passes no islands' actions). No
// @cds/db import here (browser boundary): every value arrives as plain props.
import {
  KeyFactsConfirm,
  PhoneCheckPanel,
  REVIEW_UI_COPY,
  ReviewSubmitPanel,
  type KeyFactKey,
  type KeyFactsView,
  type ReviewSubmitReason,
} from "@cds/ui/hub/review";
import { useToast } from "@cds/ui/hub";
import { useRouter } from "next/navigation";
import { resendRouteConfirmationAction } from "../../../actions/email-routes";
import {
  confirmKeyFactsAction,
  phoneCheckedAction,
  submitLaunchReviewAction,
} from "../../../actions/launch-review";
import { GuardedLink } from "../GuardedLink";

const READ_ONLY_REFUSAL = {
  ok: false as const,
  code: "forbidden",
  message: REVIEW_UI_COPY.ownerOnly,
};

const REVIEW_HREF = "/hub/review";

export function FactsIsland({
  facts,
  editHrefs,
  unconfirmedEmail,
  resendRouteId,
  readOnly,
}: {
  facts: KeyFactsView;
  editHrefs: Readonly<Record<KeyFactKey, string>>;
  unconfirmedEmail: string;
  /** The waiting email route to resend; null when none. */
  resendRouteId: string | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  return (
    <KeyFactsConfirm
      facts={facts}
      editHrefs={editHrefs}
      unconfirmedEmail={unconfirmedEmail}
      backHref={REVIEW_HREF}
      readOnly={readOnly}
      onConfirm={() =>
        readOnly ? Promise.resolve(READ_ONLY_REFUSAL) : confirmKeyFactsAction()
      }
      onResend={
        resendRouteId && !readOnly
          ? () => resendRouteConfirmationAction(resendRouteId)
          : undefined
      }
      onConfirmed={() => {
        toast.show({ message: REVIEW_UI_COPY.confirmedToast });
        router.push(REVIEW_HREF);
      }}
      LinkComponent={GuardedLink}
    />
  );
}

export function PhoneIsland({
  svg,
  svgLarge,
  shortLink,
  done,
  readOnly,
}: {
  svg: string | null;
  svgLarge: string | null;
  shortLink: string | null;
  done: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  return (
    <PhoneCheckPanel
      svg={svg}
      svgLarge={svgLarge}
      shortLink={shortLink}
      done={done}
      readOnly={readOnly}
      backHref={REVIEW_HREF}
      onChecked={() =>
        readOnly ? Promise.resolve(READ_ONLY_REFUSAL) : phoneCheckedAction()
      }
      onDone={() => {
        toast.show({ message: REVIEW_UI_COPY.phoneCheckedToast });
        router.push(REVIEW_HREF);
      }}
      LinkComponent={GuardedLink}
    />
  );
}

export function SubmitIsland({
  locked,
  reasons,
  domain,
  sent,
  resubmit,
  domainHref,
  readOnly,
}: {
  locked: boolean;
  reasons: readonly ReviewSubmitReason[];
  domain: string | null;
  sent: boolean;
  resubmit: readonly string[];
  domainHref: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  return (
    <ReviewSubmitPanel
      locked={locked}
      reasons={reasons}
      domain={domain}
      sent={sent}
      resubmit={resubmit}
      domainHref={domainHref}
      readOnly={readOnly}
      onSubmit={() =>
        readOnly
          ? Promise.resolve(READ_ONLY_REFUSAL)
          : submitLaunchReviewAction()
      }
      onSent={() => router.refresh()}
      LinkComponent={GuardedLink}
    />
  );
}
