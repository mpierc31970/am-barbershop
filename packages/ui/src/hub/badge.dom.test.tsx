// @vitest-environment jsdom
// P13 staff badge tones (13-07 choice 3; 13-UI-SPEC "Staff status tone map", lines 190-221).
// Every tone renders its word (colour is never the only signal); the tones the spec gives an
// icon render it aria-hidden, the rest render text only.
import { afterEach, describe, expect, it } from "vitest";
import { Badge, type BadgeTone } from "./Badge";
import { mount, type Mounted } from "../test-support/dom";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

// tone → [word, has icon]
const STAFF_TONES: Record<string, [string, boolean]> = {
  "sla-risk": ["At risk · 2h", true],
  "sla-missed": ["Missed · 3h late", true],
  "sla-met": ["Met", false],
  "p-urgent": ["Urgent", true],
  "p-high": ["High", false],
  "p-normal": ["Normal", false],
  "p-low": ["Low", false],
  internal: ["Internal", true],
  "s-intake": ["Intake", false],
  "s-fit": ["Fit review", false],
  "s-ready": ["Ready for build", false],
  "s-held": ["Held", false],
  "s-notice": ["Fix by Thu", true],
  "s-suspended": ["Suspended", true],
  "s-closed": ["Closed", false],
  "s-lapsed": ["Lapsed", false],
  "s-declined": ["Declined", false],
  demo: ["Demo", false],
  repeat: ["3 upheld DMCA", false],
  abandoned: ["Abandoned · 9d", false],
  "r-flag": ["Flag", false],
  "r-queued": ["Queued scan", false],
  "r-spot": ["Spot check", false],
  "r-report": ["Report", false],
  "r-dmca": ["DMCA", false],
  "r-held": ["Held 1 day", false],
  "r-held-late": ["Held 3 days", true],
  "h-ok": ["OK", false],
  "h-warn": ["Warning", false],
  "h-critical": ["Critical", true],
  "h-none": ["No data", false],
  available: ["Available", false],
  "coming-soon": ["Coming soon", false],
  "rating-up": ["Thumbs up", true],
  "rating-down": ["Thumbs down", true],
  "fs-pending": ["Pending", false],
  "fs-done": ["Converted", false],
  "fs-dismissed": ["Dismissed", false],
};

describe("Badge staff tones (13-07)", () => {
  for (const [tone, [word, hasIcon]] of Object.entries(STAFF_TONES)) {
    it(`${tone} renders "${word}"${hasIcon ? " with an aria-hidden icon" : ""}`, () => {
      mounted = mount(<Badge tone={tone as BadgeTone}>{word}</Badge>);
      const span = mounted.container.querySelector("span");
      expect(span?.textContent).toBe(word);
      const svg = span?.querySelector("svg");
      if (hasIcon) {
        expect(svg).not.toBeNull();
        expect(svg?.getAttribute("aria-hidden")).toBe("true");
      } else {
        expect(svg).toBeNull();
      }
      // Never accent: staff tones are status, not action (13-UI-SPEC "Never accent").
      expect(span?.className).not.toMatch(/accent/);
    });
  }

  it("keeps the staff tones on hub tokens only (no --cds-* identity colour)", () => {
    for (const tone of Object.keys(STAFF_TONES)) {
      mounted = mount(<Badge tone={tone as BadgeTone}>x</Badge>);
      expect(mounted.container.querySelector("span")?.className).not.toMatch(
        /cds-/,
      );
      mounted.unmount();
      mounted = null;
    }
  });
});

// P14 tones (14-30 choice 1; 14-UI-SPEC "Owner domain tone map", "Record class and status badges").
const P14_TONES: Record<string, [string, boolean]> = {
  "dom-none": ["Not connected", false],
  "dom-checking": ["Checking", false],
  "dom-cds": ["CDS is reviewing", false],
  "dom-waiting": ["Waiting", true],
  "dom-ready": ["Ready", false],
  "dom-broken": ["Needs action now", true],
  "rec-cds": ["Managed by CDS", true],
  "rec-email": ["Your email", true],
  "rec-yours": ["Yours", false],
  "rec-copied": ["Copied", true],
  "rec-checking": ["Checking", false],
  "rec-added": ["Added by CDS", false],
  "rec-pending": ["Doesn't match yet", false],
  "g-match": ["Match", false],
  "g-ttl": ["Match · TTL differs", false],
  "g-mismatch": ["Mismatch", true],
  "g-missing": ["Missing", true],
  "g-added": ["Added by CDS", false],
  "g-ack": ["Acknowledged", false],
  "g-override": ["Overridden by Lee", false],
  "m-waiting": ["Waiting", false],
  "m-running": ["Running", true],
  "m-done": ["Done", false],
  "m-owner": ["Waiting on owner", false],
  "m-prepared": ["Prepared", false],
  "m-failed": ["Failed", true],
  "m-skipped": ["Skipped", false],
  "m-cancelled": ["Cancelled", false],
  "s-leaving": ["Leaving", true],
};

describe("Badge P14 tones (14-30)", () => {
  for (const [tone, [word, hasIcon]] of Object.entries(P14_TONES)) {
    it(`${tone} renders "${word}"${hasIcon ? " with an aria-hidden icon" : ""}`, () => {
      mounted = mount(<Badge tone={tone as BadgeTone}>{word}</Badge>);
      const span = mounted.container.querySelector("span");
      expect(span?.textContent).toBe(word);
      const svg = span?.querySelector("svg");
      if (hasIcon) {
        expect(svg).not.toBeNull();
        expect(svg?.getAttribute("aria-hidden")).toBe("true");
      } else {
        expect(svg).toBeNull();
      }
      // Never accent, never CDS identity colour (14-UI-SPEC "Never accent").
      expect(span?.className).not.toMatch(/accent|cds-/);
    });
  }
});
