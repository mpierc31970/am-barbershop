// 11-50: add-on alert types are registered once and used by raiseAlert / the alerts job.
import { CORE_ALERT_TYPES, type AlertTypeSpec } from "@cds/core/alerts";
import { afterEach, describe, expect, it } from "vitest";
import {
  registerAddonAlertTypes,
  registeredAlertTypes,
  resetAddonAlertTypesForTests,
} from "./addon-types";

const BOOKING: AlertTypeSpec = {
  type: "demo.booking_request",
  level: "normal",
  label: "New booking request",
  example: "Someone asked for a time",
  feature: "content",
  access: "read",
  section: "today",
  defaultChannels: { email: true, push: true },
};

describe("registered alert types (11-50)", () => {
  afterEach(() => resetAddonAlertTypesForTests());

  it("is the core set before registration", () => {
    expect(registeredAlertTypes().map((t) => t.type)).toEqual(
      CORE_ALERT_TYPES.map((t) => t.type),
    );
  });

  it("adds manifest alert types after core, in registry order", () => {
    registerAddonAlertTypes([
      { slug: "demo", alerts: [BOOKING] },
      { slug: "plain" },
    ]);
    const types = registeredAlertTypes().map((t) => t.type);
    expect(types.slice(0, CORE_ALERT_TYPES.length)).toEqual(
      CORE_ALERT_TYPES.map((t) => t.type),
    );
    expect(types.at(-1)).toBe("demo.booking_request");
  });

  it("throws at load on a duplicate type", () => {
    expect(() =>
      registerAddonAlertTypes([
        { slug: "a", alerts: [BOOKING] },
        { slug: "b", alerts: [BOOKING] },
      ]),
    ).toThrow(/already defined/);
  });
});
