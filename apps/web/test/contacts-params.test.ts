// 07-16 Task 1: Contacts URL params (CONTACTS-01, D-UI-P7-21; T-07-16-03, T-07-16-10).
import { describe, expect, it } from "vitest";
import {
  CONTACTS_PER_PAGE,
  contactsHref,
  hasFilters,
  parseContactsParams,
} from "../app/(platform)/hub/marketing/contacts-params";

describe("parseContactsParams", () => {
  it("reads every known key, trimming search and mapping newsletter to consent", () => {
    expect(
      parseContactsParams({
        tab: "contacts",
        q: "  maria ",
        source: "form",
        tag: "VIP",
        newsletter: "subscribed",
        sort: "name",
        page: "3",
        contact: "abc123",
      }),
    ).toEqual({
      q: "maria",
      source: "form",
      tag: "VIP",
      consent: "subscribed",
      sort: "name",
      page: 3,
      contact: "abc123",
      list: undefined,
    });
  });

  it("drops unknown source, newsletter and sort values", () => {
    expect(
      parseContactsParams({
        source: "bogus",
        newsletter: "bogus",
        sort: "-created",
      }),
    ).toEqual({});
  });

  it("drops a page below 1, non-numeric or exponent pages", () => {
    for (const page of ["0", "-1", "abc", "1e9", "2.5", "99999999"]) {
      expect(parseContactsParams({ page }).page).toBeUndefined();
    }
  });

  it("cuts a long search to 100 characters", () => {
    expect(parseContactsParams({ q: "a".repeat(250) }).q).toHaveLength(100);
  });

  it("takes the first element of an array", () => {
    expect(parseContactsParams({ list: ["abc", "def"] }).list).toBe("abc");
    expect(parseContactsParams({ q: ["one", "two"] }).q).toBe("one");
  });

  it("drops ids that fail the id shape, but keeps contact=new", () => {
    expect(parseContactsParams({ contact: "../../x" }).contact).toBeUndefined();
    expect(parseContactsParams({ contact: "new" }).contact).toBe("new");
    expect(parseContactsParams({ list: "a b" }).list).toBeUndefined();
    expect(parseContactsParams({ list: "x".repeat(33) }).list).toBeUndefined();
  });

  it("drops a tag over 40 characters and an empty search", () => {
    expect(parseContactsParams({ tag: "t".repeat(41) }).tag).toBeUndefined();
    expect(parseContactsParams({ q: "   " }).q).toBeUndefined();
  });

  it("50 per page", () => {
    expect(CONTACTS_PER_PAGE).toBe(50);
  });
});

describe("contactsHref", () => {
  it("builds the contacts tab URL with only set keys", () => {
    expect(contactsHref({})).toBe("/hub/marketing?tab=contacts");
    expect(contactsHref({ q: "maria", consent: "subscribed", page: 2 })).toBe(
      "/hub/marketing?tab=contacts&q=maria&newsletter=subscribed&page=2",
    );
  });

  it("resets the page when a filter changes, keeps it when the drawer opens", () => {
    const p = { q: "maria", page: 3 };
    expect(contactsHref(p, { source: "form" })).toBe(
      "/hub/marketing?tab=contacts&q=maria&source=form",
    );
    expect(contactsHref(p, { contact: "abc" })).toBe(
      "/hub/marketing?tab=contacts&q=maria&page=3&contact=abc",
    );
  });

  it("drops empty values and removes keys patched to null", () => {
    expect(contactsHref({ q: "x", tag: "VIP" }, { q: "", tag: null })).toBe(
      "/hub/marketing?tab=contacts",
    );
  });

  it("encodes hostile values and never copies unknown keys", () => {
    const href = contactsHref({ q: "a&tab=x" }, {
      evil: "1",
    } as unknown as Record<string, string>);
    expect(href).toBe("/hub/marketing?tab=contacts&q=a%26tab%3Dx");
    expect(
      contactsHref({ q: "x", evil: "1" } as unknown as Record<string, string>),
    ).toBe("/hub/marketing?tab=contacts&q=x");
    expect(new URL(href, "https://h.test").pathname).toBe("/hub/marketing");
  });

  it("a page patch is kept, sort last_seen is the default and not written", () => {
    expect(contactsHref({ q: "m" }, { page: 4 })).toBe(
      "/hub/marketing?tab=contacts&q=m&page=4",
    );
    expect(contactsHref({ sort: "last_seen" })).toBe(
      "/hub/marketing?tab=contacts",
    );
    expect(contactsHref({}, { sort: "name" })).toBe(
      "/hub/marketing?tab=contacts&sort=name",
    );
  });

  it("hasFilters", () => {
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ sort: "name", page: 2 })).toBe(false);
    expect(hasFilters({ tag: "VIP" })).toBe(true);
  });
});
