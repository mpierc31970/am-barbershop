"use client";
// Add an account (11-37 choice 3; DASH-14, D198; 11-UI-SPEC "Add an account" lines 826-834).
//   - AddAccountPicker: Label 600 "Add an account", then one secondary sm button per preset
//     not yet added, in D198 order (brand icon 16 + name), then ghost sm "Add another".
//   - AccountForm: the inline form row (P3 AddPageRow pattern, not a modal) used for a new
//     account and for Edit. "{Platform} profile address" (type url), plus Name (40 chars) for
//     a custom account. Checked on save with validateSocialUrl: the message shows inline under
//     the field (SOCIAL-URL-HTTPS / SOCIAL-URL-HOST); the server checks again (T-11-37-02) and
//     its refusal (SOCIAL-DUP, own site …) shows in the same place.
import {
  CUSTOM_LABEL_MAX,
  CUSTOM_PLATFORM,
  SOCIAL_COPY,
  SOCIAL_PRESETS,
  findPreset,
  socialUrlErrorCopy,
  validateSocialUrl,
} from "@cds/core/social";
import { Globe, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { BrandIcon } from "../../site/icons/BrandIcon";
import { Button } from "../Button";
import { TextField } from "../fields";
import { SOCIAL_UI_COPY as C, addressLabel, addressPlaceholder } from "./copy";

/** The platform's brand icon (decorative), or a globe for custom and icon-less presets. */
export function PlatformIcon({
  platform,
  size = 20,
}: {
  platform: string;
  size?: number;
}) {
  const icon = findPreset(platform)?.icon ?? null;
  return icon ? (
    <BrandIcon id={icon} size={size} className="shrink-0 text-hub-ink" />
  ) : (
    <Globe
      aria-hidden
      size={size}
      strokeWidth={2}
      className="shrink-0 text-hub-ink"
    />
  );
}

export interface AddAccountPickerProps {
  /** Preset keys already added (their buttons are hidden). */
  added: readonly string[];
  disabled?: boolean;
  onPick(platform: string): void;
}

export function AddAccountPicker({
  added,
  disabled,
  onPick,
}: AddAccountPickerProps) {
  const have = new Set(added);
  const left = SOCIAL_PRESETS.filter((p) => !have.has(p.key));
  return (
    <div className="flex flex-col gap-2" data-add-account>
      <p className="font-hub text-sm font-semibold text-hub-ink">
        {C.addHeading}
      </p>
      <div className="flex flex-wrap gap-2">
        {left.map((p) => (
          <Button
            key={p.key}
            variant="secondary"
            size="sm"
            disabled={disabled}
            data-preset={p.key}
            icon={<PlatformIcon platform={p.key} size={16} />}
            onClick={() => onPick(p.key)}
          >
            {p.label}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          data-preset={CUSTOM_PLATFORM}
          icon={<Plus aria-hidden size={16} strokeWidth={2} />}
          onClick={() => onPick(CUSTOM_PLATFORM)}
        >
          {C.addAnother}
        </Button>
      </div>
    </div>
  );
}

export interface AccountFormValues {
  label: string;
  url: string;
}

export interface AccountFormProps {
  platform: string;
  /** Edit: the current values. */
  initial?: AccountFormValues;
  /** A server refusal to show under the address (or name) field. */
  serverError?: { message: string; field?: "label" | "url" } | null;
  pending?: boolean;
  onSave(values: AccountFormValues): void;
  onDiscard(): void;
}

/** Client check before the server call; the server always checks again. */
export function checkAccountForm(
  platform: string,
  values: AccountFormValues,
): { field: "label" | "url"; message: string } | null {
  if (platform === CUSTOM_PLATFORM) {
    const label = values.label.trim();
    if (!label) return { field: "label", message: SOCIAL_COPY.label };
    if (label.length > CUSTOM_LABEL_MAX) {
      return { field: "label", message: SOCIAL_COPY.labelLength };
    }
  }
  const res = validateSocialUrl(platform, values.url);
  if (!res.ok) {
    return { field: "url", message: socialUrlErrorCopy(platform, res.reason) };
  }
  return null;
}

export function AccountForm({
  platform,
  initial,
  serverError,
  pending,
  onSave,
  onDiscard,
}: AccountFormProps) {
  const id = useId();
  const custom = platform === CUSTOM_PLATFORM;
  const name = findPreset(platform)?.label ?? (initial?.label || "Account");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [error, setError] = useState<{
    field: "label" | "url";
    message: string;
  } | null>(null);
  const firstRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    firstRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  useEffect(() => {
    if (serverError) {
      setError({
        field: serverError.field ?? "url",
        message: serverError.message,
      });
    }
  }, [serverError]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const problem = checkAccountForm(platform, { label, url });
    setError(problem);
    if (problem) return;
    onSave({ label: label.trim(), url: url.trim() });
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      data-account-form={platform}
      className="flex flex-col gap-3 py-4"
    >
      <div ref={firstRef} className="flex flex-col gap-3">
        {custom ? (
          <TextField
            id={`${id}-name`}
            label={C.nameLabel}
            value={label}
            maxLength={CUSTOM_LABEL_MAX}
            counter={{ value: label.length, max: CUSTOM_LABEL_MAX }}
            error={error?.field === "label" ? error.message : undefined}
            onChange={(e) => setLabel(e.target.value)}
          />
        ) : null}
        <TextField
          id={`${id}-url`}
          type="url"
          inputMode="url"
          autoComplete="url"
          label={addressLabel(custom ? label.trim() || C.nameLabel : name)}
          placeholder={addressPlaceholder(platform)}
          value={url}
          error={error?.field === "url" ? error.message : undefined}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          loading={pending}
          loadingLabel="Saving…"
        >
          {C.save}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={onDiscard}
        >
          {C.discard}
        </Button>
      </div>
    </form>
  );
}
