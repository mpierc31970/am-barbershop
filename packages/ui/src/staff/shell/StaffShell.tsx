"use client";
// Staff console shell (13-09; STAFF-05, D311; 13-UI-SPEC "Shell", "Responsive contract").
// The hub shell geometry with staff content: >= 1024px a fixed 240px sidebar on hub-surface-2
// plus the 56px sticky top bar; below, the same sidebar in the left hub Drawer. The root
// carries data-cds-identity (CDS chrome, never tenant tokens). Everything is data passed in
// by the web app (nav from STAFF_SECTIONS + staffCan, Find index, server actions), so the shell
// holds no roles and decides nothing (T-13-09-01).
//
// Keys (document level, off while typing, and off entirely when the staff user turns
// single-key shortcuts off; WCAG 2.1.4): Ctrl/Cmd K opens Find (a modifier chord, always
// on), `?` opens the shortcut sheet, `g` then t / i / p / r / s goes to Today, Tickets,
// Pipeline, Review queue, Sites (1.5s to press the second key). No key fires while a dialog
// is open.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Drawer } from "../../hub/Drawer";
import { useJumpShortcut } from "../../hub/shell/JumpToDialog";
import { GO_TO_KEYS, STAFF_SHELL_COPY } from "./copy";
import {
  ShortcutSheet,
  isTypingTarget,
  useShortcutsEnabled,
} from "./ShortcutSheet";
import {
  StaffFind,
  type StaffFindEntry,
  type StaffFindSearch,
} from "./StaffFind";
import {
  StaffSidebar,
  type StaffEnv,
  type StaffNavItem,
  type StaffSignOutAction,
  type StaffUser,
} from "./StaffSidebar";
import { StaffTopBar } from "./StaffTopBar";

export interface StaffShellProps {
  nav: readonly StaffNavItem[];
  user: StaffUser;
  env: StaffEnv;
  signOutAction: StaffSignOutAction;
  findIndex: readonly StaffFindEntry[];
  searchTickets: StaffFindSearch;
  /** Client navigation (router.push in the web app); defaults to location.assign. */
  onNavigate?: (href: string) => void;
  /** Phone header title. */
  title?: string;
  children: ReactNode;
}

const GO_TO_WINDOW_MS = 1500;

export function StaffShell({
  nav,
  user,
  env,
  signOutAction,
  findIndex,
  searchTickets,
  onNavigate,
  title,
  children,
}: StaffShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shortcutsOn] = useShortcutsEnabled();
  const goAt = useRef(0);

  const navigate = useCallback(
    (href: string) => {
      if (onNavigate) onNavigate(href);
      else window.location.assign(href);
    },
    [onNavigate],
  );

  useJumpShortcut(() => setFindOpen(true));

  useEffect(() => {
    if (!shortcutsOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "?") {
        e.preventDefault();
        goAt.current = 0;
        setSheetOpen(true);
        return;
      }
      const now = Date.now();
      if (goAt.current && now - goAt.current <= GO_TO_WINDOW_MS) {
        goAt.current = 0;
        const key = GO_TO_KEYS[e.key];
        const item = key ? nav.find((n) => n.key === key) : undefined;
        if (item) {
          // WR-E04: the chord owns this key. The listener runs in the capture phase, so page
          // shortcuts (the ticket `r` Reply) never also see the `r` of `g r`.
          e.preventDefault();
          e.stopPropagation();
          navigate(item.href);
        }
        return;
      }
      if (e.key === "g" && !e.shiftKey) goAt.current = now;
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [shortcutsOn, nav, navigate]);

  return (
    <div
      data-cds-identity=""
      className="min-h-screen bg-hub-surface font-hub text-hub-ink"
    >
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-hub-border lg:block">
        <StaffSidebar
          nav={nav}
          user={user}
          env={env}
          signOutAction={signOutAction}
        />
      </aside>
      <Drawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        label={STAFF_SHELL_COPY.menu}
      >
        <StaffSidebar
          nav={nav}
          user={user}
          env={env}
          signOutAction={signOutAction}
          onNavigateItem={() => setMenuOpen(false)}
        />
      </Drawer>
      <div className="flex min-h-screen flex-col lg:pl-60">
        <StaffTopBar
          env={env}
          title={title}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenFind={() => setFindOpen(true)}
          onOpenShortcuts={() => setSheetOpen(true)}
        />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] flex-1 p-4 lg:p-8"
        >
          {children}
        </main>
      </div>
      <StaffFind
        open={findOpen}
        onOpenChange={setFindOpen}
        index={findIndex}
        searchTickets={searchTickets}
        onNavigate={navigate}
      />
      <ShortcutSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
