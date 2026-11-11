// Page-block countdowns use the owner's browser zone, like pop-ups and the banner
// (03-UI-REVIEW Fix 1, BLOCKER). Node unit project: server markup plus a stubbed zone.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnItem } from "@cds/core/content";
import { ColumnItemForm } from "./ColumnItemForm";
import { browserTimeZone, localInputToUtcIso } from "./editor-logic";
import { useBrowserTimeZone } from "./use-browser-time-zone";

function stubZone(zone: string) {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(
    function (this: Intl.DateTimeFormat) {
      return { ...real.call(this), timeZone: zone };
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

const countdown: ColumnItem = {
  id: "cd1",
  kind: "countdown",
  target_at: "2026-10-12T14:00:00.000Z",
  zero_message: "",
} as ColumnItem;

describe("countdown time zone", () => {
  it("the item form falls back to the browser zone when none is passed", () => {
    stubZone("America/Chicago");
    expect(browserTimeZone()).toBe("America/Chicago");
    const html = renderToStaticMarkup(
      <ColumnItemForm
        item={countdown}
        popups={[]}
        allowPopupButton
        onSave={async () => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain("Your time zone: America/Chicago");
    expect(html).not.toContain("Your time zone: UTC");
    // 14:00Z is 9:00 am in Chicago (CDT) on 12 Oct.
    expect(html).toContain('value="2026-10-12T09:00"');
  });

  it("9:00 am entered in Chicago is saved as 14:00 UTC, not 09:00 UTC", () => {
    expect(localInputToUtcIso("2026-10-12T09:00", "America/Chicago")).toBe(
      "2026-10-12T14:00:00.000Z",
    );
  });

  it("the hook renders UTC on the server so hydration never mismatches", () => {
    function Probe() {
      return <span>{useBrowserTimeZone()}</span>;
    }
    stubZone("America/Chicago");
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>UTC</span>");
  });

  it("the builder no longer hard-codes UTC for block countdowns", () => {
    const src = readFileSync(
      fileURLToPath(
        new URL(
          "../../../../apps/web/app/(platform)/hub/website/pages/[pageId]/Builder.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(src).not.toMatch(/TIME_ZONE\s*=\s*"UTC"/);
    expect(src).toContain("useBrowserTimeZone()");
    expect(src).toMatch(/timeZone=\{timeZone\}/);
  });
});
