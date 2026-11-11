"use client";
// "Your business" fields (06-19; 06-UI-SPEC "1 · Your business"; ONB-01, ONB-04, D-UI-P6-27).
// Reused by setup step 1 and Settings › Business info (06-22): the host passes the profile,
// readOnly and onSave(patch).
//   - Business name: required; saves on blur as org_name (it also renames the organization).
//     An empty name is refused here and never sent.
//   - Tagline: optional, 80 characters with a counter.
//   - What kind of business: the business types of the org's path (prefilled from the quote;
//     a change re-runs the fit check at Send to CDS, not now). "Something else" asks for it.
//   - LogoField: ImageUpload kind logo, description suggested from the business name. Remove
//     is immediate with Undo (D-UI-P6-31).
import type { IntakeSnapshot } from "@cds/core/intake";
import {
  BUSINESS_TYPES,
  businessTypesFor,
  findBusinessType,
} from "@cds/core/onboarding";
import {
  Badge,
  ImageUpload,
  InlineAlert,
  Select,
  TextField,
  type MediaAssetView,
} from "@cds/ui/hub";
import { useRef, useState } from "react";
import type { BusinessProfile } from "@cds/core/intake";
import {
  removeMediaAction,
  restoreMediaAction,
  setMediaAltAction,
} from "../../../actions/media";
import { useStageAutosave, useStageInvalid } from "../setup/[stage]/StageFrame";
import { useProfileField, type ProfileSave } from "./useProfileField";

export const OPTIONAL = <Badge tone="optional">Optional</Badge>;
export const NAME_REQUIRED_COPY = "Add your business name.";
export const TAGLINE_HELPER =
  "A short line under your name, like 'Sourdough baked daily in Austin.' Leave empty to skip it.";
export const LOGO_HELPER =
  "A PNG with a transparent background works best. Leave empty and we'll show your business name in your site's font.";

export function businessTypeOptions(
  path: IntakeSnapshot["path"],
  current: string,
) {
  const types = path ? businessTypesFor(path) : BUSINESS_TYPES;
  const list = types.map((t) => ({ value: t.id, label: t.label }));
  if (current && !list.some((o) => o.value === current)) {
    const known = findBusinessType(current);
    list.unshift({ value: current, label: known?.label ?? current });
  }
  return [{ value: "", label: "Choose one" }, ...list];
}

export interface BusinessInfoFieldsProps {
  profile: BusinessProfile;
  path: IntakeSnapshot["path"];
  readOnly: boolean;
  onSave: ProfileSave;
  /** Live business name, for the logo's suggested description and the style samples. */
  onNameChange?: (name: string) => void;
}

export function BusinessInfoFields({
  profile,
  path,
  readOnly,
  onSave,
  onNameChange,
}: BusinessInfoFieldsProps) {
  const [name, setName] = useState(profile.orgName);
  const [nameLocal, setNameLocal] = useState<string | null>(null);
  const [tagline, setTagline] = useState(profile.tagline);
  const [type, setType] = useState(profile.business_type);
  const [typeOther, setTypeOther] = useState(profile.business_type_other);

  const saveName = useProfileField("org_name", profile.orgName, onSave);
  const saveTagline = useProfileField("tagline", profile.tagline, onSave);
  const saveType = useProfileField(
    "business_type",
    profile.business_type,
    onSave,
  );
  const saveTypeOther = useProfileField(
    "business_type_other",
    profile.business_type_other,
    onSave,
  );
  useStageInvalid("local.org_name", nameLocal !== null);

  return (
    <div className="flex flex-col gap-6">
      <TextField
        id="field-org_name"
        label="Business name"
        autoComplete="organization"
        required
        maxLength={120}
        value={name}
        disabled={readOnly}
        error={nameLocal ?? saveName.error}
        onChange={(e) => {
          setName(e.target.value);
          onNameChange?.(e.target.value);
          if (nameLocal && e.target.value.trim()) setNameLocal(null);
        }}
        onBlur={() => {
          const v = name.trim();
          if (v === "") {
            setNameLocal(NAME_REQUIRED_COPY);
            return;
          }
          setNameLocal(null);
          saveName.save(v);
        }}
      />
      <TextField
        id="field-tagline"
        label="Tagline"
        labelExtra={OPTIONAL}
        helper={TAGLINE_HELPER}
        maxLength={80}
        counter={{ value: tagline.length, max: 80 }}
        value={tagline}
        disabled={readOnly}
        error={saveTagline.error}
        onChange={(e) => setTagline(e.target.value)}
        onBlur={() => saveTagline.save(tagline.trim())}
      />
      <Select
        id="field-business_type"
        label="What kind of business"
        options={businessTypeOptions(path, type)}
        value={type}
        disabled={readOnly}
        error={saveType.error}
        onChange={(e) => {
          setType(e.target.value);
          saveType.save(e.target.value);
        }}
      />
      {type === "other" ? (
        <TextField
          id="field-business_type_other"
          label="Your kind of business"
          helper="Like 'Mobile dog grooming'."
          maxLength={80}
          value={typeOther}
          disabled={readOnly}
          error={saveTypeOther.error}
          onChange={(e) => setTypeOther(e.target.value)}
          onBlur={() => saveTypeOther.save(typeOther.trim())}
        />
      ) : null}
    </div>
  );
}

export interface LogoFieldProps {
  initial: MediaAssetView[];
  businessName: string;
  readOnly: boolean;
  /** Called after a successful upload (setup marks the step saved). */
  onUploaded?: () => void;
}

export function LogoField({
  initial,
  businessName,
  readOnly,
  onUploaded,
}: LogoFieldProps) {
  const [logos, setLogos] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const removed = useRef(new Map<string, MediaAssetView>());
  const alt = useStageAutosave<{ id: string; alt: string }>(
    "media.logo.alt",
    (v) => setMediaAltAction(v.id, v.alt),
  );

  return (
    <div className="flex flex-col gap-2">
      <ImageUpload
        id="field-logo"
        kind="logo"
        label="Logo"
        labelExtra={OPTIONAL}
        helper={LOGO_HELPER}
        value={logos}
        suggestedAlt={businessName.trim()}
        readOnly={readOnly}
        onUploaded={(asset) => {
          setError(null);
          setLogos([asset]);
          onUploaded?.();
        }}
        onAltChange={(id, text) => alt.run({ id, alt: text })}
        onRemove={(id) => {
          const gone = logos.find((l) => l.id === id);
          if (gone) removed.current.set(id, gone);
          setLogos((l) => l.filter((x) => x.id !== id));
          void removeMediaAction(id).then((r) => {
            if (!r.ok) {
              setError(r.message);
              if (gone) setLogos([gone]);
            }
          });
        }}
        onRestore={(id) => {
          const back = removed.current.get(id);
          void restoreMediaAction(id).then((r) => {
            if (!r.ok) {
              setError(r.message);
              return;
            }
            if (back) setLogos([back]);
          });
        }}
      />
      {alt.status === "invalid" && alt.failure ? (
        <p className="text-sm text-hub-danger">{alt.failure.message}</p>
      ) : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
    </div>
  );
}
