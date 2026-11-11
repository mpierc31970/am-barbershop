// DOM-05: registrar list, step texts (D-UI-P14-8) and registrar-only services (G5).
import { describe, expect, it } from "vitest";
import {
  godaddyParking,
  googleWorkspace,
  namecheapForwarding,
} from "./__fixtures__/zones";
import {
  REGISTRAR_STEP_KINDS,
  REGISTRARS,
  registrarFromRdapName,
  registrarOnlyServices,
  registrarRecordsNotCopied,
  registrarSteps,
} from "./registrar";

describe("REGISTRARS", () => {
  it("lists the UI-SPEC registrars in order, Another registrar last", () => {
    expect(REGISTRARS.map((r) => r.id)).toEqual([
      "godaddy",
      "namecheap",
      "hostinger",
      "squarespace",
      "ionos",
      "porkbun",
      "other",
    ]);
    expect(REGISTRARS.find((r) => r.id === "squarespace")?.name).toBe(
      "Squarespace (was Google Domains)",
    );
  });
});

describe("registrarFromRdapName", () => {
  it.each([
    ["GoDaddy.com, LLC", "godaddy"],
    ["NameCheap, Inc.", "namecheap"],
    ["HOSTINGER operations, UAB", "hostinger"],
    ["Squarespace Domains II LLC", "squarespace"],
    ["Google LLC", "squarespace"],
    ["IONOS SE", "ionos"],
    ["1&1 Internet SE", "ionos"],
    ["Porkbun LLC", "porkbun"],
    ["Tucows Domains Inc.", "other"],
    [null, "other"],
  ] as const)("%s -> %s", (name, id) => {
    expect(registrarFromRdapName(name)).toBe(id);
  });
});

describe("registrarSteps", () => {
  it("gives 3-5 steps for every registrar and kind", () => {
    for (const kind of REGISTRAR_STEP_KINDS) {
      for (const r of REGISTRARS) {
        const steps = registrarSteps(kind, r.id);
        expect(steps.length).toBeGreaterThanOrEqual(3);
        expect(steps.length).toBeLessThanOrEqual(5);
        for (const s of steps) expect(s.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("ends every nameserver list with the same line", () => {
    for (const r of REGISTRARS) {
      expect(registrarSteps("nameservers", r.id).at(-1)).toBe(
        "Save. You're done there.",
      );
    }
  });

  it("uses the UI-SPEC copy for another registrar's zone export", () => {
    expect(registrarSteps("zone_export", "other")).toContain(
      "Look for **Export zone file**, **Download DNS records** or **Export BIND** in your registrar's DNS settings.",
    );
  });
});

describe("registrarOnlyServices", () => {
  it("finds Namecheap email forwarding", () => {
    const s = registrarOnlyServices(namecheapForwarding.records, "other");
    expect(s.map((x) => [x.kind, x.registrar])).toEqual([
      ["email_forwarding", "namecheap"],
    ]);
    expect(s[0]?.records).toHaveLength(2);
  });

  it("finds GoDaddy parking", () => {
    const s = registrarOnlyServices(godaddyParking.records, "godaddy");
    expect(s.map((x) => [x.kind, x.registrar])).toEqual([
      ["parking", "godaddy"],
    ]);
  });

  it("finds GoDaddy forwarding A and MX only when the registrar is GoDaddy", () => {
    const rs = [
      { type: "A" as const, name: "g.example", value: "3.33.152.147" },
      {
        type: "MX" as const,
        name: "g.example",
        value: "mailstore1.secureserver.net",
        priority: 0,
      },
    ];
    expect(registrarOnlyServices(rs, "godaddy").map((x) => x.kind)).toEqual([
      "email_forwarding",
      "web_forwarding",
    ]);
    expect(registrarOnlyServices(rs, "other").map((x) => x.kind)).toEqual([
      "web_forwarding",
    ]);
  });

  it("does not call GoDaddy mailboxes forwarding (CR-B01)", () => {
    const rs = [
      {
        type: "MX" as const,
        name: "g.example",
        value: "mailstore1.secureserver.net",
        priority: 10,
      },
      {
        type: "TXT" as const,
        name: "g.example",
        value: "v=spf1 include:secureserver.net -all",
      },
      {
        type: "CNAME" as const,
        name: "autodiscover.g.example",
        value: "autodiscover.secureserver.net",
      },
    ];
    expect(registrarOnlyServices(rs, "godaddy")).toEqual([]);
    expect(registrarOnlyServices(rs, "other")).toEqual([]);
  });

  it("never excludes email forwarding MX from the copy (CR-B01)", () => {
    const fwd = registrarOnlyServices(namecheapForwarding.records, "other");
    expect(fwd.map((x) => x.kind)).toEqual(["email_forwarding"]);
    expect(
      registrarRecordsNotCopied(namecheapForwarding.records, "other").size,
    ).toBe(0);
    const parked = registrarRecordsNotCopied(godaddyParking.records, "godaddy");
    expect(parked.size).toBeGreaterThan(0);
  });

  it("finds Namecheap and Hostinger parking", () => {
    expect(
      registrarOnlyServices(
        [{ type: "A", name: "n.example", value: "192.64.119.33" }],
        "other",
      ).map((x) => [x.kind, x.registrar]),
    ).toEqual([["parking", "namecheap"]]);
    expect(
      registrarOnlyServices(
        [
          {
            type: "CNAME",
            name: "www.h.example",
            value: "h.example.cdn.dns-parking.com",
          },
        ],
        "other",
      ).map((x) => [x.kind, x.registrar]),
    ).toEqual([["parking", "hostinger"]]);
  });

  it("finds nothing in a normal Google Workspace zone", () => {
    expect(registrarOnlyServices(googleWorkspace.records, "godaddy")).toEqual(
      [],
    );
  });
});
