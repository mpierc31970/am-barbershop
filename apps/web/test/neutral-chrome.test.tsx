// @vitest-environment jsdom
// 11-16 Task 2 (DASH-09, D63, D83; 11-UI-SPEC "Neutral chrome"). The hub is the owner's,
// not CDS's: no element of the shell (sidebar, top bar, switcher, profile menu, screen
// header, NotLiveYet) carries "CDS" or "Connections Design" in its text, alt, title or
// aria-label, except inside [data-cds-identity] (the CDS Support row and its screen) or
// [data-legal-copy] (legal and billing copy that names CDS as the seller).
// 12-06 Task 3 (COMM-05, D83, D64; 12-UI-SPEC lines 233-243): the CDS identity layer is
// allowed on exactly seven surfaces. Every rendered CdsMark sits inside [data-cds-identity],
// and the --cds-* tokens appear in no packages/ui/src/hub file outside the allowlist.
// 13-26 (STAFF-06, D-UI-P13-12; 13-UI-SPEC line 811): entry #8, the ImpersonationBanner shown
// while CDS staff view a site, first in DOM order before the skip link.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  click,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

vi.mock("next/navigation", () => ({
  usePathname: () => "/hub/today",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));
vi.mock("../app/actions/staff/impersonation", () => ({
  endImpersonationAction: vi.fn(async () => {}),
  startImpersonationAction: vi.fn(async () => ({ ok: false })),
}));
vi.mock("../app/actions/session", () => ({
  signOutAction: vi.fn(async () => {}),
  switchOrgAction: vi.fn(async () => ({ ok: false })),
}));

const { HubShell } = await import("../app/(platform)/hub/HubShell");
const nav = await import("../app/(platform)/hub/nav");
const { ToastRegion } = await import("@cds/ui/hub");
const { NotLiveYet, ScreenHeader } = await import("@cds/ui/hub/shell");
const { CdsAuthor, CdsMark, CdsSurface } = await import("@cds/ui/hub/cds");

const CDS = /Connections Design|\bCDS\b/;
const ALLOWED = "[data-cds-identity], [data-legal-copy]";

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal: () => void;
    close: () => void;
  };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

/** Every CDS mention outside the allowed containers, as "where: text". */
function cdsLeaks(root: ParentNode): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent ?? "";
    if (CDS.test(text) && !n.parentElement?.closest(ALLOWED)) {
      out.push(`text: ${text}`);
    }
  }
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const attr of ["alt", "title", "aria-label"]) {
      const v = el.getAttribute(attr);
      if (v && CDS.test(v) && !el.closest(ALLOWED)) out.push(`${attr}: ${v}`);
    }
  }
  return out;
}

/** Every rendered CdsMark outside a [data-cds-identity] container. */
function orphanMarks(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll("[data-cds-mark]")).filter(
    (el) => !el.closest("[data-cds-identity]"),
  );
}

/**
 * The eight places CDS identity may appear (12-UI-SPEC lines 233-243, plus 13-UI-SPEC line
 * 811 for the impersonation banner), with the
 * packages/ui/src/hub source paths that may use the --cds-* tokens for them. Paths are
 * relative to packages/ui/src/hub; a trailing "/" allows the whole directory.
 */
const CDS_IDENTITY_SURFACES = [
  {
    surface: "CDS Support screen and sub-pages (/hub/support/**)",
    paths: ["cds/", "support/"],
  },
  { surface: "CDS-authored bell rows", paths: ["alerts/AlertsPanel.tsx"] },
  { surface: "CDS-sourced Needs-you rows", paths: ["today/"] },
  { surface: "From CDS card", paths: ["today/"] },
  { surface: "CDS notes", paths: ["support/", "today/"] },
  {
    surface: "Service notice strip (active) and locked / held-changes panels",
    paths: ["support/"],
  },
  {
    surface: "Still stuck? Ask CDS footer link in the TrainingDrawer",
    paths: ["TrainingDrawer.tsx"],
  },
  {
    surface: "Impersonation banner while CDS staff view a site (13-26)",
    paths: ["cds/ImpersonationBanner.tsx"],
  },
] as const;

