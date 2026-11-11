// 07-25 Task 1: footer rules (CONT-13; D248, D249; T-07-25-03).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import {
  copyrightText,
  formatAddressLines,
  resolveFooter,
  validateFooter,
  type FooterBusinessInput,
} from "./footer";

const P1 = "aaaaaaaaaaaaaa1";

describe("validateFooter", () => {
  it("defaults the switches on, no links, default copyright", () => {
    expect(validateFooter(null)).toEqual({
      show_address: true,
      show_hours: true,
      show_socials: true,
      extra_links: [],
      copyright: "",
      held: false,
    });
    expect(validateFooter({ show_hours: false }).show_hours).toBe(false);
  });

  it("refuses 7 extra links, pop-up targets and long copyright", () => {
    const links = Array.from({ length: 7 }, (_, i) => ({
      id: `l${i}`,
      label: "x",
      target: "https://x.com",
    }));
    expect(() => validateFooter({ extra_links: links })).toThrow(
      "Footers hold up to 6 extra links.",
    );
    expect(() =>
      validateFooter({
        extra_links: [{ id: "a", label: "x", target: "popup:bbbbbbbbbbbbbb1" }],
      }),
    ).toThrow(InvalidInput);
    expect(() =>
      validateFooter({
        extra_links: [{ id: "a", label: "x", target: "javascript:alert(1)" }],
      }),
    ).toThrow(InvalidInput);
    expect(() => validateFooter({ copyright: "x".repeat(121) })).toThrow(
      InvalidInput,
    );
  });

  it("drops children, unknown keys and organization", () => {
    const v = validateFooter({
      organization: "evil",
      extra_links: [
        {
          id: "a",
          label: "Privacy",
          target: `page:${P1}`,
          children: [{ id: "b", label: "x", target: "https://x.com" }],
        },
      ],
    });
    expect(Object.keys(v).sort()).toEqual([
      "copyright",
      "extra_links",
      "held",
      "show_address",
      "show_hours",
      "show_socials",
    ]);
    expect(v.extra_links[0]).toEqual({
      id: "a",
      label: "Privacy",
      target: `page:${P1}`,
      new_tab: false,
    });
  });
});

describe("copyrightText / formatAddressLines", () => {
  it("fills the default and the year token", () => {
    expect(copyrightText("", { name: "Rivera Bakery", year: 2026 })).toBe(
      "© 2026 Rivera Bakery",
    );
    expect(copyrightText("© {year} Rivera", { name: "x", year: 2026 })).toBe(
      "© 2026 Rivera",
    );
  });

  it("formats the address in two lines", () => {
    expect(
      formatAddressLines({
        street: "12 Oak St",
        city: "Austin",
        state: "TX",
        zip: "78701",
      }),
    ).toEqual(["12 Oak St", "Austin, TX 78701"]);
    expect(
      formatAddressLines({ street: "", city: "", state: "", zip: "" }),
    ).toEqual([]);
  });
});

const BUSINESS: FooterBusinessInput = {
  name: "Rivera Bakery",
  phone: "512-555-0100",
  public_email: "hi@rivera.test",
  address: { street: "12 Oak St", city: "Austin", state: "TX", zip: "78701" },
  time_zone: "America/Chicago",
  hours: {
    mon: { open: true, ranges: [{ start: "09:00", end: "17:00" }] },
    tue: { open: false, ranges: [] },
    wed: { open: false, ranges: [] },
    thu: { open: false, ranges: [] },
    fri: { open: false, ranges: [] },
    sat: { open: false, ranges: [] },
    sun: { open: false, ranges: [] },
  },
  // 11-35: links as social_accounts project them (presets incl. threads; custom = "other"
  // with its name).
  socials: [
    { platform: "instagram", url: "https://instagram.com/rivera" },
    { platform: "threads", url: "https://threads.net/@rivera" },
    {
      platform: "other",
      url: "https://etsy.com/shop/rivera",
      label: "  Etsy  ",
    },
    { platform: "other", url: "javascript:alert(1)" },
  ],
};

describe("resolveFooter", () => {
  const pages = new Map([[P1, { path: "/privacy", title: "Privacy" }]]);
  const footer = validateFooter({
    copyright: "© {year} Rivera Bakery LLC",
    extra_links: [
      { id: "a", label: "Privacy policy", target: `page:${P1}` },
      { id: "b", label: "Shop", target: "https://shop.test/" },
    ],
  });

  it("returns every column with raw hours and safe socials", () => {
    const r = resolveFooter(footer, { business: BUSINESS, pages, year: 2026 });
    expect(r.name).toBe("Rivera Bakery");
    expect(r.addressLines).toEqual(["12 Oak St", "Austin, TX 78701"]);
    expect(r.phone).toBe("512-555-0100");
    expect(r.email).toBe("hi@rivera.test");
    expect(r.socials).toEqual([
      { platform: "instagram", url: "https://instagram.com/rivera" },
      { platform: "threads", url: "https://threads.net/@rivera" },
      { platform: "other", url: "https://etsy.com/shop/rivera", label: "Etsy" },
    ]);
    expect(r.hours).toEqual({
      weekly: BUSINESS.hours,
      timeZone: "America/Chicago",
    });
    expect(r.links.map((l) => l.href)).toEqual([
      "/privacy",
      "https://shop.test/",
    ]);
    expect(r.copyright).toBe("© 2026 Rivera Bakery LLC");
  });

  it("honours the switches and the held state", () => {
    const r = resolveFooter(
      {
        ...footer,
        show_address: false,
        show_hours: false,
        show_socials: false,
        held: true,
      },
      { business: BUSINESS, pages, year: 2026 },
    );
    expect(r.addressLines).toEqual([]);
    expect(r.hours).toBeNull();
    expect(r.socials).toEqual([]);
    expect(r.links).toEqual([]);
    expect(r.copyright).toBe("© 2026 Rivera Bakery");
  });

  it("null footer uses defaults", () => {
    const r = resolveFooter(null, { business: BUSINESS, pages, year: 2026 });
    expect(r.addressLines).toHaveLength(2);
    expect(r.copyright).toBe("© 2026 Rivera Bakery");
  });
});
