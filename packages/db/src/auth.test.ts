// WR-B01: a PocketBase outage is not a sign-out. refreshUser maps only PB rejecting the
// token (401/403/404) to Forbidden; a 5xx or a network failure is rethrown as is, so the
// hub's "CdsError means signed out" rule no longer turns an outage into a sign-out.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CdsError, Forbidden } from "@cds/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listMemberOrganizations, platformContextFromToken } from "./auth";

const saved = { url: process.env.PB_URL, key: process.env.PB_APP_KEY };
let server: Server;
let base: string;

beforeAll(async () => {
  // A stub PB: the token names the status authRefresh answers with.
  server = createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    const status = Number(/status-(\d{3})/.exec(auth)?.[1] ?? "401");
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ status, message: "stub", data: {} }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.PB_URL = base;
  process.env.PB_APP_KEY = "stub-app-key";
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  if (saved.url === undefined) delete process.env.PB_URL;
  else process.env.PB_URL = saved.url;
  if (saved.key === undefined) delete process.env.PB_APP_KEY;
  else process.env.PB_APP_KEY = saved.key;
});

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

describe("refreshUser outage vs rejected token (WR-B01)", () => {
  it.each(["status-401", "status-403", "status-404"])(
    "a token PB rejects (%s) is an invalid session",
    async (token) => {
      expect(await caught(listMemberOrganizations(token))).toBeInstanceOf(
        Forbidden,
      );
      expect(
        await caught(platformContextFromToken(token, "127.0.0.1")),
      ).toBeInstanceOf(Forbidden);
    },
  );

  it.each(["status-500", "status-502", "status-503"])(
    "a PB server error (%s) is rethrown, not a sign-out",
    async (token) => {
      const err = await caught(listMemberOrganizations(token));
      expect(err).not.toBeInstanceOf(CdsError);
      expect((err as { status?: number }).status).toBe(Number(token.slice(-3)));
    },
  );

  it("an unreachable PB is rethrown, not a sign-out", async () => {
    process.env.PB_URL = "http://127.0.0.1:1";
    try {
      const err = await caught(listMemberOrganizations("status-401"));
      expect(err).not.toBeInstanceOf(CdsError);
    } finally {
      process.env.PB_URL = base;
    }
  });
});
