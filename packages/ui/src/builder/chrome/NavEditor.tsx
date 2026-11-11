"use client";
// Site menu editor (07-25 choices 6, 10, 11; CONT-13; UI-SPEC "Navigation" lines 474-480).
//
// Menu links: the shared LinkListEditor with one nesting level and the 8-link NAV-LIMIT.
// Empty: EMPTY-NAV copy above Add link. Menu button: Switch "Show a button at the end of
// the menu" -> Button text (default "Book now") + Opens: A page / A pop-up. Under the pop-up
// Select: "The button shows on pages where this pop-up is set to appear." (choice 6).
// Controlled: the hub form owns the draft. Hub primitives only, no hex colours.
import {
  NAV_COPY,
  NAV_CTA_DEFAULT,
  NAV_CTA_LABEL_MAX,
  parseNavTarget,
  type NavSettings,
} from "@cds/core/content";
import { useState } from "react";
import { Select, TextField } from "../../hub/fields";
import { Switch } from "../../hub/Switch";
import { LinkListEditor, type ChromePageOption } from "./LinkListEditor";
import { MENU_LIMITS } from "./nav-logic";

export type ChromePopupOption = { id: string; name: string };

export interface NavEditorProps {
  value: NavSettings;
  onChange: (next: NavSettings) => void;
  pages: readonly ChromePageOption[];
  popups: readonly ChromePopupOption[];
  /** Shows the menu button's missing-target error (after a Save attempt). */
  showErrors?: boolean;
}

export const NAV_CTA_POPUP_HELP =
  "The button shows on pages where this pop-up is set to appear.";

export function NavEditor({
  value,
  onChange,
  pages,
  popups,
  showErrors = false,
}: NavEditorProps) {
  const cta = value.cta;
  const parsed = cta ? parseNavTarget(cta.target) : null;
  const [ctaKind, setCtaKind] = useState<"page" | "popup">(
    parsed?.kind === "popup" ? "popup" : "page",
  );
  const ctaId = parsed && parsed.kind !== "url" ? parsed.id : "";
  const ctaError =
    showErrors && cta && ctaId === "" ? NAV_COPY.target : undefined;

  return (
    <div className="flex flex-col gap-8 font-hub text-hub-ink">
      <section
        aria-labelledby="nav-links-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="nav-links-heading" className="text-base font-semibold">
          Menu links
        </h2>
        {value.items.length === 0 ? (
          <p className="text-sm text-hub-ink-muted">{NAV_COPY.empty}</p>
        ) : null}
        <LinkListEditor
          items={value.items}
          onChange={(items) => onChange({ ...value, items })}
          pages={pages}
          nesting
          limits={MENU_LIMITS}
          limitCopy={NAV_COPY.limit}
          place="menu"
          addVerb="Add to menu"
          idPrefix="nav-link"
        />
      </section>

      <section
        aria-labelledby="nav-cta-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="nav-cta-heading" className="text-base font-semibold">
          Menu button
        </h2>
        <Switch
          id="nav-cta-on"
          label="Show a button at the end of the menu"
          checked={cta !== null}
          onChange={(on) =>
            onChange({
              ...value,
              cta: on ? { label: NAV_CTA_DEFAULT, target: "" } : null,
            })
          }
        />
        {cta ? (
          <div className="flex flex-col gap-4 border-l border-hub-border pl-4">
            <TextField
              id="nav-cta-label"
              label="Button text"
              value={cta.label}
              placeholder={NAV_CTA_DEFAULT}
              counter={{ value: cta.label.length, max: NAV_CTA_LABEL_MAX }}
              onChange={(e) =>
                onChange({
                  ...value,
                  cta: { ...cta, label: e.currentTarget.value },
                })
              }
            />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-hub-ink">
                Opens
              </legend>
              {(
                [
                  ["page", "A page"],
                  ["popup", "A pop-up"],
                ] as const
              ).map(([kind, text]) => (
                <label
                  key={kind}
                  className="flex min-h-10 cursor-pointer items-center gap-3 text-base text-hub-ink pointer-coarse:min-h-11"
                >
                  <input
                    type="radio"
                    name="nav-cta-kind"
                    value={kind}
                    checked={ctaKind === kind}
                    onChange={() => {
                      setCtaKind(kind);
                      onChange({ ...value, cta: { ...cta, target: "" } });
                    }}
                    className="h-4 w-4"
                  />
                  {text}
                </label>
              ))}
            </fieldset>
            {ctaKind === "page" ? (
              <Select
                id="nav-cta-page"
                label="Page"
                value={parsed?.kind === "page" ? ctaId : ""}
                error={ctaError}
                options={[
                  { value: "", label: "Choose a page" },
                  ...pages.map((p) => ({ value: p.id, label: p.title })),
                ]}
                onChange={(e) => {
                  const id = e.currentTarget.value;
                  onChange({
                    ...value,
                    cta: { ...cta, target: id ? `page:${id}` : "" },
                  });
                }}
              />
            ) : (
              <Select
                id="nav-cta-popup"
                label="Pop-up"
                value={parsed?.kind === "popup" ? ctaId : ""}
                helper={NAV_CTA_POPUP_HELP}
                error={ctaError}
                options={[
                  { value: "", label: "Choose a pop-up" },
                  ...popups.map((p) => ({ value: p.id, label: p.name })),
                ]}
                onChange={(e) => {
                  const id = e.currentTarget.value;
                  onChange({
                    ...value,
                    cta: { ...cta, target: id ? `popup:${id}` : "" },
                  });
                }}
              />
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
