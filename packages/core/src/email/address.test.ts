// ONB-10, D173: address normalising and the free-mail list.
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import { emailDomain, isEmail, isFreeMail, normaliseEmail } from "./index";

describe("normaliseEmail", () => {
  it("trims and lower-cases", () => {
    expect(normaliseEmail("  Maria@Example.COM ")).toBe("maria@example.com");
  });

  it.each([
    "maria@",
    "@example.com",
    "maria",
    "",
    "a b@c.com",
    "a@b",
    42,
    null,
  ])("rejects %s with the ERR-EMAIL copy", (raw) => {
    expect(() => normaliseEmail(raw)).toThrow(InvalidInput);
    expect(() => normaliseEmail(raw)).toThrow(
      "That doesn't look like an email address. Check it and try again.",
    );
  });

  it("rejects header-injection attempts", () => {
    expect(isEmail("a@b.com\r\nBcc: x@y.z")).toBe(false);
    expect(isEmail("a@b.com\nx")).toBe(false);
  });
});

describe("isEmail / emailDomain", () => {
  it("accepts plus addresses and subdomains", () => {
    expect(isEmail("maria+site@mail.riverabakery.com")).toBe(true);
    expect(emailDomain("Maria@RiveraBakery.com")).toBe("riverabakery.com");
  });
});

describe("isFreeMail (D173)", () => {
  it.each([
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "icloud.com",
    "me.com",
    "aol.com",
    "proton.me",
    "protonmail.com",
    "gmx.com",
    "zoho.com",
  ])("%s is free-mail", (domain) => {
    expect(isFreeMail(domain)).toBe(true);
    expect(isFreeMail(`someone@${domain}`)).toBe(true);
    expect(isFreeMail(`someone@${domain.toUpperCase()}`)).toBe(true);
  });

  it("own domains are not free-mail", () => {
    expect(isFreeMail("riverabakery.com")).toBe(false);
    expect(isFreeMail("maria@riverabakery.com")).toBe(false);
  });
});
