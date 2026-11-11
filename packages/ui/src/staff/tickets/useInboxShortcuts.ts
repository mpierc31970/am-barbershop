"use client";
// useInboxShortcuts (13-41 choice 3; STAFF-05, STAFF-08, D119; 13-UI-SPEC "ShortcutSheet" lines
// 330-337; WCAG 2.1.4). The ticket single-key shortcuts: j / k next / previous, r reply,
// n internal note, / canned reply, a assign to me, e set status, Esc back. Each is wired only
// when its handler is given (in the inbox split pane the StaffTable already owns j / k).
// Off when the console switch is off (useShortcutsEnabled), while focus is in a text field
// (the composer handles its own Ctrl Enter and Esc), with a modifier held, or while a dialog
// is open.
import { useEffect, useRef } from "react";
import { isTypingTarget, useShortcutsEnabled } from "../shell/ShortcutSheet";

export interface InboxShortcutHandlers {
  onNext?(): void;
  onPrev?(): void;
  onReply?(): void;
  onNote?(): void;
  onCanned?(): void;
  onAssignMe?(): void;
  onStatus?(): void;
  onBack?(): void;
}

export interface UseInboxShortcutsOptions extends InboxShortcutHandlers {
  /** Off for a view that is not the active ticket (default on). */
  enabled?: boolean;
}

const KEYS: Record<string, keyof InboxShortcutHandlers> = {
  j: "onNext",
  k: "onPrev",
  r: "onReply",
  n: "onNote",
  "/": "onCanned",
  a: "onAssignMe",
  e: "onStatus",
  Escape: "onBack",
};

export function useInboxShortcuts({
  enabled = true,
  ...handlers
}: UseInboxShortcutsOptions): void {
  const [shortcutsOn] = useShortcutsEnabled();
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled || !shortcutsOn) return;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      const name = KEYS[e.key];
      if (!name) return;
      const fn = ref.current[name];
      if (!fn) return;
      e.preventDefault();
      fn();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, shortcutsOn]);
}
