// Old-URL table (HUB-03, P15-P11, P15-P26). Owner: 15-06.
import { describe, expect, it } from "vitest";
import { OLD_URLS, oldUrlTarget } from "../lib/old-urls";

describe("oldUrlTarget", () => {
  it.each([
    ["/services", "/add-ons"],
    ["/testimonials", "/work"],
    ["/book", "/contact?topic=call"],
    ["/terms", "/legal/terms-of-service"],
    ["/resources", "/"],
    ["/admin", "/sign-in"],
    ["/api/newsletter/unsubscribe", "/unsubscribe"],
    ["/api/newsletter/subscribe", "/"],
  ])("GET %s → 301 %s", (path, location) => {
    expect(oldUrlTarget(path, "GET")).toEqual({ status: 301, location });
  });

  it("every OLD_URLS entry answers GET with its fixed 301", () => {
    for (const [path, location] of Object.entries(OLD_URLS)) {
      expect(oldUrlTarget(path, "GET")).toEqual({ status: 301, location });
    }
    expect(Object.isFrozen(OLD_URLS)).toBe(true);
  });

  it("ignores a trailing slash", () => {
    expect(oldUrlTarget("/services/", "GET")).toEqual({
      status: 301,
      location: "/add-ons",
    });
    expect(oldUrlTarget("/admin/", "GET")).toEqual({
      status: 301,
      location: "/sign-in",
    });
  });

  it("sends every /admin/* path to /sign-in", () => {
    expect(oldUrlTarget("/admin/login", "GET")).toEqual({
      status: 301,
      location: "/sign-in",
    });
    expect(oldUrlTarget("/admin/a/b", "GET")).toEqual({
      status: 301,
      location: "/sign-in",
    });
    expect(oldUrlTarget("/administrator", "GET")).toBeNull();
  });

  it("answers the newsletter POSTs without a redirect", () => {
    expect(oldUrlTarget("/api/newsletter/unsubscribe", "POST")).toEqual({
      status: 200,
    });
    expect(oldUrlTarget("/api/newsletter/subscribe", "POST")).toEqual({
      status: 410,
    });
    expect(oldUrlTarget("/api/newsletter/subscribe/", "post")).toEqual({
      status: 410,
    });
  });

  it("HEAD redirects like GET", () => {
    expect(oldUrlTarget("/book", "HEAD")).toEqual({
      status: 301,
      location: "/contact?topic=call",
    });
  });

  it("returns null for hub paths, look-alikes and unknown paths", () => {
    for (const p of [
      "/",
      "/about",
      "/work",
      "/contact",
      "/privacy",
      "/unsubscribe",
      "/services-extra",
      "/services/web",
      "/nope",
      "",
      "//services",
    ]) {
      expect(oldUrlTarget(p, "GET"), p).toBeNull();
    }
  });

  it("never echoes the request into the location", () => {
    expect(oldUrlTarget("/admin/https://evil.example", "GET")).toEqual({
      status: 301,
      location: "/sign-in",
    });
    expect(oldUrlTarget("/services?next=//evil.example", "GET")).toBeNull();
  });
});
