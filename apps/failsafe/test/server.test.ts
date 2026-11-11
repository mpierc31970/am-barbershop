import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFailsafeServer, loadRouting } from "../src/server.ts";
import type { RoutingEntry } from "../src/server.ts";
import { loggingMail } from "../src/mail.ts";
import { openStore } from "../src/store.ts";
import { signAck, signPull } from "../src/pull.ts";
import { loadKey, seal } from "../src/crypto.ts";

const KEY = randomBytes(32).toString("base64");
const SECRET = "pull-secret-for-tests";
const ROUTING: RoutingEntry[] = [
  {
    orgSlug: "bellas-salon",
    addon: "studio-booking",
    businessName: "Bella's <Salon>",
    ownerEmail: "owner@bellas.example",
    staffEmail: "staff@cds.example",
  },
];

let dir: string;
let server: Server;
let base: string;
let logs: string[];

async function start(): Promise<void> {
  server = createFailsafeServer({
    dataDir: dir,
    dataKey: KEY,
    pullSecret: SECRET,
    routing: ROUTING,
    mail: loggingMail((l) => logs.push(l)),
    log: (l) => logs.push(l),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "failsafe-server-"));
  logs = [];
  await start();
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

const FORM = "/r/bellas-salon/studio-booking";

function post(body: Record<string, string>): Promise<Response> {
  return fetch(base + FORM, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

function pull(body: unknown): Promise<Response> {
  return fetch(`${base}/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = {
  name: "Rosa Diaz",
  email: "rosa.diaz@example.com",
  phone: "555 0100",
  preferred: "Friday morning",
  message: "Cut and colour",
  website: "",
};

function storedLines(): number {
  try {
    return readFileSync(join(dir, "requests.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "").length;
  } catch {
    return 0;
  }
}

describe("failsafe server", () => {
  it("serves the form for a routed site and 404 elsewhere", async () => {
    const res = await fetch(base + FORM);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("<form");
    expect(html).toContain('name="website"');
    expect(html).toContain("Bella&#39;s &lt;Salon&gt;");
    expect(html).not.toContain("<Salon>");

    expect((await fetch(`${base}/r/other/studio-booking`)).status).toBe(404);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(404);
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");
  });

  it("stores one encrypted line for a valid POST and logs mail by hash only", async () => {
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Request received");
    expect(storedLines()).toBe(1);
    expect(readFileSync(join(dir, "requests.jsonl"), "utf8")).not.toContain(
      "Rosa",
    );

    const mailLines = logs.filter((l) => l.startsWith("[failsafe-mail]"));
    expect(mailLines).toHaveLength(2);
    const all = logs.join("\n");
    expect(all).not.toContain("@");
    expect(all).not.toContain("Rosa");
  });

  it("a filled honeypot stores nothing but still answers 200", async () => {
    const res = await post({ ...VALID, website: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Request received");
    expect(storedLines()).toBe(0);
    expect(logs.filter((l) => l.startsWith("[failsafe-mail]"))).toHaveLength(0);
  });

  it("re-renders an invalid POST with every value escaped", async () => {
    const res = await post({
      ...VALID,
      name: '"><script>alert(1)</script>',
      email: "not-an-email",
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("valid email");
    expect(storedLines()).toBe(0);
  });

  it("answers 429 on the 6th POST from one IP inside 10 minutes", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post(VALID)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    expect(storedLines()).toBe(5);
  });

  it("serves a signed pull and acks; a bad signature is 404", async () => {
    await post(VALID);
    const since = "2000-01-01T00:00:00.000Z";
    const ts = Date.now();
    const sig = signPull(SECRET, since, ts);
    const res = await pull({ since, ts, sig });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      requests: { id: string; name: string; email: string }[];
      corrupt: number;
    };
    expect(body.corrupt).toBe(0);
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).toMatchObject({
      name: "Rosa Diaz",
      email: "rosa.diaz@example.com",
      orgSlug: "bellas-salon",
      addon: "studio-booking",
    });

    expect((await pull({ since, ts, sig: "0".repeat(64) })).status).toBe(404);
    expect((await pull({})).status).toBe(404);
    // WR-B01: the old GET form (signature in the URL) is gone.
    const q = new URLSearchParams({ since, ts: String(ts), sig });
    expect((await fetch(`${base}/pull?${q}`)).status).toBe(404);

    const ids = [body.requests[0]!.id];
    const ackTs = Date.now();
    const badAck = await fetch(`${base}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, ts: ackTs, sig: "f".repeat(64) }),
    });
    expect(badAck.status).toBe(404);
    const ack = await fetch(`${base}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids,
        ts: ackTs,
        sig: signAck(SECRET, ids, ackTs),
      }),
    });
    expect(ack.status).toBe(200);
    expect(await ack.json()).toEqual({ acked: 1 });
  });

  it("WR-B01: a signed pull or ack is accepted once, never replayed", async () => {
    await post(VALID);
    const since = "";
    const ts = Date.now();
    const sig = signPull(SECRET, since, ts);
    const first = await pull({ since, ts, sig });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { requests: { id: string }[] };
    expect(body.requests).toHaveLength(1);
    expect((await pull({ since, ts, sig })).status).toBe(404);

    const ids = [body.requests[0]!.id];
    const ackBody = JSON.stringify({ ids, ts, sig: signAck(SECRET, ids, ts) });
    const ack = () =>
      fetch(`${base}/ack`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: ackBody,
      });
    expect((await ack()).status).toBe(200);
    expect((await ack()).status).toBe(404);
  });

  it("WR-B01: a since that does not parse is refused", async () => {
    const ts = Date.now();
    const since = "not-a-date";
    expect(
      (await pull({ since, ts, sig: signPull(SECRET, since, ts) })).status,
    ).toBe(404);
  });

  it("refuses pull when no secret is configured", async () => {
    await new Promise<void>((r) => server.close(() => r()));
    server = createFailsafeServer({
      dataDir: dir,
      dataKey: KEY,
      pullSecret: "",
      routing: ROUTING,
      mail: loggingMail(() => {}),
      log: () => {},
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const since = "2000-01-01T00:00:00.000Z";
    const ts = Date.now();
    expect(
      (await pull({ since, ts, sig: signPull("", since, ts) })).status,
    ).toBe(404);
  });

  it("WR-B02: requests never sweep; the timer does", async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const t0 = new Date("2026-10-01T00:00:00.000Z");
    let clock = t0;
    const seed = openStore({ dir, key: KEY, now: () => clock });
    const saved = seed.append({
      orgSlug: "bellas-salon",
      addon: "studio-booking",
      name: "A",
      email: "a@example.com",
      phone: "",
      preferred: "",
      message: "m",
    });
    seed.ack([saved.id]);
    server = createFailsafeServer({
      dataDir: dir,
      dataKey: KEY,
      pullSecret: SECRET,
      routing: ROUTING,
      mail: loggingMail(() => {}),
      log: (l) => logs.push(l),
      now: () => clock,
      sweepEveryMs: 200,
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect(storedLines()).toBe(1);
    clock = new Date(t0.getTime() + 40 * 24 * 60 * 60 * 1000);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect(storedLines()).toBe(1);
    await new Promise((r) => setTimeout(r, 400));
    expect(storedLines()).toBe(0);
    expect(logs).toContain("[failsafe] swept 1");
  });

  it("refuses to start with a bad data key", () => {
    expect(() =>
      createFailsafeServer({
        dataDir: dir,
        dataKey: randomBytes(31).toString("base64"),
        pullSecret: SECRET,
        routing: ROUTING,
      }),
    ).toThrow(/32 bytes/);
  });

  it("loads an encrypted routing file", () => {
    const file = join(dir, "routing.enc.json");
    writeFileSync(file, JSON.stringify(seal(loadKey(KEY), ROUTING)));
    expect(loadRouting(file, KEY)).toEqual(ROUTING);
    expect(readFileSync(file, "utf8")).not.toContain("owner@bellas.example");
    writeFileSync(file, JSON.stringify(seal(loadKey(KEY), [{ orgSlug: 1 }])));
    expect(() => loadRouting(file, KEY)).toThrow(/routing/);
  });
});
