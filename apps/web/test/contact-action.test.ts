// 15-19 Task 1: submitContactAction (HUB-07, HUB-03; A3-Q2; T-15-19-01, -02, -04).
// next/headers and @cds/db are mocked. Since WR-B07 the rate limit and the Turnstile check run
// inside createHubInquiry (proven in packages/db/src/hub-inquiries.test.ts); here the action
// passes the IP and the token through and maps RateLimited / InvalidInput to the copy.
import { InvalidInput, RateLimited } from "@cds/core";
import { MK_COPY } from "@cds/core/marketing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({ ip: "203.0.113.9" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": req.ip }),
  cookies: async () => ({ get: () => undefined }),
}));

const db = vi.hoisted(() => ({
  createHubInquiry: vi.fn(),
}));
vi.mock("@cds/db", () => ({
  createHubInquiry: db.createHubInquiry,
}));

const { submitContactAction } = await import("../app/actions/contact");
const { INITIAL_CONTACT_STATE, CONTACT_FIELD_IDS } =
  await import("../lib/contact-form");

const C = MK_COPY.CONTACT;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const QUESTION = {
  name: "  Ana Reyes ",
  email: "  Ana@Example.com ",
  business: " Reyes Studio ",
  topic: "question",
  phone: "555 0100",
  about: "builder-pro",
  message: "  How long does a first build take?  ",
  "cf-turnstile-response": "tok",
};

beforeEach(() => {
  req.ip = "203.0.113.9";
  db.createHubInquiry.mockReset();
  db.createHubInquiry.mockResolvedValue({ id: "inq1", staffNotified: true });
});

describe("submitContactAction", () => {
  it("a valid question calls createHubInquiry once, trimmed, with the phone dropped", async () => {
    const res = await submitContactAction(
      INITIAL_CONTACT_STATE,
      form(QUESTION),
    );
    expect(res).toEqual({
      status: "sent",
      email: "ana@example.com",
      isCall: false,
    });
    expect(db.createHubInquiry).toHaveBeenCalledTimes(1);
    expect(db.createHubInquiry).toHaveBeenCalledWith({
      name: "Ana Reyes",
      email: "ana@example.com",
      business: "Reyes Studio",
      topic: "question",
      phone: "",
      about: "builder-pro",
      message: "How long does a first build take?",
      ip: "203.0.113.9",
      humanToken: "tok",
    });
  });

  it("the call topic keeps the phone and says so in the sent state", async () => {
    const res = await submitContactAction(
      INITIAL_CONTACT_STATE,
      form({ ...QUESTION, topic: "call" }),
    );
    expect(res).toEqual({
      status: "sent",
      email: "ana@example.com",
      isCall: true,
    });
    expect(db.createHubInquiry.mock.calls[0]![0].phone).toBe("555 0100");
  });

  it("returns the UI-SPEC field errors, keeps every value and writes nothing", async () => {
    const bad = {
      ...QUESTION,
      name: " ",
      email: "nope",
      topic: "spam",
      message: "too short",
    };
    const res = await submitContactAction(INITIAL_CONTACT_STATE, form(bad));
    expect(res.status).toBe("idle");
    if (res.status !== "idle") return;
    expect(res.fieldErrors).toEqual({
      name: C.ERR_NAME,
      email: C.ERR_EMAIL,
      topic: C.ERR_TOPIC,
      message: C.ERR_MESSAGE_SHORT,
    });
    expect(res.values.message).toBe("too short");
    expect(res.values.email).toBe("nope");
    expect(db.createHubInquiry).not.toHaveBeenCalled();
    expect(CONTACT_FIELD_IDS.topic).toBe("contact-topic");
  });

  it("WR-A03: an address the repository would refuse is an inline Email error, before Turnstile", async () => {
    for (const email of ["a@b.c", "jo..e@x.com", "me@my_site.com", "x@y.123"]) {
      const res = await submitContactAction(
        INITIAL_CONTACT_STATE,
        form({ ...QUESTION, email }),
      );
      expect(res.status, email).toBe("idle");
      if (res.status !== "idle") continue;
      expect(res.fieldErrors, email).toEqual({ email: C.ERR_EMAIL });
      expect(res.error, email).toBeNull();
    }
    expect(db.createHubInquiry).not.toHaveBeenCalled();
  });

  it("a message over 2,000 characters is the long-message error", async () => {
    const res = await submitContactAction(
      INITIAL_CONTACT_STATE,
      form({ ...QUESTION, message: "x".repeat(2001) }),
    );
    expect(res.status === "idle" && res.fieldErrors.message).toBe(
      C.ERR_MESSAGE_LONG,
    );
  });

  it("RateLimited from the repository is the rate copy, values kept", async () => {
    db.createHubInquiry.mockRejectedValueOnce(new RateLimited("full"));
    const res = await submitContactAction(
      INITIAL_CONTACT_STATE,
      form(QUESTION),
    );
    expect(res.status === "idle" && res.error).toBe(C.ERR_RATE);
    expect(res.status === "idle" && res.values.message).toBe(QUESTION.message);
  });

  it("a failed Turnstile check (InvalidInput with the bot copy) returns the bot copy", async () => {
    db.createHubInquiry.mockRejectedValueOnce(
      new InvalidInput(C.ERR_TURNSTILE),
    );
    const res = await submitContactAction(
      INITIAL_CONTACT_STATE,
      form({ ...QUESTION, "cf-turnstile-response": "  bad  " }),
    );
    expect(res.status === "idle" && res.error).toBe(C.ERR_TURNSTILE);
    expect(db.createHubInquiry.mock.calls[0]![0].humanToken).toBe("bad");
  });

  it("WR-B07: the action no longer runs the gates itself (they live in createHubInquiry)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../app/actions/contact.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/beginContactAction|getHumanCheck/);
  });

  it("InvalidInput shows its message; other errors show the server copy, keep values, log the class name only", async () => {
    db.createHubInquiry.mockRejectedValueOnce(
      new InvalidInput("name must be one line"),
    );
    const a = await submitContactAction(INITIAL_CONTACT_STATE, form(QUESTION));
    expect(a.status === "idle" && a.error).toBe("name must be one line");

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      db.createHubInquiry.mockRejectedValueOnce(
        new TypeError("ana@example.com How long does a first build take?"),
      );
      const b = await submitContactAction(
        INITIAL_CONTACT_STATE,
        form(QUESTION),
      );
      expect(b.status).toBe("idle");
      if (b.status !== "idle") return;
      expect(b.error).toBe(C.ERR_SERVER);
      expect(b.values.message).toBe(QUESTION.message);
      expect(b.values.name).toBe(QUESTION.name);
      const logged = spy.mock.calls.flat().join(" ");
      expect(logged).toContain("TypeError");
      expect(logged).not.toContain("example.com");
      expect(logged).not.toContain("build");
      expect(logged).not.toContain("203.0.113");
    } finally {
      spy.mockRestore();
    }
  });
});
