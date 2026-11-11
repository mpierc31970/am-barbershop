// @vitest-environment jsdom
// Hub suspension notice (13-22; STAFF-22; 13-UI-SPEC "Suspension (tenant side)").
import { P13_COPY } from "@cds/core/staff";
import { afterEach, describe, expect, it } from "vitest";
import { mount, type Mounted } from "../../test-support/dom";
import {
  SUSPENSION_NOTICE_COPY,
  SuspensionNotice,
  formatFixBy,
  formatSuspendedOn,
} from "./index";

const CHICAGO = "America/Chicago";
let m: Mounted | null = null;

afterEach(() => {
  m?.unmount();
  m = null;
});

describe("SuspensionNotice", () => {
  it("formats dates in the business time zone", () => {
    expect(formatFixBy("2026-10-15T22:00:00.000Z", CHICAGO)).toBe(
      "Thu 15 Oct, 5:00 pm",
    );
    expect(formatSuspendedOn("2026-10-13T03:00:00.000Z", CHICAGO)).toBe(
      "12 Oct",
    );
    expect(formatFixBy("2026-10-15T22:00:00.000Z", "Not/AZone")).toBe(
      "Thu 15 Oct, 10:00 pm",
    );
    expect(formatFixBy("nope", CHICAGO)).toBeNull();
  });

  it("notice: SUSP-NOTICE with the fix-by date and a link to CDS Support", () => {
    m = mount(
      <SuspensionNotice
        state="notice"
        fixBy="2026-10-15T22:00:00.000Z"
        timeZone={CHICAGO}
      />,
    );
    const el = m.container.querySelector("[data-suspension]")!;
    expect(el.getAttribute("role")).toBe("status");
    expect(el.textContent).toContain(
      P13_COPY.SUSP_NOTICE.replace("{when}", "Thu 15 Oct, 5:00 pm"),
    );
    expect(el.querySelector("strong")?.textContent).toBe("Thu 15 Oct, 5:00 pm");
    const link = el.querySelector("a")!;
    expect(link.getAttribute("href")).toContain("/hub/support");
    expect(link.textContent).toBe(SUSPENSION_NOTICE_COPY.fixLink);
  });

  it("notice without a fix-by still reads as one sentence", () => {
    m = mount(<SuspensionNotice state="notice" timeZone={CHICAGO} />);
    const text = m.container.textContent ?? "";
    expect(text).toContain("Fix it or your site goes offline.");
    expect(text).not.toContain("{when}");
  });

  it("suspended: SUSP-OFFLINE with role=alert", () => {
    m = mount(
      <SuspensionNotice
        state="suspended"
        suspendedAt="2026-10-13T03:00:00.000Z"
        timeZone={CHICAGO}
      />,
    );
    const el = m.container.querySelector("[data-suspension]")!;
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.textContent).toContain(
      P13_COPY.SUSP_OFFLINE.replace("{date}", "12 Oct"),
    );
    expect(el.querySelector("strong")?.textContent).toBe(
      "Your site is offline.",
    );
    expect(el.querySelector("a")?.getAttribute("href")).toContain(
      "/hub/support",
    );
    expect(el.querySelector("a")?.textContent).toBe(
      SUSPENSION_NOTICE_COPY.whyLink,
    );
  });
});
