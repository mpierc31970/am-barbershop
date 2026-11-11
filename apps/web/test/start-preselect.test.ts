// 15-21 Task 1: /start preselect rules (HUB-02; A3-Q1, D78, P15-P25). Hub CTAs link to
// /start?path=… and /start?addon=…; startPreselect validates both against PATHS and the
// pickable slug set, ignoring anything unknown, hidden, private, coming soon or off-path.
import { describe, expect, it } from "vitest";
import {
  startPreselect,
  type PreselectEntry,
} from "../app/(platform)/start/_components/start-logic";

const VIEW: PreselectEntry[] = [
  { slug: "testimonials", name: "Testimonials", path: "both" },
  { slug: "appointments", name: "Appointments", path: "standard" },
  { slug: "studio-booking", name: "Studio Booking", path: "studio" },
  { slug: "events", name: "Events", path: "standard" },
  { slug: "store", name: "Store", path: "both" },
];
// events = coming soon, store = hidden/private: both absent from the pickable set.
const PICKABLE = new Set(["testimonials", "appointments", "studio-booking"]);

const none = { path: null, addon: null };

describe("startPreselect", () => {
  it("accepts a valid path", () => {
    expect(startPreselect({ path: "studio" }, VIEW, PICKABLE)).toEqual({
      path: "studio",
      addon: null,
    });
    expect(startPreselect({ path: "standard" }, VIEW, PICKABLE).path).toBe(
      "standard",
    );
  });

  it("ignores an invalid or missing path", () => {
    expect(startPreselect({ path: "shop" }, VIEW, PICKABLE)).toEqual(none);
    expect(startPreselect({ path: "STUDIO" }, VIEW, PICKABLE)).toEqual(none);
    expect(startPreselect({ path: "" }, VIEW, PICKABLE)).toEqual(none);
    expect(startPreselect({}, VIEW, PICKABLE)).toEqual(none);
  });

  it("takes the first value of array params", () => {
    expect(
      startPreselect(
        { path: ["studio", "standard"], addon: ["testimonials", "x"] },
        VIEW,
        PICKABLE,
      ),
    ).toEqual({
      path: "studio",
      addon: { slug: "testimonials", name: "Testimonials" },
    });
    expect(startPreselect({ path: [] }, VIEW, PICKABLE)).toEqual(none);
  });

  it("pre-ticks a pickable add-on allowed on the chosen path, with its catalog name", () => {
    expect(
      startPreselect(
        { path: "standard", addon: "appointments" },
        VIEW,
        PICKABLE,
      ),
    ).toEqual({
      path: "standard",
      addon: { slug: "appointments", name: "Appointments" },
    });
    expect(
      startPreselect({ path: "studio", addon: "testimonials" }, VIEW, PICKABLE),
    ).toEqual({
      path: "studio",
      addon: { slug: "testimonials", name: "Testimonials" },
    });
  });

  it("a both-path add-on with no path keeps the path unset", () => {
    expect(startPreselect({ addon: "testimonials" }, VIEW, PICKABLE)).toEqual({
      path: null,
      addon: { slug: "testimonials", name: "Testimonials" },
    });
  });

  it("ignores coming-soon, hidden, private and unknown add-ons", () => {
    // coming soon (in the view, not pickable)
    expect(startPreselect({ addon: "events" }, VIEW, PICKABLE)).toEqual(none);
    // hidden / private (not pickable)
    expect(startPreselect({ addon: "store" }, VIEW, PICKABLE)).toEqual(none);
    // unknown
    expect(startPreselect({ addon: "nope" }, VIEW, PICKABLE)).toEqual(none);
    expect(startPreselect({ addon: "__proto__" }, VIEW, PICKABLE)).toEqual(
      none,
    );
    // pickable slug the view no longer lists
    expect(
      startPreselect({ addon: "ghost" }, VIEW, new Set(["ghost"])),
    ).toEqual(none);
    // path survives a bad addon
    expect(
      startPreselect({ path: "studio", addon: "nope" }, VIEW, PICKABLE),
    ).toEqual({ path: "studio", addon: null });
  });

  it("a degraded catalog read (pickable null) ignores the add-on", () => {
    expect(startPreselect({ addon: "testimonials" }, VIEW, null)).toEqual(none);
    expect(
      startPreselect({ path: "studio", addon: "studio-booking" }, VIEW, null),
    ).toEqual({ path: "studio", addon: null });
  });

  it("a Studio-only add-on with no path also sets path=studio", () => {
    expect(startPreselect({ addon: "studio-booking" }, VIEW, PICKABLE)).toEqual(
      {
        path: "studio",
        addon: { slug: "studio-booking", name: "Studio Booking" },
      },
    );
  });

  it("a Standard-only add-on with no path sets path=standard", () => {
    expect(startPreselect({ addon: "appointments" }, VIEW, PICKABLE)).toEqual({
      path: "standard",
      addon: { slug: "appointments", name: "Appointments" },
    });
  });

  it("an add-on not allowed on an explicit path is dropped, the path kept", () => {
    expect(
      startPreselect(
        { path: "standard", addon: "studio-booking" },
        VIEW,
        PICKABLE,
      ),
    ).toEqual({ path: "standard", addon: null });
    expect(
      startPreselect({ path: "studio", addon: "appointments" }, VIEW, PICKABLE),
    ).toEqual({ path: "studio", addon: null });
  });
});
