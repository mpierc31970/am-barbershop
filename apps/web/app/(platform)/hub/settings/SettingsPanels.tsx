"use client";
// Settings client islands (06-22; 06-UI-SPEC "Settings"; D311, D312, PD-21, D-UI-P6-25).
// Settings edits the same records setup does, with the same field groups:
//   - SettingsFrame: H1 "Settings", one AutosaveStatus under it for every field on the tab,
//     the Editor's read-only line, the tab bar and the panel. The leave guard and the
//     beforeunload prompt are the setup frame's (one save scope).
//   - BusinessInfoPanel: stage 1 and stage 2 fields except hours, grouped Your business (name,
//     tagline, type, logo, style) · How customers reach you · Where you are · Social links.
//     Legal and domain answers stay in setup step 7 until P11/P14 (D-UI-P6-25).
//   - TeamHoursPanel: the Team list (settings context), then Opening hours.
//   - EmailPanel: the routing component.
//   - 11-24 (DASH-37, D305): the sensitive-practice Switch closes Your business; it shows the
//     effective value (business-type default when never set) and saves through
//     setSensitivePracticeAction. Read-only without settings write and for impersonating staff.
// Saves go through saveProfileAction with the stage the fields belong to ("business" or
// "contact"), which also marks that setup step saved (true: the fields were saved).
import type { IntakeSnapshot, WeeklyHours } from "@cds/core/intake";
import {
  AutosaveStatus,
  InlineAlert,
  Switch,
  type MediaAssetView,
} from "@cds/ui/hub";
import type { BusinessProfile } from "@cds/core/intake";
import { ScreenHeader } from "@cds/ui/hub/shell";
import { useId, useState, type ReactNode } from "react";
import type { EmailRoutingData, TeamMemberView } from "../../../../lib/intake";
import { saveProfileAction } from "../../../actions/intake";
import { setSensitivePracticeAction } from "../../../actions/site-settings";
import { BusinessInfoFields, LogoField } from "../_intake/BusinessInfoFields";
import { ContactFields } from "../_intake/ContactFields";
import { GuardedLink } from "../GuardedLink";
import { EmailRouting } from "../_intake/EmailRouting";
import { FieldGroup } from "../_intake/FieldGroup";
import { FontPairingPicker } from "../_intake/FontPairingPicker";
import { HoursSection } from "../_intake/HoursSection";
import { TeamSection } from "../_intake/TeamSection";
import { useProfileField, type Patch } from "../_intake/useProfileField";
import {
  LeaveGuardDialog,
  READ_ONLY_COPY,
  SaveScopeProvider,
  useSaveScope,
  useStageAutosave,
} from "../setup/[stage]/StageFrame";

const saveBusiness = (patch: Patch) => saveProfileAction("business", patch);
const saveContact = (patch: Patch) => saveProfileAction("contact", patch);

export function SettingsFrame({
  readOnly,
  tabBar,
  helpId = "settings",
  helpName,
  children,
}: {
  readOnly: boolean;
  tabBar: ReactNode;
  /** The current tab's help id (`settings.<tab>`; 11-47, DASH-17). */
  helpId?: string;
  /** The current tab's label, for the "?" name ("How Email works"). */
  helpName?: string;
  children: ReactNode;
}) {
  const scope = useSaveScope();
  return (
    <SaveScopeProvider scope={scope}>
      <div className="flex flex-col gap-6 font-hub">
        <div className="flex flex-col gap-2">
          <ScreenHeader
            title="Settings"
            helpId={helpId}
            helpName={helpName}
            LinkComponent={GuardedLink}
          />
          <AutosaveStatus
            state={scope.state}
            invalidCount={scope.invalidCount}
            onRetry={scope.retryAll}
          />
        </div>
        {readOnly ? (
          <InlineAlert tone="info">{READ_ONLY_COPY}</InlineAlert>
        ) : null}
        {tabBar}
        <div className="flex w-full max-w-[720px] min-w-0 flex-col gap-12">
          {children}
        </div>
      </div>
      <LeaveGuardDialog scope={scope} />
    </SaveScopeProvider>
  );
}

export const SENSITIVE_COPY = {
  label: "Keep client names out of phone and email alerts",
  help: "On for therapy, counseling and health businesses unless you turn it off.",
} as const;

/** 11-24 (DASH-37, D305): sensitive-practice mode, autosaved into the Settings status. */
function SensitivePracticeSwitch({
  initial,
  readOnly,
}: {
  initial: boolean;
  readOnly: boolean;
}) {
  const id = useId();
  const [on, setOn] = useState(initial);
  const save = useStageAutosave<"on" | "off">(
    "business.sensitive_practice",
    (v) => setSensitivePracticeAction(v),
    { onFailed: () => setOn(initial) },
  );
  return (
    <div className="flex flex-col gap-1" data-sensitive-practice="">
      <Switch
        id={`${id}-sensitive`}
        label={SENSITIVE_COPY.label}
        checked={on}
        disabled={readOnly}
        aria-describedby={`${id}-sensitive-help`}
        onChange={(next) => {
          setOn(next);
          save.run(next ? "on" : "off");
        }}
      />
      <p id={`${id}-sensitive-help`} className="text-sm text-hub-ink-muted">
        {SENSITIVE_COPY.help}
      </p>
    </div>
  );
}

export function BusinessInfoPanel({
  profile,
  path,
  logo,
  readOnly,
  sensitive = null,
}: {
  profile: BusinessProfile;
  path: IntakeSnapshot["path"];
  logo: MediaAssetView[];
  readOnly: boolean;
  /** 11-24: effective sensitive-practice mode (null when it could not be read). */
  sensitive?: { on: boolean; readOnly: boolean } | null;
}) {
  const [name, setName] = useState(profile.orgName);
  const [pairing, setPairing] = useState(profile.font_pairing);
  const savePairing = useProfileField(
    "font_pairing",
    profile.font_pairing,
    saveBusiness,
  );
  return (
    <>
      <FieldGroup id="group-business" title="Your business">
        <BusinessInfoFields
          profile={profile}
          path={path}
          readOnly={readOnly}
          onSave={saveBusiness}
          onNameChange={setName}
        />
        <LogoField initial={logo} businessName={name} readOnly={readOnly} />
        <FontPairingPicker
          value={pairing}
          businessName={name}
          readOnly={readOnly}
          error={savePairing.error}
          onChange={(id) => {
            setPairing(id);
            savePairing.save(id);
          }}
        />
        {sensitive ? (
          <SensitivePracticeSwitch
            initial={sensitive.on}
            readOnly={readOnly || sensitive.readOnly}
          />
        ) : null}
      </FieldGroup>
      <ContactFields
        profile={profile}
        readOnly={readOnly}
        onSave={saveContact}
      />
    </>
  );
}

export function TeamHoursPanel({
  team,
  hours,
  timeZone,
  readOnly,
}: {
  team: TeamMemberView[];
  hours: WeeklyHours | null;
  timeZone: string;
  readOnly: boolean;
}) {
  return (
    <>
      <TeamSection data={team} readOnly={readOnly} context="settings" />
      <HoursSection
        hours={hours}
        timeZone={timeZone}
        readOnly={readOnly}
        onSave={saveContact}
        timeZoneHref="/hub/settings?tab=business#field-time_zone"
      />
    </>
  );
}

export function EmailPanel({
  data,
  businessName,
  readOnly,
}: {
  data: EmailRoutingData;
  businessName: string;
  readOnly: boolean;
}) {
  return (
    <EmailRouting data={data} businessName={businessName} readOnly={readOnly} />
  );
}
