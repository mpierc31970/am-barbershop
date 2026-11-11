// Logged-not-sent stand-in and capture transport (EMAIL-01, CONTEXT A5-Q3, PD-17, T-06-24).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalDiskStore } from "../storage/local-disk";
import {
  captureTransport,
  getEmailTransport,
  loggingTransport,
  type RenderedEmail,
} from "./transport";

const ADDR = "maria@riverabakery.com";
const MSG: RenderedEmail = {
  type: "quote.saved",
  orgId: null,
  to: ADDR,
  fromName: "Connections Design Studios",
  fromAddress: "hello@send.cds.needtobeedgy.com",
  replyTo: null,
  subject: "Your website quote",
  preheader: "Standard website",
  html: "<p>SECRET-BODY-HTML</p>",
  text: "SECRET-BODY-TEXT",
  headers: {},
};
const AT = new Date("2026-09-28T10:11:12.000Z");

let dir = "";
let savedEnv: Record<string, string | undefined> = {};
const KEYS = ["CDS_ENV", "CDS_EMAIL_TRANSPORT"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cds-mail-"));
  savedEnv = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe("loggingTransport", () => {
  it("logs one line without the address or body and writes 3 dev/mail/ objects", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const store = new LocalDiskStore(dir);
    await loggingTransport({ store, now: () => AT }).send(MSG);
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]![0]);
    expect(line).toContain("[email-standin]");
    expect(line).toContain("quote.saved");
    expect(line).toContain(" cds ");
    expect(line).toMatch(/to=[0-9a-f]{12} /);
    expect(line).not.toContain(ADDR);
    expect(line).not.toContain("SECRET-BODY");
    const keys = (await store.list("dev/mail/")).map((o) => o.key);
    expect(keys).toEqual([
      "dev/mail/20260928T101112Z-quote.saved/headers.json",
      "dev/mail/20260928T101112Z-quote.saved/message.html",
      "dev/mail/20260928T101112Z-quote.saved/message.txt",
    ]);
    const html = new TextDecoder().decode(
      (await store.get(keys[1]!)) ?? new Uint8Array(),
    );
    expect(html).toContain("SECRET-BODY-HTML");
  });

  it("writes nothing to the store in production", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    process.env.CDS_ENV = "production";
    const store = new LocalDiskStore(dir);
    await loggingTransport({ store, now: () => AT }).send(MSG);
    expect(await store.list("")).toEqual([]);
  });

  it("strips CR/LF from the logged subject", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await loggingTransport().send({
      ...MSG,
      subject: "a\r\nBcc: x",
      orgId: "org1",
    });
    const line = String(info.mock.calls[0]![0]);
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain(" org1 ");
  });
});

describe("captureTransport / getEmailTransport", () => {
  it("captures sent messages", async () => {
    const t = captureTransport();
    await t.send(MSG);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.subject).toBe("Your website quote");
  });

  it("selects the logging stand-in by default and throws on an unknown value", () => {
    expect(getEmailTransport()).toBeTruthy();
    process.env.CDS_EMAIL_TRANSPORT = "log";
    expect(getEmailTransport()).toBeTruthy();
    process.env.CDS_EMAIL_TRANSPORT = "ses";
    expect(() => getEmailTransport()).toThrow(/CDS_EMAIL_TRANSPORT/);
  });
});
