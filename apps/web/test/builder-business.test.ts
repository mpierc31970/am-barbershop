// 08-08: the builder's business data (07-24) gains the published-services count (Services
// count line, UI-SPEC) and the public business email (Contact preset, D-UI-P8-8). Only those
// public fields are added (T-08-08-05); a services read failure never breaks the builder.
import { Forbidden } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getBusinessProfile: vi.fn(),
  listServices: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const { builderBusiness } = await import("../lib/builder-business");

const CTX = { orgId: "o1" } as never;

function profile(over: Record<string, unknown> = {}) {
  return {
    id: "bp1",
    orgName: "Rivera Wellness",
    phone: "555-0100",
    public_email: "hello@rivera.test",
    address: null,
    hours: null,
    socials: [{ platform: "instagram", url: "https://instagram.com/rivera" }],
    business_type: "massage",
    ...over,
  };
}

function services(total: number, published: number) {
  return Array.from({ length: total }, (_, i) => ({
    id: `svc${i}`,
    name: `Service ${i}`,
    is_published: i < published,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.getBusinessProfile.mockResolvedValue(profile());
  db.listServices.mockResolvedValue(services(12, 9));
});

describe("builderBusiness", () => {
  it("counts published services and passes the public email", async () => {
    const out = await builderBusiness(CTX);
    expect(out).toEqual({
      name: "Rivera Wellness",
      phone: "555-0100",
      addressText: "",
      hasHours: false,
      socials: [{ platform: "instagram", url: "https://instagram.com/rivera" }],
      businessType: "massage",
      publishedServices: 9,
      email: "hello@rivera.test",
    });
    expect(db.listServices).toHaveBeenCalledWith(CTX);
  });

  it("a services read failure keeps the profile fields, count undefined", async () => {
    db.listServices.mockRejectedValue(new Error("pb down"));
    const out = await builderBusiness(CTX);
    expect(out?.name).toBe("Rivera Wellness");
    expect(out?.email).toBe("hello@rivera.test");
    expect(out?.publishedServices).toBeUndefined();
    expect(out).not.toHaveProperty("publishedServices");
    expect(console.error).toHaveBeenCalledWith(
      "[hub] builder services count failed",
      expect.any(Error),
    );
  });

  it("Forbidden on the profile: null, nothing logged", async () => {
    db.getBusinessProfile.mockRejectedValue(new Forbidden());
    expect(await builderBusiness(CTX)).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("an empty or blank public email adds no email key", async () => {
    db.getBusinessProfile.mockResolvedValue(profile({ public_email: "  " }));
    const out = await builderBusiness(CTX);
    expect(out).not.toHaveProperty("email");
  });

  it("trims the email", async () => {
    db.getBusinessProfile.mockResolvedValue(
      profile({ public_email: " hello@rivera.test " }),
    );
    expect((await builderBusiness(CTX))?.email).toBe("hello@rivera.test");
  });
});
