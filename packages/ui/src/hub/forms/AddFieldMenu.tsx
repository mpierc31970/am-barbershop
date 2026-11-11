"use client";
// "Add field" disclosure (07-18; CONT-25, BILL-14; 07-UI-SPEC "Form editor"). A secondary
// button opens the field types grouped as Text / Choices / Date and time / Other, each a
// labelled role="group", in @cds/core/forms FORM_FIELD_GROUPS order and wording. File upload
// sits behind FeatureInline (10-17, LOCK-INLINE): without `builder-pro` in the server-computed
// entitlement set it is a disabled row with the "Part of Builder Pro" badge plus "Add Builder
// Pro" (owner) or "Ask your site owner…"; with it, the row adds a file field. The server
// re-checks on save (T-10-17-01). Escape closes and returns focus to the button. At 40
// fields the button is disabled with the limit copy. Hub tokens and primitives only.
import { FORM_FIELD_GROUPS, type FormFieldType } from "@cds/core/forms";
import { Plus } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { Button } from "../Button";
import { FeatureInline } from "../FeatureInline";
import { FIELD_ICONS } from "./FieldList";
import {
  BUILDER_PRO_KEY,
  BUILDER_PRO_NAME,
  FIELD_LIMIT_COPY,
  PRO_FIELD_HELPER,
} from "./form-logic";

const NO_ENTITLEMENTS: ReadonlySet<string> = new Set();

export interface AddFieldMenuProps {
  onAdd: (type: FormFieldType) => void;
  limitReached: boolean;
  /** The org's entitlement set, computed on the server (CONTEXT A3). Default: none. */
  entitlements?: ReadonlySet<string>;
  /** May this member buy add-ons (purchases:run): link vs "Ask your site owner". */
  canBuy?: boolean;
  LinkComponent?: HubLinkComponent;
}

export function AddFieldMenu({
  onAdd,
  limitReached,
  entitlements = NO_ENTITLEMENTS,
  canBuy = false,
  LinkComponent,
}: AddFieldMenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const limitId = useId();

  function close() {
    setOpen(false);
    wrap.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  return (
    <div ref={wrap} className="flex flex-col gap-2" onKeyDown={onKeyDown}>
      <Button
        variant="secondary"
        icon={<Plus aria-hidden size={16} strokeWidth={2} />}
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={limitReached ? limitId : undefined}
        disabled={limitReached}
        onClick={() => setOpen((o) => !o)}
        className="w-full"
      >
        Add field
      </Button>
      {limitReached ? (
        <p id={limitId} className="text-sm text-hub-ink-muted">
          {FIELD_LIMIT_COPY}
        </p>
      ) : null}
      {open ? (
        <div
          id={panelId}
          className="flex flex-col gap-4 rounded border border-hub-border bg-hub-surface p-3 shadow-sm"
        >
          {FORM_FIELD_GROUPS.map((g) => (
            <MenuGroup
              key={g.label}
              label={g.label}
              pro={g.pro === true}
              entitlements={entitlements}
              canBuy={canBuy}
              LinkComponent={LinkComponent}
              types={g.types}
              onPick={(type) => {
                setOpen(false);
                onAdd(type);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const ROW =
  "flex min-h-11 items-center gap-3 rounded px-2 text-left text-base text-hub-ink " +
  "transition-colors duration-150 hover:bg-hub-surface-2 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function MenuGroup({
  label,
  pro,
  entitlements,
  canBuy,
  LinkComponent,
  types,
  onPick,
}: {
  label: string;
  pro: boolean;
  entitlements: ReadonlySet<string>;
  canBuy: boolean;
  LinkComponent?: HubLinkComponent;
  types: readonly { type: FormFieldType; label: string }[];
  onPick: (type: FormFieldType) => void;
}) {
  const id = useId();
  const helperId = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1">
      <p id={id} className="px-2 text-sm font-semibold text-hub-ink-muted">
        {label}
      </p>
      {types.map((t) => {
        const Icon = FIELD_ICONS[t.type];
        if (pro) {
          return (
            <FeatureInline
              key={t.type}
              feature={BUILDER_PRO_KEY}
              featureName={BUILDER_PRO_NAME}
              entitlements={entitlements}
              canBuy={canBuy}
              LinkComponent={LinkComponent}
            >
              {(locked) => (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    disabled={locked}
                    aria-describedby={helperId}
                    onClick={locked ? undefined : () => onPick(t.type)}
                    className={
                      locked
                        ? "flex min-h-11 items-center gap-3 rounded px-2 text-left text-base text-hub-ink-muted disabled:cursor-not-allowed"
                        : ROW
                    }
                  >
                    <Icon
                      aria-hidden
                      size={16}
                      strokeWidth={2}
                      className="text-hub-ink-muted"
                    />
                    <span className="flex-1">{t.label}</span>
                  </button>
                  <p id={helperId} className="px-2 text-sm text-hub-ink-muted">
                    {PRO_FIELD_HELPER}
                  </p>
                </div>
              )}
            </FeatureInline>
          );
        }
        return (
          <button
            key={t.type}
            type="button"
            onClick={() => onPick(t.type)}
            className={ROW}
          >
            <Icon
              aria-hidden
              size={16}
              strokeWidth={2}
              className="text-hub-ink-muted"
            />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