const TOKEN_ALLOWED = [
  ...new Set(CDS_IDENTITY_SURFACES.flatMap((s) => s.paths)),
] as readonly string[];

/** A --cds-* token or a Tailwind --color-cds-* utility (bg-cds-tint, text-cds-mark, ...). */
const CDS_TOKEN = /(?:--|[a-z]-)cds-(?:mark|tint|border)\b/;
/** --cds-* is identity, never action: no violet fills, focus rings, outlines or underlines. */
const CDS_ACTION =
  /\b(?:bg-cds-mark|(?:outline|ring|decoration|caret|accent)-cds-[a-z]+)\b/;

function isAllowedPath(rel: string): boolean {
  return TOKEN_ALLOWED.some((p) =>
    p.endsWith("/") ? rel.startsWith(p) : rel === p,
  );
}

/** Token uses outside the allowlist, and action uses anywhere, as "path: reason". */
function cdsTokenLeaks(files: { rel: string; text: string }[]): string[] {
  const out: string[] = [];
  for (const { rel, text } of files) {
    if (CDS_TOKEN.test(text) && !isAllowedPath(rel)) out.push(`${rel}: token`);
    if (CDS_ACTION.test(text)) out.push(`${rel}: action`);
  }
  return out;
}

const HUB_SRC = join(import.meta.dirname, "../../../packages/ui/src/hub");

function hubSources(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push({
          rel: relative(HUB_SRC, full).split("\\").join("/"),
          text: readFileSync(full, "utf8"),
        });
      }
    }
  };
  walk(HUB_SRC);
  return out;
}

function fullShell(
  impersonation: {
    business: string;
    view: "admin" | "owner";
    reason: string;
    endsAt: string;
  } | null = null,
): Mounted {
  return mount(
    <ToastRegion>
      <HubShell
        businessName="Rivera Bakery"
        siteUrl="https://rivera.example"
        email="ana@rivera.example"
        nav={[
          { ...nav.SETUP_NAV, badge: 2 },
          nav.TODAY_NAV,
          { ...nav.INBOX_NAV, badge: 3 },
          nav.WEBSITE_NAV,
          nav.MARKETING_NAV,
          nav.REPORTS_NAV,
          { ...nav.SETTINGS_NAV, badge: 1 },
        ]}
        pinned={[nav.GET_ADDONS, nav.HELP_NAV, nav.SUPPORT_NAV]}
        orgs={[
          { id: "orgaaaaaaaaaaa1", name: "Rivera Bakery", role: "Owner" },
          { id: "orgbbbbbbbbbbb2", name: "Rivera Catering", role: "Editor" },
        ]}
        currentOrgId="orgaaaaaaaaaaa1"
        jumpIndex={[
          {
            group: "Screens",
            label: "Today",
            href: "/hub/today",
            keywords: "",
          },
        ]}
        profile={{
          name: "ana@rivera.example",
          email: "",
          roleLine: "Owner at Rivera Bakery",
        }}
        impersonation={impersonation}
      >
        <ScreenHeader title="Today" helpId="today" />
        <NotLiveYet />
      </HubShell>
    </ToastRegion>,
  );
}

describe("neutral chrome (DASH-09)", () => {
  it("the shell names CDS only in the CDS Support row", () => {
    mounted = fullShell();
    // Open the popovers so their content is scanned too.
    click(
      document.querySelector('button[aria-label="Your profile and sign out"]'),
    );
    click(
      document.querySelector('button[aria-label^="Switch site, current:"]'),
    );
    click(document.querySelector('button[aria-label="Open menu"]'));
    expect(cdsLeaks(document.body)).toEqual([]);
  });

  it("the CDS Support row is present and marked data-cds-identity", () => {
    mounted = fullShell();
    const rows = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href="/hub/support"]'),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.hasAttribute("data-cds-identity")).toBe(true);
      expect(row.textContent).toContain("Support");
    }
    expect(orphanMarks(document.body)).toEqual([]);
    // No other row carries the identity marker.
    expect(document.querySelectorAll("[data-cds-identity]").length).toBe(
      rows.length,
    );
  });

  it("the scan catches an unmarked CDS mention (self-test)", () => {
    mounted = mount(
      <div>
        <p>Built by Connections Design Studios</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- scan fixture */}
        <img alt="CDS logo" src="/x.png" />
        <p data-legal-copy="">
          CDS bills you monthly. <span>Connections Design Studios</span>
        </p>
        <a data-cds-identity="" href="/hub/support">
          CDS Support
        </a>
      </div>,
    );
    expect(cdsLeaks(document.body)).toEqual([
      "text: Built by Connections Design Studios",
      "alt: CDS logo",
    ]);
  });
});

