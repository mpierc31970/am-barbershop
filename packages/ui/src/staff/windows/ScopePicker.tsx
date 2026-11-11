"use client";
// ScopePicker (13-36 choice 1; STAFF-10, D100; 13-UI-SPEC "Service windows" line 568). The
// five window scopes as radio cards (the RadioCardGroup look): Page · Site part or add-on area ·
// Whole site · Add-on (every site) · Platform (every site). `allowed` comes from the page
// (`staffCan(role, "service_window_platform")`): a scope the role can't use stays visible with
// its label, is disabled, and says SUPER-ONLY, which the radio names with aria-describedby.
// The UI is not the gate: the action and @cds/db refuse it again (T-13-36-01).
import { P13_COPY } from "@cds/core/staff";
import { isWideWindowScope, type WindowScope } from "@cds/core/support";
import { WINDOWS_COPY, WINDOW_SCOPE_ORDER } from "./copy";

export interface ScopePickerProps {
  name: string;
  value: WindowScope | null;
  onChange: (scope: WindowScope) => void;
  allowed: { platform: boolean; addon: boolean };
  /** Id of an error under the group. */
  errorId?: string;
}

export function scopeAllowed(
  scope: WindowScope,
  allowed: ScopePickerProps["allowed"],
): boolean {
  if (!isWideWindowScope(scope)) return true;
  return scope === "platform" ? allowed.platform : allowed.addon;
}

export function ScopePicker({
  name,
  value,
  onChange,
  allowed,
  errorId,
}: ScopePickerProps) {
  return (
    <fieldset
      aria-describedby={errorId}
      className="flex flex-col gap-2 font-hub"
    >
      <legend className="mb-2 text-sm font-semibold text-hub-ink">
        {WINDOWS_COPY.scope}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {WINDOW_SCOPE_ORDER.map((scope) => {
          const id = `${name}-${scope}`;
          const ok = scopeAllowed(scope, allowed);
          const selected = value === scope;
          const helpId = `${id}-help`;
          const superId = `${id}-super`;
          return (
            <label
              key={scope}
              htmlFor={id}
              className={
                "flex cursor-pointer items-start gap-3 rounded border bg-hub-surface p-4 " +
                "transition-colors duration-150 hover:bg-hub-surface-2 " +
                "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 " +
                "has-focus-visible:outline-hub-accent " +
                "has-disabled:cursor-not-allowed has-disabled:bg-hub-surface-2 " +
                (selected
                  ? "border-hub-accent outline outline-1 outline-hub-accent"
                  : "border-hub-border")
              }
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={scope}
                checked={selected}
                disabled={!ok}
                aria-describedby={ok ? helpId : `${helpId} ${superId}`}
                onChange={() => onChange(scope)}
                className="mt-0.5 h-4 w-4 shrink-0 focus-visible:outline-none"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span
                  className={`text-base font-semibold ${ok ? "text-hub-ink" : "text-hub-ink-muted"}`}
                >
                  {WINDOWS_COPY.scopes[scope]}
                </span>
                <span id={helpId} className="text-sm text-hub-ink-muted">
                  {WINDOWS_COPY.scopeHelp[scope]}
                </span>
                {ok ? null : (
                  <span
                    id={superId}
                    className="text-sm font-semibold text-hub-ink-muted"
                  >
                    {P13_COPY.SUPER_ONLY}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
