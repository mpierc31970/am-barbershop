// Staff shell copy (13-09; 13-UI-SPEC "Shell", "StaffFind", "ShortcutSheet"). The chrome
// words of the console frame. Copy IDs (SESSION-ENDED …) stay in P13_COPY (@cds/core/staff);
// these are the shell's own labels, kept in one place so no component retypes them
// (13-07 STAFF_TABLE_COPY precedent).

export const STAFF_SHELL_COPY = {
  brand: "CDS staff",
  dev: "Dev",
  navLabel: "Staff console",
  menu: "Menu",
  openMenu: "Open menu",
  closeMenu: "Close menu",
  signOut: "Sign out",
  allTimesCentral: "All times Central",
  needAttention: (n: number) => `${n} need attention`,
  // Find
  findButton: "Find a site or ticket",
  findIcon: "Find",
  findTitle: "Find",
  findInputLabel: "Find",
  findKeysWindows: "Ctrl K",
  findKeysMac: "⌘ K",
  findKeyshortcuts: "Control+K Meta+K",
  findGroups: {
    Tickets: "Tickets",
    Sites: "Sites",
    Cases: "Cases",
    Screens: "Screens",
  },
  findEmpty: (q: string) =>
    `No match for “${q}”. Try a ticket number, a business name or a host.`,
  findCount: (n: number) =>
    n === 0 ? "No results" : n === 1 ? "1 result" : `${n} results`,
  findSearching: "Searching tickets…",
  ticketLabel: (n: number, subject: string) => `#${n} ${subject}`,
  // Shortcut sheet
  shortcutsTitle: "Keyboard shortcuts",
  shortcutsClose: "Close",
  shortcutsOff: "Turn off single-key shortcuts",
  shortcutsTypingNote:
    "Shortcuts are off while you type in a field, except Ctrl Enter and Esc.",
} as const;

/** UI-SPEC ShortcutSheet list, in order: [keys, action]. */
export const STAFF_SHORTCUTS: readonly (readonly [string, string])[] = [
  ["Ctrl K", "Find"],
  ["?", "This list"],
  ["g t", "Today"],
  ["g i", "Tickets inbox"],
  ["g p", "Pipeline"],
  ["g r", "Review queue"],
  ["g s", "Sites"],
  ["j / k", "Next / previous row"],
  ["Enter", "Open row"],
  ["x", "Select row"],
  ["r", "Reply"],
  ["n", "Internal note"],
  ["/", "Insert canned reply"],
  ["a", "Assign to me"],
  ["e", "Set status"],
  ["Ctrl Enter", "Send reply"],
  ["Esc", "Close / back to list"],
];

/** `g <letter>` go-to sequences → sidebar item key. */
export const GO_TO_KEYS: Readonly<Record<string, string>> = {
  t: "today",
  i: "tickets",
  p: "pipeline",
  r: "review",
  s: "sites",
};
