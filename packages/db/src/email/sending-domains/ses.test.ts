// 14-24 Task 1 (ONB-10; T-14-24-03): the SES v2 adapter over recorded JSON shapes (never
// live) and the CDS_SENDING_DOMAINS factory modes.
import { afterEach, describe, expect, it } from "vitest";
import {
  getSendingDomains,
  resetSendingDomainsForTests,
  sendingDomainsMode,
  sendingDomainsRegion,
} from "./factory";
import { SendingDomainsError } from "./ports";
import { sesSendingDomains, sesStatusOf } from "./ses";

// Recorded shape of CreateEmailIdentity (SES v2 API reference), tokens fictitious.
const CREATE_JSON = {
  IdentityType: "DOMAIN",
  VerifiedForSendingStatus: false,
  DkimAttributes: {
    SigningEnabled: true,
    Status: "PENDING",
    Tokens: ["abcdefgh1234", "ijklmnop5678", "qrstuvwx9012"],
  },
};

const GET_JSON = (verified: boolean, status: string) => ({
  IdentityType: "DOMAIN",
  FeedbackForwardingStatus: true,
  VerifiedForSendingStatus: verified,
  DkimAttributes: {
    SigningEnabled: true,
    Status: status,
    Tokens: CREATE_JSON.DkimAttributes.Tokens,
  },
  MailFromAttributes: {
    MailFromDomain: "send.rivera.example",
    MailFromDomainStatus: "PENDING",
    BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
  },
});

type Call = {
  method: string;
  url: string;
  body: unknown;
  auth: string | null;
  signal: AbortSignal | undefined;
};

function recorder(responses: Response[]) {
  const calls: Call[] = [];
  const f: typeof fetch = async (input, init) => {
    const req = input as Request;
    const text = await req.text();
    calls.push({
      method: req.method,
      url: req.url,
      body: text ? JSON.parse(text) : undefined,
      auth: req.headers.get("authorization"),
      signal: init?.signal ?? undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error("no recorded response");
    return next;
  };
  return { calls, f };
}

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "content-type": "application/json" },
  });

function ses(f: typeof fetch) {
  return sesSendingDomains({
    region: "us-east-1",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret-example",
    fetch: f,
  });
}

describe("sesSendingDomains (14-24 choice 3)", () => {
  it("creates the identity, sets MAIL FROM send.<d> and returns three tokens", async () => {
    const { calls, f } = recorder([json(CREATE_JSON), json({})]);
    const r = await ses(f).createIdentity("Rivera.Example");
    expect(r).toEqual({
      dkimTokens: ["abcdefgh1234", "ijklmnop5678", "qrstuvwx9012"],
      mailFrom: "send.rivera.example",
    });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", "https://email.us-east-1.amazonaws.com/v2/email/identities"],
      [
        "PUT",
        "https://email.us-east-1.amazonaws.com/v2/email/identities/rivera.example/mail-from",
      ],
    ]);
    expect(calls[0]!.body).toEqual({ EmailIdentity: "rivera.example" });
    // WR-A10: every call carries a timeout signal.
    expect(calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
    expect(calls[1]!.body).toEqual({
      MailFromDomain: "send.rivera.example",
      BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
    });
    expect(calls[0]!.auth).toMatch(
      /^AWS4-HMAC-SHA256 .*\/us-east-1\/ses\/aws4_request/,
    );
  });

  it("reads tokens back when the identity already exists (409)", async () => {
    const { calls, f } = recorder([
      json({ message: "AlreadyExists" }, 409),
      json(GET_JSON(false, "PENDING")),
      json({}),
    ]);
    const r = await ses(f).createIdentity("rivera.example");
    expect(r.dkimTokens).toHaveLength(3);
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET", "PUT"]);
  });

  it("maps status: SUCCESS -> verified, PENDING -> pending, FAILED -> failed, 404 -> failed", async () => {
    const { f } = recorder([
      json(GET_JSON(true, "SUCCESS")),
      json(GET_JSON(false, "PENDING")),
      json(GET_JSON(false, "FAILED")),
      json({ message: "NotFound" }, 404),
    ]);
    const a = ses(f);
    expect(await a.status("rivera.example")).toBe("verified");
    expect(await a.status("rivera.example")).toBe("pending");
    expect(await a.status("rivera.example")).toBe("failed");
    expect(await a.status("rivera.example")).toBe("failed");
    expect(
      sesStatusOf({
        VerifiedForSendingStatus: false,
        DkimAttributes: { Status: "SUCCESS" },
      }),
    ).toBe("pending");
  });

  it("deletes (404 is fine) and errors carry the status only", async () => {
    const { calls, f } = recorder([
      new Response(null, { status: 200 }),
      json({}, 404),
      json({ message: "secret detail rivera.example" }, 500),
    ]);
    const a = ses(f);
    await a.deleteIdentity("rivera.example");
    await a.deleteIdentity("rivera.example");
    const err = await a
      .deleteIdentity("rivera.example")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SendingDomainsError);
    expect((err as Error).message).toBe("ses_delete_500");
    expect(calls.every((c) => c.method === "DELETE")).toBe(true);
  });

  it("refuses a malformed domain before any call", async () => {
    const { calls, f } = recorder([]);
    await expect(ses(f).createIdentity("../x")).rejects.toThrow(
      "invalid_domain",
    );
    expect(calls).toHaveLength(0);
  });
});

const KEYS = [
  "CDS_ENV",
  "CDS_SENDING_DOMAINS",
  "AWS_SES_REGION",
  "AWS_SES_ACCESS_KEY_ID",
  "AWS_SES_SECRET_ACCESS_KEY",
] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetSendingDomainsForTests();
});

function clear() {
  for (const k of KEYS) delete process.env[k];
}

describe("sendingDomainsMode (14-24 choice 1)", () => {
  it("unset: fake outside production, closed in production", () => {
    clear();
    expect(sendingDomainsMode()).toBe("fake");
    expect(getSendingDomains().name).toBe("fake");
    process.env.CDS_ENV = "production";
    expect(sendingDomainsMode()).toBe("closed");
    expect(() => getSendingDomains()).toThrow(/closed/);
  });

  it("ses without env throws naming the variables; with env builds ses", () => {
    clear();
    process.env.CDS_SENDING_DOMAINS = "ses";
    expect(() => sendingDomainsMode()).toThrow(/AWS_SES_REGION/);
    process.env.AWS_SES_REGION = "eu-west-1";
    process.env.AWS_SES_ACCESS_KEY_ID = "AKIDEXAMPLE";
    expect(() => sendingDomainsMode()).toThrow(
      /missing: AWS_SES_SECRET_ACCESS_KEY/,
    );
    process.env.AWS_SES_SECRET_ACCESS_KEY = "x";
    expect(sendingDomainsMode()).toBe("ses");
    expect(getSendingDomains().name).toBe("ses");
    expect(sendingDomainsRegion()).toBe("eu-west-1");
  });

  it("unknown values throw", () => {
    clear();
    process.env.CDS_SENDING_DOMAINS = "x";
    expect(() => sendingDomainsMode()).toThrow(/CDS_SENDING_DOMAINS/);
  });

  it("region defaults to us-east-1 when unset or malformed", () => {
    clear();
    expect(sendingDomainsRegion()).toBe("us-east-1");
    process.env.AWS_SES_REGION = "not a region";
    expect(sendingDomainsRegion()).toBe("us-east-1");
  });
});
