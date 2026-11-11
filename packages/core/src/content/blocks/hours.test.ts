// Business hours block (07-07; CONT-27, D257: options only, data bound live).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import { FULL_WIDTH_ONLY } from "../layouts";
import { defaultHoursBlock, hoursSection, validateHoursBlock } from "./hours";

describe("hours content", () => {
  it("keeps only the two options", () => {
    expect(
      validateHoursBlock({
        heading: " Open ",
        show_open_now: false,
        hours: { mon: [{ open: "09:00", close: "17:00" }] },
        time_zone: "America/Chicago",
      }),
    ).toEqual({ heading: "Open", show_open_now: false });
    expect(validateHoursBlock({ show_open_now: "no" }).show_open_now).toBe(
      true,
    );
    expect(() => validateHoursBlock("x")).toThrow(InvalidInput);
  });

  it("contract", () => {
    const d = defaultHoursBlock();
    expect(d).toEqual({ heading: "Opening hours", show_open_now: true });
    expect(hoursSection.validate(d, "full")).toEqual(d);
    expect(hoursSection.type).toBe("hours");
    expect(hoursSection.label).toBe("Business hours");
    expect(hoursSection.layouts).toEqual(FULL_WIDTH_ONLY);
    expect(hoursSection.headings).toEqual({
      ownsH1: false,
      blockHeading: "h2",
    });
    expect(hoursSection.refsOf(null)).toEqual({
      popups: [],
      forms: [],
      media: [],
    });
    expect(hoursSection.textsOf(d)).toEqual(["Opening hours"]);
    expect(hoursSection.urlsOf(d)).toEqual([]);
    for (const bad of [null, undefined, 5, "x", []]) {
      expect(() => hoursSection.textsOf(bad)).not.toThrow();
      expect(() => hoursSection.mapRichText(bad, (h) => h)).not.toThrow();
    }
  });
});
