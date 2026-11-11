// ONB-10, D112, D173, RESEARCH Pitfall 11: sender identity, header sanitising and escaping.
import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  formatAddress,
  headerValue,
  isSendingLocalPart,
  senderFor,
  type SenderIdentity,
} from "./index";

const env = {
  mailDomain: "send.connectionsdesignstudios.com",
  supportEmail: null,
};
const org = (over: Partial<Extract<SenderIdentity, { kind: "org" }>> = {}) =>
  ({
    kind: "org",
    name: "Rivera Bakery",
    slug: "rivera-bakery",
    replyTo: "maria@gmail.com",
    ownDomain: null,
    sendingDomainVerified: false,
    ...over,
  }) as const;

describe("senderFor (ONB-10)", () => {
  it("sends as the business name at <slug>@<mail domain>, replies to the routed address", () => {
    expect(senderFor(org(), env)).toEqual({
      fromName: "Rivera Bakery",
      fromAddress: "rivera-bakery@send.connectionsdesignstudios.com",
      replyTo: "maria@gmail.com",
    });
  });

  it("never uses a free-mail domain as From, even when flagged verified", () => {
    const r = senderFor(
      org({ ownDomain: "gmail.com", sendingDomainVerified: true }),
      env,
    );
    expect(r.fromAddress).toBe(
      "rivera-bakery@send.connectionsdesignstudios.com",
    );
  });

  it("uses a verified own domain", () => {
    const r = senderFor(
      org({ ownDomain: "riverabakery.com", sendingDomainVerified: true }),
      env,
    );
    expect(r.fromAddress).toBe("hello@riverabakery.com");
  });

  it("an unverified own domain still uses the platform address", () => {
    const r = senderFor(org({ ownDomain: "riverabakery.com" }), env);
    expect(r.fromAddress).toBe(
      "rivera-bakery@send.connectionsdesignstudios.com",
    );
  });

  it("falls back to 'site' for an invalid slug", () => {
    expect(senderFor(org({ slug: "Bad Slug\r\n" }), env).fromAddress).toBe(
      "site@send.connectionsdesignstudios.com",
    );
  });

  it("strips injection from the business name", () => {
    const r = senderFor(org({ name: "Bakery\r\nBcc: x@y.z" }), env);
    expect(r.fromName).not.toMatch(/[\r\n]/);
  });

  it("drops an invalid reply-to", () => {
    expect(senderFor(org({ replyTo: "not-an-email" }), env).replyTo).toBeNull();
  });

  it("Support sends as A&M Barber Studio with support as reply-to", () => {
    expect(
      senderFor(
        { kind: "cds" },
        { ...env, supportEmail: "support@connectionsdesignstudios.com" },
      ),
    ).toEqual({
      fromName: "A&M Barber Studio",
      fromAddress: "hello@send.connectionsdesignstudios.com",
      replyTo: "support@connectionsdesignstudios.com",
    });
  });

  it("throws when the mail domain itself is free-mail (defence in depth)", () => {
    expect(() =>
      senderFor(
        { kind: "cds" },
        { mailDomain: "gmail.com", supportEmail: null },
      ),
    ).toThrow();
    expect(() =>
      senderFor(org(), { mailDomain: "gmail.com", supportEmail: null }),
    ).toThrow();
  });
});

describe("headerValue / formatAddress / escapeHtml (Pitfall 11)", () => {
  it("strips CR, LF, NUL and C0 controls", () => {
    const v = headerValue("Bakery\r\nBcc: x@y.z");
    expect(v).not.toMatch(/[\r\n]/);
    expect(headerValue("a\u0000b\u0007c\td")).toBe("a b c d");
    expect(headerValue("  x  ")).toBe("x");
  });

  it("caps at 998 characters", () => {
    expect(headerValue("a".repeat(2000)).length).toBe(998);
  });

  it("quotes ASCII display names and escapes quotes", () => {
    expect(formatAddress("Rivera Bakery", "a@b.c")).toBe(
      '"Rivera Bakery" <a@b.c>',
    );
    expect(formatAddress('Say "hi"', "a@b.c")).toBe('"Say \\"hi\\"" <a@b.c>');
  });

  it("uses RFC 2047 for non-ASCII names", () => {
    const v = formatAddress("Café Rosa", "a@b.c");
    expect(v).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <a@b\.c>$/);
    const b64 = /\?B\?(.+)\?=/.exec(v)![1]!;
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      ),
    ).toBe("Café Rosa");
  });

  it("escapes HTML", () => {
    expect(escapeHtml("<b>&\"'")).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });
});

describe("senderFor Support no-reply (P12, D97, T-12-05-01)", () => {
  it("sends as Support from no-reply@ with no Reply-To", () => {
    expect(
      senderFor(
        { kind: "cds", noReply: true },
        { ...env, supportEmail: "help@connectionsdesignstudios.com" },
      ),
    ).toEqual({
      fromName: "A&M Barber Studio Support",
      fromAddress: "no-reply@send.connectionsdesignstudios.com",
      replyTo: null,
    });
  });

  it("plain Support mail keeps hello@ and the support Reply-To", () => {
    const r = senderFor(
      { kind: "cds" },
      { ...env, supportEmail: "help@connectionsdesignstudios.com" },
    );
    expect(r.fromAddress).toBe("hello@send.connectionsdesignstudios.com");
    expect(r.replyTo).toBe("help@connectionsdesignstudios.com");
  });
});

describe("senderFor own-domain local part (P14, 14-25; P14-P20, T-14-25-01, T-14-25-03)", () => {
  const verified = {
    ownDomain: "riverabakery.example",
    sendingDomainVerified: true,
  };

  it("uses the owner's local part on a verified own domain, Reply-To unchanged", () => {
    expect(senderFor(org({ ...verified, localPart: "bookings" }), env)).toEqual(
      {
        fromName: "Rivera Bakery",
        fromAddress: "bookings@riverabakery.example",
        replyTo: "maria@gmail.com",
      },
    );
  });

  it("falls back to hello@ when the local part is empty or invalid", () => {
    for (const localPart of ["", "a..b", "-x", "Bad\r\nBcc", "x".repeat(65)]) {
      expect(senderFor(org({ ...verified, localPart }), env).fromAddress).toBe(
        "hello@riverabakery.example",
      );
    }
  });

  it("ignores the local part while the domain is unverified", () => {
    const r = senderFor(
      org({ ownDomain: "riverabakery.example", localPart: "bookings" }),
      env,
    );
    expect(r.fromAddress).toBe(
      "rivera-bakery@send.connectionsdesignstudios.com",
    );
  });

  it("isSendingLocalPart accepts the pattern only", () => {
    expect(isSendingLocalPart("hello")).toBe(true);
    expect(isSendingLocalPart("front.desk-2")).toBe(true);
    expect(isSendingLocalPart("a")).toBe(true);
    expect(isSendingLocalPart("a..b")).toBe(false);
    expect(isSendingLocalPart("Hello")).toBe(false);
    expect(isSendingLocalPart("x.")).toBe(false);
    expect(isSendingLocalPart("x".repeat(65))).toBe(false);
    expect(isSendingLocalPart(5)).toBe(false);
  });
});
