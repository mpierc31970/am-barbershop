// 14-12 (DOM-05; P14-P10, P14-P22, T-14-12-03): RDAP + DoH DS against an injected fetch.
// No network: an unmatched URL fails the test.
import { describe, expect, it } from "vitest";
import { RDAP_BOOTSTRAP_URL, rdapRegistryLookup } from "./rdap";

const BOOTSTRAP = {
  version: "1.0",
  services: [
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
    [
      ["org"],
      [
        "http://rdap.example.org/",
        "https://rdap.publicinterestregistry.org/rdap",
      ],
    ],
  ],
};

// verisign-shaped (RESEARCH "RDAP", verified live shape)
const RDAP_COM = {
  objectClassName: "domain",
  ldhName: "RIVERA-BAKERY.COM",
  entities: [
    {
      objectClassName: "entity",
      roles: ["registrar"],
      vcardArray: [
        "vcard",
        [
          ["version", {}, "text", "4.0"],
          ["fn", {}, "text", "GoDaddy.com, LLC"],
        ],
      ],
    },
  ],
  events: [
    { eventAction: "registration", eventDate: "2019-02-01T10:00:00Z" },
    { eventAction: "expiration", eventDate: "2027-02-01T10:00:00Z" },
  ],
  secureDNS: { delegationSigned: false },
};

type Route = { status: number; body?: unknown };

function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; accept: string | null }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, accept: headers.get("accept") });
    const r = routes[url];
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
    });
  }) as typeof fetch;
  return { f, calls };
}

const COM = "https://rdap.verisign.com/com/v1/domain/";
const CF_DOH = "https://cloudflare-dns.com/dns-query?name=";
const G_DOH = "https://dns.google/resolve?name=";

describe("rdapRegistryLookup (choice 3)", () => {
  it("parses registrar, expiry and delegationSigned false", async () => {
    const { f, calls } = fakeFetch({
      [RDAP_BOOTSTRAP_URL]: { status: 200, body: BOOTSTRAP },
      [`${COM}rivera-bakery.com`]: { status: 200, body: RDAP_COM },
    });
    const info = await rdapRegistryLookup({ fetch: f }).lookup(
      "Rivera-Bakery.com.",
    );
    expect(info).toEqual({
      found: true,
      registrar: "GoDaddy.com, LLC",
      expiresAt: "2027-02-01T10:00:00.000Z",
      dnssec: false,
    });
    expect(calls[1]?.accept).toBe("application/rdap+json");
    expect(calls.some((c) => c.url.includes("dns-query"))).toBe(false);
  });

  it("404 -> found false", async () => {
    const { f } = fakeFetch({
      [RDAP_BOOTSTRAP_URL]: { status: 200, body: BOOTSTRAP },
      [`${COM}nobody-owns-this.com`]: { status: 404 },
    });
    expect(
      await rdapRegistryLookup({ fetch: f }).lookup("nobody-owns-this.com"),
    ).toEqual({
      found: false,
      registrar: null,
      expiresAt: null,
      dnssec: null,
    });
  });

  it("no secureDNS -> DoH DS: Answer type 43 -> dnssec true", async () => {
    const { secureDNS: _drop, ...noSecure } = RDAP_COM;
    void _drop;
    const { f, calls } = fakeFetch({
      [RDAP_BOOTSTRAP_URL]: { status: 200, body: BOOTSTRAP },
      [`${COM}signed.com`]: { status: 200, body: noSecure },
      [`${CF_DOH}signed.com&type=DS`]: {
        status: 200,
        body: {
          Status: 0,
          Answer: [{ name: "signed.com.", type: 43, data: "2371 13 2 abcd" }],
        },
      },
    });
    const info = await rdapRegistryLookup({ fetch: f }).lookup("signed.com");
    expect(info.dnssec).toBe(true);
    expect(info.registrar).toBe("GoDaddy.com, LLC");
    expect(calls.at(-1)?.accept).toBe("application/dns-json");
  });

  it("DoH: Status 0 without DS -> false; cloudflare failing falls back to dns.google; both failing -> null", async () => {
    const { f } = fakeFetch({
      [RDAP_BOOTSTRAP_URL]: { status: 200, body: BOOTSTRAP },
      [`${COM}plain.com`]: { status: 503 },
      [`${CF_DOH}plain.com&type=DS`]: { status: 500 },
      [`${G_DOH}plain.com&type=DS`]: { status: 200, body: { Status: 0 } },
      [`${COM}dark.com`]: { status: 503 },
      [`${CF_DOH}dark.com&type=DS`]: { status: 500 },
      [`${G_DOH}dark.com&type=DS`]: { status: 200, body: { Status: 2 } },
    });
    const lookup = rdapRegistryLookup({ fetch: f });
    // RDAP failing is never "not registered".
    expect(await lookup.lookup("plain.com")).toEqual({
      found: true,
      registrar: null,
      expiresAt: null,
      dnssec: false,
    });
    expect((await lookup.lookup("dark.com")).dnssec).toBeNull();
  });

  it("TLD missing from the bootstrap -> registrar null, DS via DoH", async () => {
    const { f, calls } = fakeFetch({
      [RDAP_BOOTSTRAP_URL]: { status: 200, body: BOOTSTRAP },
      [`${CF_DOH}shop.example.io&type=DS`]: {
        status: 200,
        body: { Status: 0, Answer: [] },
      },
    });
    const info = await rdapRegistryLookup({ fetch: f }).lookup(
      "shop.example.io",
    );
    expect(info).toEqual({
      found: true,
      registrar: null,
      expiresAt: null,
      dnssec: false,
    });
    expect(calls.map((c) => c.url)).toEqual([
      RDAP_BOOTSTRAP_URL,
      `${CF_DOH}shop.example.io&type=DS`,
    ]);
  });

  it("uses only https base URLs from the bootstrap", async () => {
    const { f } = fakeFetch({
      [RDAP_BOOTSTRAP_URL]: { status: 200, body: BOOTSTRAP },
      ["https://rdap.publicinterestregistry.org/rdap/domain/charity.org"]: {
        status: 200,
        body: RDAP_COM,
      },
    });
    expect(
      (await rdapRegistryLookup({ fetch: f }).lookup("charity.org")).found,
    ).toBe(true);
  });

  it("fetches the bootstrap once within 24 h, again after", async () => {
    const { f, calls } = fakeFetch({
      [RDAP_BOOTSTRAP_URL]: { status: 200, body: BOOTSTRAP },
      [`${COM}rivera-bakery.com`]: { status: 200, body: RDAP_COM },
    });
    let t = Date.parse("2026-10-17T00:00:00Z");
    const lookup = rdapRegistryLookup({ fetch: f, now: () => new Date(t) });
    await lookup.lookup("rivera-bakery.com");
    t += 23 * 60 * 60 * 1000;
    await lookup.lookup("rivera-bakery.com");
    const boots = () =>
      calls.filter((c) => c.url === RDAP_BOOTSTRAP_URL).length;
    expect(boots()).toBe(1);
    t += 2 * 60 * 60 * 1000;
    await lookup.lookup("rivera-bakery.com");
    expect(boots()).toBe(2);
  });
});
