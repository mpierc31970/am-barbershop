// Settings copy (13-46; STAFF-18, STAFF-16; 13-UI-SPEC "Settings" lines 918-934, dialogs
// lines 1085 and 1087). The two dialogs live in @cds/core/staff P13_DIALOGS (demo_reset,
// staff_role); this file holds the screen labels only.
import type { StaffRole } from "@cds/core";

export const SETTINGS_COPY = {
  staff: {
    caption: "Staff members",
    cols: {
      name: "Name",
      email: "Email",
      role: "Role",
      lastSignIn: "Last sign-in",
      change: "Change role",
    },
    roleLabel: "Role",
    roleFor: (name: string) => `Role for ${name}`,
    roles: {
      super_admin: "Super Admin",
      support_agent: "Support agent",
    } satisfies Record<StaffRole, string>,
    ownRole: "You can't change your own role.",
    never: "Never",
    cliNote: "Add or remove staff with the staff CLI.",
    empty: "No staff yet.",
    caseName: "Person",
    caseFrom: "Now",
    caseTo: "Becomes",
  },
  demo: {
    site: "Site",
    host: "Host",
    lastReset: "Last reset",
    nextReset: "Next reset",
    lastCounts: "Last nightly counts",
    blocked: "What's blocked",
    blockedList: [
      "Email not sent",
      "Stripe test mode",
      "No indexing pings",
      "No scans",
      "No monitor alerts",
    ],
    badge: "demo",
    noHost: "No preview host yet",
    never: "Not reset yet",
    ok: "OK",
    counts: (deleted: number, seeded: number) =>
      `${deleted} rows removed · ${seeded} rows seeded`,
    noCounts: "—",
    missing:
      "The demo tenant doesn't exist yet. Reset now creates Bella's Salon.",
    resetNow: "Reset now",
    resetting: "Resetting…",
    caseSite: "Site",
    caseHost: "Host",
  },
  monitor: {
    intro: (endpoint: string) =>
      `The monitor app reads GET ${endpoint} with MONITOR_TOKEN.`,
    endpoint: "Endpoint",
    token: "Token configured",
    yes: "Yes",
    no: "No",
    overall: "Overall status",
    sections: "Sections",
    sectionsCaption: "Status document sections",
    sectionOk: "OK",
    sectionDegraded: "Degraded",
    overallWords: { ok: "OK", degraded: "Degraded", down: "Down" },
    unavailable: "The status document couldn't be built just now.",
    brief: (path: string) => `Monitor app brief: ${path}`,
    later: "The monitor app is built later (D174).",
  },
} as const;
