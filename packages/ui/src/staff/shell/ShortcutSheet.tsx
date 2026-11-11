"use client";
// Keyboard shortcut sheet (13-09; STAFF-05; 13-UI-SPEC "ShortcutSheet", "Accessibility
// contract"; WCAG 2.1.4). The hub right Drawer with a two-column list of KeyHint + action and
// a "Turn off single-key shortcuts" Switch at the bottom. The choice is stored per browser in
// localStorage `cds_staff_shortcuts=off` and shared through useShortcutsEnabled(), so the
// shell's `?` / `g x` keys and any table that passes shortcutsEnabled follow it at once.
// isTypingTarget is the one "focus is in a text field" guard for console shortcuts.
import { X } from "lucide-react";
import { useCallback, useId, useSyncExternalStore } from "react";
import { Drawer } from "../../hub/Drawer";
import { IconButton } from "../../hub/IconButton";
import { Switch } from "../../hub/Switch";
import { KeyHint } from "../table/KeyHint";
import { STAFF_SHELL_COPY, STAFF_SHORTCUTS } from "./copy";

export const SHORTCUTS_STORAGE_KEY = "cds_staff_shortcuts";
const CHANGE_EVENT = "cds-staff-shortcuts-change";

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(SHORTCUTS_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SHORTCUTS_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Store the choice and tell every hook in this tab. */
export function setShortcutsEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.removeItem(SHORTCUTS_STORAGE_KEY);
    else window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, "off");
  } catch {
    // Private mode without storage: the choice lasts until reload.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** [enabled, setEnabled]. Server render and first paint assume on. */
export function useShortcutsEnabled(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => true);
  const set = useCallback((v: boolean) => setShortcutsEnabled(v), []);
  return [enabled, set];
}

/** True when a key press belongs to the focused field, not to a console shortcut. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t.closest('[contenteditable]:not([contenteditable="false"])'))
    return true;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)
    return true;
  if (t instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset"].includes(t.type);
  }
  return false;
}

export interface ShortcutSheetProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutSheet({ open, onClose }: ShortcutSheetProps) {
  const [enabled, setEnabled] = useShortcutsEnabled();
  const switchId = useId();
  const titleId = useId();
  return (
    <Drawer
      open={open}
      onClose={onClose}
      label={STAFF_SHELL_COPY.shortcutsTitle}
      side="right"
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-hub-border pr-2 pl-6">
        <h2 id={titleId} className="text-xl leading-tight font-semibold">
          {STAFF_SHELL_COPY.shortcutsTitle}
        </h2>
        <IconButton
          label={STAFF_SHELL_COPY.shortcutsClose}
          hideTooltip
          onClick={onClose}
          icon={<X aria-hidden="true" size={20} strokeWidth={2} />}
        />
      </div>
      <div className="flex flex-1 flex-col gap-6 p-6">
        <dl
          aria-labelledby={titleId}
          className="grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-3 text-base"
        >
          {STAFF_SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="contents">
              <dt>
                <KeyHint>{keys}</KeyHint>
              </dt>
              <dd className="text-hub-ink">{action}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-hub-ink-muted">
          {STAFF_SHELL_COPY.shortcutsTypingNote}
        </p>
        <div className="mt-auto border-t border-hub-border pt-4">
          <Switch
            id={switchId}
            label={STAFF_SHELL_COPY.shortcutsOff}
            checked={!enabled}
            onChange={(off) => setEnabled(!off)}
          />
        </div>
      </div>
    </Drawer>
  );
}
