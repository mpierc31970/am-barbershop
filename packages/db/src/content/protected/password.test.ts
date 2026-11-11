// Page password hashing (CONT-28; 07-32 choice 1; T-07-32-03, T-07-32-08).
import { InvalidInput } from "@cds/core";
import { describe, expect, it } from "vitest";
import { mintOrgContext } from "../../context";
import {
  PAGE_PASSWORD_COPY,
  PAGE_PASSWORD_MAX,
  PAGE_PASSWORD_MIN,
  hashPagePassword,
  setPagePassword,
  verifyPagePasswordHash,
} from "./password";

const HASH_RE = /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;

describe("page password hash", () => {
  it("hashes with scrypt N16384 r8 p1, a 16-byte salt and a 32-byte key", async () => {
    const a = await hashPagePassword("sourdough1");
    const b = await hashPagePassword("sourdough1");
    expect(a).toMatch(HASH_RE);
    expect(a).not.toBe(b);
    expect(await verifyPagePasswordHash(a, "sourdough1")).toBe(true);
    expect(await verifyPagePasswordHash(a, "sourdough2")).toBe(false);
    expect(await verifyPagePasswordHash(a, "")).toBe(false);
  });

  it("is false (never throws) on a malformed or unexpected stored hash", async () => {
    const good = await hashPagePassword("sourdough1");
    const parts = good.split("$");
    for (const bad of [
      "",
      null,
      42,
      "plain",
      good.replace("scrypt$", "bcrypt$"),
      [parts[0], "262144", ...parts.slice(2)].join("$"),
      [parts[0], "16000", ...parts.slice(2)].join("$"),
      [parts[0], parts[1], "9", ...parts.slice(3)].join("$"),
      [...parts.slice(0, 5), "short"].join("$"),
    ]) {
      expect(await verifyPagePasswordHash(bad, "sourdough1")).toBe(false);
    }
  });

  it("states the length rules", () => {
    expect(PAGE_PASSWORD_MIN).toBe(6);
    expect(PAGE_PASSWORD_MAX).toBe(128);
    expect(PAGE_PASSWORD_COPY.short).toBe("Use at least 6 characters.");
    expect(PAGE_PASSWORD_COPY.long).toBe("Use 128 characters or fewer.");
  });

  it("refuses short and long passwords before any lock or read", async () => {
    const ctx = mintOrgContext({
      orgId: "orgaaaaaaaaaaa1",
      actor: "useraaaaaaaaaa1",
      role: "owner",
      grants: [],
      ip: "",
    });
    const deps = {
      invalidator: { invalidate: () => undefined },
      sections: { get: () => undefined } as never,
    };
    const run = (password: unknown) =>
      setPagePassword(ctx, "pageaaaaaaaaaa1", { password } as never, deps);
    await expect(run("12345")).rejects.toThrow(PAGE_PASSWORD_COPY.short);
    await expect(run("x".repeat(129))).rejects.toThrow(PAGE_PASSWORD_COPY.long);
    await expect(run(5)).rejects.toThrow(InvalidInput);
    await expect(
      setPagePassword(ctx, "pageaaaaaaaaaa1", {} as never, deps),
    ).rejects.toThrow(InvalidInput);
  });
});
