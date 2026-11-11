// 15 review WR-B07: createHubInquiry runs its own gates (fields, the per-IP contact slot, the
// Turnstile check) before it writes, so a second caller cannot skip either. The PocketBase
// client is mocked: no database, no network (the human check is injected).
import { InvalidInput, RateLimited } from "@cds/core";
import { MK_COPY } from "@cds/core/marketing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pb = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./client", () => ({
  withSuperuser: async (fn: (client: unknown) => unknown) =>
    fn({ collection: () => ({ create: pb.create }) }),
}));

const { createHubInquiry } = await import("./hub-inquiries");
const { resetContactLimitsForTests } = await import("./rate-limit");

const IP = "203.0.113.9";
const input = (over: Record<string, unknown> = {}) => ({
  name: "Dana Rivera",
  email: "dana@example.com",
  topic: "question" as const,
  message: "How long does a first build take?",
  ip: IP,
  humanToken: "tok",
  ...over,
});

const verify = vi.fn<(token: string, ip: string) => Promise<boolean>>();
const send = vi.fn();
const deps = () => ({ humanCheck: { verify }, send });

beforeEach(() => {
  resetContactLimitsForTests();
  pb.create.mockReset();
  pb.create.mockResolvedValue({ id: "inq1" });
  verify.mockReset();
  verify.mockResolvedValue(true);
  send.mockReset();
  send.mockResolvedValue({ status: "logged" });
  vi.stubEnv("CDS_STAFF_ALERT_EMAIL", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("createHubInquiry gates (WR-B07)", () => {
  it("checks the Turnstile token with the client IP, then writes", async () => {
    const r = await createHubInquiry(input(), deps());
    expect(r.id).toBe("inq1");
    expect(verify).toHaveBeenCalledWith("tok", IP);
    expect(pb.create).toHaveBeenCalledTimes(1);
  });

  it("5 messages from one IP pass, the 6th is RateLimited before Turnstile or a write", async () => {
    for (let i = 0; i < 5; i++) await createHubInquiry(input(), deps());
    await expect(createHubInquiry(input(), deps())).rejects.toBeInstanceOf(
      RateLimited,
    );
    expect(verify).toHaveBeenCalledTimes(5);
    expect(pb.create).toHaveBeenCalledTimes(5);
    await expect(
      createHubInquiry(input({ ip: "198.51.100.7" }), deps()),
    ).resolves.toMatchObject({ id: "inq1" });
  });

  it("a failed Turnstile check is InvalidInput with the bot copy and never writes", async () => {
    verify.mockResolvedValue(false);
    const err = await createHubInquiry(input(), deps()).catch((e) => e);
    expect(err).toBeInstanceOf(InvalidInput);
    expect((err as Error).message).toBe(MK_COPY.CONTACT.ERR_TURNSTILE);
    expect(pb.create).not.toHaveBeenCalled();
  });

  it("a throwing check fails closed", async () => {
    verify.mockRejectedValue(new Error("network"));
    await expect(createHubInquiry(input(), deps())).rejects.toBeInstanceOf(
      InvalidInput,
    );
    expect(pb.create).not.toHaveBeenCalled();
  });

  it("a missing token reaches the check as empty (Turnstile refuses it)", async () => {
    verify.mockImplementation(async (token) => token !== "");
    await expect(
      createHubInquiry(input({ humanToken: undefined }), deps()),
    ).rejects.toBeInstanceOf(InvalidInput);
    expect(verify).toHaveBeenCalledWith("", IP);
  });

  it("invalid fields fail before the slot is taken", async () => {
    for (let i = 0; i < 6; i++) {
      await expect(
        createHubInquiry(input({ email: "nope" }), deps()),
      ).rejects.toBeInstanceOf(InvalidInput);
    }
    expect(verify).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) await createHubInquiry(input(), deps());
    expect(pb.create).toHaveBeenCalledTimes(5);
  });

  it("stores no IP field (WR-B06)", async () => {
    await createHubInquiry(input(), deps());
    const row = pb.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(row)).not.toContain("ip_bucket");
    expect(JSON.stringify(row)).not.toContain(IP);
  });
});