describe("CDS identity allowlist (COMM-05, 12-06)", () => {
  it("names exactly the eight UI-SPEC identity surfaces", () => {
    expect(CDS_IDENTITY_SURFACES.map((s) => s.surface)).toEqual([
      "CDS Support screen and sub-pages (/hub/support/**)",
      "CDS-authored bell rows",
      "CDS-sourced Needs-you rows",
      "From CDS card",
      "CDS notes",
      "Service notice strip (active) and locked / held-changes panels",
      "Still stuck? Ask CDS footer link in the TrainingDrawer",
      "Impersonation banner while CDS staff view a site (13-26)",
    ]);
  });

  it("#8: the impersonation banner is marked, leaks nothing and precedes the skip link", () => {
    mounted = fullShell({
      business: "Rivera Bakery",
      view: "admin",
      reason: "Checking the menu",
      endsAt: new Date(Date.now() + 52 * 60_000).toISOString(),
    });
    const banner = document.querySelector(
      'section[role="region"][aria-label="Support staff session"]',
    );
    expect(banner).not.toBeNull();
    expect(banner!.hasAttribute("data-cds-identity")).toBe(true);
    expect(banner!.textContent).toContain(
      "Viewing Rivera Bakery as support staff",
    );
    expect(cdsLeaks(document.body)).toEqual([]);
    expect(orphanMarks(document.body)).toEqual([]);
    const skip = Array.from(document.querySelectorAll("a")).find(
      (a) =>
        a.getAttribute("href") === "#hub-main" ||
        /Skip/.test(a.textContent ?? ""),
    );
    expect(skip).toBeTruthy();
    expect(
      banner!.compareDocumentPosition(skip!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The first focusable element in the page is inside the banner (End).
    const first = document.querySelector<HTMLElement>("a[href], button");
    expect(banner!.contains(first)).toBe(true);
  });

  it("no impersonation: no banner", () => {
    mounted = fullShell();
    expect(
      document.querySelector('[aria-label="Support staff session"]'),
    ).toBeNull();
  });

  it("a CdsMark inside a CdsSurface passes; a bare one is caught", () => {
    mounted = mount(
      <div>
        <CdsSurface>
          <CdsAuthor firstName="Mara" />
          <p>We fixed the form.</p>
        </CdsSurface>
        <CdsMark size={20} label />
      </div>,
    );
    const orphans = orphanMarks(document.body);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.getAttribute("aria-label")).toBe("Support");
    // The author chip's "CDS" text sits inside the identity container.
    expect(cdsLeaks(document.body)).toEqual([]);
  });

  it("--cds-* appears in no hub source outside the allowlist, and never as an action", () => {
    const files = hubSources();
    expect(files.some((f) => f.rel === "cds/CdsSurface.tsx")).toBe(true);
    expect(cdsTokenLeaks(files)).toEqual([]);
  });

  it("the token scan catches a leak (self-test)", () => {
    expect(
      cdsTokenLeaks([
        { rel: "Button.tsx", text: 'style={{ color: "var(--cds-mark)" }}' },
        { rel: "shell/Sidebar.tsx", text: 'className="bg-cds-tint"' },
        { rel: "support/Composer.tsx", text: 'className="bg-cds-tint"' },
        {
          rel: "support/x.tsx",
          text: 'className="focus-visible:outline-cds-mark"',
        },
        { rel: "TrainingDrawer.tsx", text: 'className="text-cds-mark"' },
        { rel: "TrainingDrawerX.tsx", text: 'className="text-cds-mark"' },
      ]),
    ).toEqual([
      "Button.tsx: token",
      "shell/Sidebar.tsx: token",
      "support/x.tsx: action",
      "TrainingDrawerX.tsx: token",
    ]);
  });
});
