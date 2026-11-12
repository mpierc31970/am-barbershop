// Your profile and alerts (11-24; DASH-36, DASH-34, DASH-37; D285, D305, D313; 11-UI-SPEC
// "Profile" lines 368-401; T-11-24-01, T-11-24-02). Every signed-in member has one, whatever
// their role. ScreenHeader + "?" (help id `profile`), one 880px column, sections 32px apart in
// UI-SPEC order: You · Alerts (id="alerts", the bell's Alert settings link) · Quiet hours ·
// Phones and computers · Tours. Every control autosaves; there is no Save button.
// - Alerts lists only the types this person's access covers (alertTypesFor: core + active
//   add-ons, eligibleFor), so billing rows are the Owner's and Viewers see Summary types only.
// - SENSITIVE-ON shows when the site's sensitive-practice mode is on (set in Settings ›
//   Business info, D305).
// - Impersonating CDS staff read the person's defaults (member prefs are never shown to
//   staff) with every control off and the IMPERSONATING line.
import { timeZoneLabel } from "@cds/core/content";
import {
  listMyDevices,
  pushPublicKey,
  readAlertProfileFacts,
  readMemberPrefs,
  type PushDevice,
} from "@cds/db";
import { InlineAlert } from "@cds/ui/hub";
import { PROFILE_COPY, roleLine } from "@cds/ui/hub/alerts";
import { ScreenHeader } from "@cds/ui/hub/shell";
import type { Metadata } from "next";
import { alertTypesFor } from "../../../../lib/alert-types";
import { requireHubSession } from "../../../../lib/session";
import { GuardedLink } from "../GuardedLink";
import { PasswordForm } from "./PasswordForm";
import { ProfilePanels } from "./ProfilePanels";

export const metadata: Metadata = { title: "Your profile and alerts" };

export const dynamic = "force-dynamic";

const DEFAULT_FACTS = {
  sensitiveSetting: "" as const,
  sensitiveOn: false,
  timeZone: "America/Chicago",
};

async function orEmpty<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export default async function ProfilePage() {
  const { ctx, email, org } = await requireHubSession();
  const impersonating = Boolean(ctx.impersonator);
  const [types, prefs, devices, facts] = await Promise.all([
    alertTypesFor(ctx),
    readMemberPrefs(ctx),
    orEmpty<PushDevice[]>(listMyDevices(ctx), []),
    orEmpty(readAlertProfileFacts(ctx), DEFAULT_FACTS),
  ]);
  const zoneLabel = timeZoneLabel(facts.timeZone) || facts.timeZone;

  return (
    <div className="flex w-full max-w-[880px] flex-col gap-8 font-hub text-hub-ink">
      <ScreenHeader
        title={PROFILE_COPY.title}
        helpId="profile"
        LinkComponent={GuardedLink}
      />
      {impersonating ? (
        <InlineAlert tone="info">{PROFILE_COPY.impersonating}</InlineAlert>
      ) : null}
      <section
        aria-labelledby="profile-you"
        className="flex flex-col gap-4"
        data-profile-you=""
      >
        <h2 id="profile-you" className="text-xl leading-tight font-semibold">
          {PROFILE_COPY.you}
        </h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-base">
          <dt className="text-hub-ink-muted">{PROFILE_COPY.email}</dt>
          <dd className="min-w-0 break-words">{email}</dd>
        </dl>
        <p className="text-base">{roleLine(org.name, ctx.role)}</p>
        <p className="text-sm text-hub-ink-muted">{PROFILE_COPY.signinHelp}</p>
      </section>
      {impersonating ? null : <PasswordForm />}
      <ProfilePanels
        types={types}
        alertChannels={prefs.alertChannels}
        quietHours={prefs.quietHours}
        zoneLabel={zoneLabel}
        timeZone={facts.timeZone}
        devices={devices}
        publicKey={impersonating ? null : pushPublicKey()}
        sensitiveBusiness={facts.sensitiveOn ? org.name : null}
        impersonating={impersonating}
      />
    </div>
  );
}
