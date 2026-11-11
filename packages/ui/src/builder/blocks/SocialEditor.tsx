"use client";
// SocialEditor (07-24; CONT-27, D198, D119; 07-UI-SPEC row "Social and sharing"; D311 admin
// pattern; replaces the 07-07 stub body, name and BUILDER_BLOCKS_B entry kept).
//
// Heading · Show social links (helper: they come from Settings › Business info, with an
// Edit social links link and the connected platforms, "Showing Instagram and Facebook") ·
// Show share buttons -> six checkboxes in canonical order (Facebook, X, LinkedIn, Pinterest,
// Email, Copy link) · an InlineAlert when nothing would show publicly. Background stays in
// SectionForm.
import {
  SOCIAL_SHARE_LABELS,
  SOCIAL_SHARE_TARGETS,
  socialPlatformName,
  type SocialShareTarget,
} from "@cds/core/content";
import { useId } from "react";
import { TextField } from "../../hub/fields";
import { InlineAlert } from "../../hub/feedback";
import { Switch } from "../../hub/Switch";
import {
  BUSINESS_INFO_HREF,
  SETTINGS_LINK_CLASS,
  useBuilderBusiness,
} from "./business-context";
import type { CoreBlockEditorProps } from "./types";

const CHECKBOX =
  "size-4 rounded-sm border-hub-border accent-hub-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

/** "A", "A and B", "A, B and C". */
function andJoin(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function readShare(content: Record<string, unknown>): SocialShareTarget[] {
  if (!Array.isArray(content.share)) return [];
  const set = new Set(content.share as unknown[]);
  return SOCIAL_SHARE_TARGETS.filter((t) => set.has(t));
}

export function SocialEditor({
  content,
  onChange,
  errors,
}: CoreBlockEditorProps) {
  const uid = useId();
  const business = useBuilderBusiness();
  const heading = typeof content.heading === "string" ? content.heading : "";
  const showSocials = content.show_socials !== false;
  const showShare = content.show_share !== false;
  const share = readShare(content);
  const names = [
    ...new Set(
      (business?.socials ?? [])
        .map((s) => socialPlatformName(s))
        .filter((n) => n !== ""),
    ),
  ];
  const noSocials = business !== null && names.length === 0;
  const nothingPublic =
    (noSocials || !showSocials || business === null) &&
    (!showShare || share.length === 0);

  function toggle(target: SocialShareTarget, on: boolean) {
    const set = new Set(share);
    if (on) set.add(target);
    else set.delete(target);
    onChange(
      "share",
      SOCIAL_SHARE_TARGETS.filter((t) => set.has(t)),
    );
  }

  return (
    <div className="flex flex-col gap-6 font-hub">
      <TextField
        id={`${uid}-heading`}
        label="Heading"
        helper="Optional."
        value={heading}
        error={errors.heading}
        onChange={(e) => onChange("heading", e.currentTarget.value)}
      />

      <div className="flex flex-col gap-1">
        <Switch
          id={`${uid}-socials`}
          label="Show social links"
          checked={showSocials}
          onChange={(v) => onChange("show_socials", v)}
          aria-describedby={`${uid}-socials-helper`}
        />
        <div
          id={`${uid}-socials-helper`}
          className="text-sm text-hub-ink-muted"
        >
          <p>
            They come from Settings › Business info.{" "}
            <a href={BUSINESS_INFO_HREF} className={SETTINGS_LINK_CLASS}>
              Edit social links
            </a>
          </p>
          {names.length > 0 ? <p>Showing {andJoin(names)}</p> : null}
          {noSocials ? <p>No social links yet.</p> : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Switch
          id={`${uid}-share`}
          label="Show share buttons"
          checked={showShare}
          onChange={(v) => onChange("show_share", v)}
        />
        {showShare ? (
          <fieldset className="flex flex-col gap-0 pl-1">
            <legend className="mb-1 text-sm font-semibold text-hub-ink">
              Share buttons
            </legend>
            {SOCIAL_SHARE_TARGETS.map((t) => (
              <label
                key={t}
                className="flex min-h-11 items-center gap-3 text-sm text-hub-ink"
              >
                <input
                  id={`${uid}-share-${t}`}
                  type="checkbox"
                  className={CHECKBOX}
                  checked={share.includes(t)}
                  onChange={(e) => toggle(t, e.currentTarget.checked)}
                />
                {SOCIAL_SHARE_LABELS[t]}
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>

      {nothingPublic ? (
        <InlineAlert tone="info">
          <p>
            Add social links in Settings › Business info, or turn on share
            buttons.{" "}
            <a href={BUSINESS_INFO_HREF} className={SETTINGS_LINK_CLASS}>
              Edit social links
            </a>
          </p>
        </InlineAlert>
      ) : null}
    </div>
  );
}
