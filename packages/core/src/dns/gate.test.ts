// DOM-05: the zone gate G1-G7 (14-CONTEXT "The gate"; hard blocks G1-email, G3, G6).
import { describe, expect, it } from "vitest";
import {
  big195,
  dnssecOn,
  googleWorkspace,
  microsoft365,
  namecheapForwarding,
  twoSpf,
  type FixtureZone,
} from "./__fixtures__/zones";
import { HARD_BLOCKS, MAX_GATE_RECORDS, zoneGate, type GateRule } from "./gate";
import { recordKey, type DnsRecord } from "./record";

const NOW = new Date("2026-10-16T12:00:00Z");
const HOUR = 3600_000;

/** The copy a provider would hold: everything but SOA and apex NS. */
const copyOf = (z: FixtureZone): DnsRecord[] =>
  z.records.filter(
    (r) => r.type !== "SOA" && !(r.type === "NS" && r.name === z.domain),
  );

const run = (
  z: FixtureZone,
  o: {
    copy?: DnsRecord[];
    takenAt?: Date;
    dnssec?: boolean | null;
    zoneFileUploaded?: boolean;
    acks?: string[];
    overrides?: GateRule[];
    snapshot?: DnsRecord[];
  } = {},
) =>
  zoneGate({
    domain: z.domain,
    snapshot: o.snapshot ?? z.records,
    copy: o.copy ?? copyOf(z),
    takenAt: o.takenAt ?? new Date(NOW.getTime() - HOUR),
    now: NOW,
    dnssec: o.dnssec === undefined ? z.dnssec : o.dnssec,
    zoneFileUploaded: o.zoneFileUploaded ?? false,
    acks: new Set(o.acks ?? []),
    overrides: new Set(o.overrides ?? []),
  });

const f = (res: ReturnType<typeof zoneGate>, rule: GateRule) =>
  res.findings.find((x) => x.rule === rule)!;

describe("zoneGate", () => {
  it("returns one finding per rule, in order", () => {
    const res = run(googleWorkspace);
    expect(res.findings.map((x) => x.rule)).toEqual([
      "G1",
      "G2",
      "G3",
      "G4",
      "G5",
      "G6",
      "G7",
    ]);
    expect(HARD_BLOCKS).toEqual(["G1", "G3", "G6"]);
  });

  it("identical copy passes", () => {
    const res = run(googleWorkspace);
    expect(res.passed).toBe(true);
    expect(res.hardBlocked).toBe(false);
    expect(res.tooManyRecords).toBe(false);
    expect(res.findings.every((x) => x.pass)).toBe(true);
  });

  it("copy differing only in TTL, case, trailing dot and TXT chunking still passes", () => {
    const copy = copyOf(googleWorkspace).map((r) => ({
      ...r,
      ttl: 300,
      name: r.name.toUpperCase() + ".",
      value:
        r.type === "TXT"
          ? `"${r.value.slice(0, 10)}" "${r.value.slice(10)}"`
          : r.value,
    }));
    expect(run(googleWorkspace, { copy }).passed).toBe(true);
  });

  describe("G1 exact copy", () => {
    it("a missing DKIM is a hard block an override cannot clear", () => {
      const copy = copyOf(googleWorkspace).filter(
        (r) => !r.name.startsWith("google._domainkey"),
      );
      for (const overrides of [[], ["G1"]] as GateRule[][]) {
        const res = run(googleWorkspace, { copy, overrides });
        const g1 = f(res, "G1");
        expect(g1.pass).toBe(false);
        expect(g1.hardBlock).toBe(true);
        expect(g1.overridable).toBe(false);
        expect(g1.overridden).toBe(false);
        expect(g1.detail).toMatchObject({ rule: "G1", emailMissing: 1 });
        expect(res.passed).toBe(false);
        expect(res.hardBlocked).toBe(true);
      }
    });

    it("a missing verification TXT fails but is overridable", () => {
      const copy = copyOf(googleWorkspace).filter(
        (r) => !r.value.startsWith("google-site-verification"),
      );
      const res = run(googleWorkspace, { copy });
      const g1 = f(res, "G1");
      expect(g1.pass).toBe(false);
      expect(g1.hardBlock).toBe(false);
      expect(g1.overridable).toBe(true);
      expect(res.passed).toBe(false);
      expect(res.hardBlocked).toBe(false);
      if (g1.detail.rule !== "G1") throw new Error("detail");
      expect(g1.detail.missing.map(recordKey)).toEqual([
        recordKey({
          type: "TXT",
          name: googleWorkspace.domain,
          value: "google-site-verification=abc123",
        }),
      ]);

      const over = run(googleWorkspace, { copy, overrides: ["G1"] });
      expect(f(over, "G1").overridden).toBe(true);
      expect(over.passed).toBe(true);
    });

    it("a changed value is reported as mismatched with the copy's record", () => {
      const copy = copyOf(googleWorkspace).map((r) =>
        r.name.startsWith("_dmarc") ? { ...r, value: "v=DMARC1; p=reject" } : r,
      );
      const g1 = f(run(googleWorkspace, { copy }), "G1");
      if (g1.detail.rule !== "G1") throw new Error("detail");
      expect(g1.detail.missing).toEqual([]);
      expect(g1.detail.mismatched).toHaveLength(1);
      expect(g1.detail.mismatched[0]?.copy?.value).toBe("v=DMARC1; p=reject");
      expect(g1.hardBlock).toBe(true);
    });

    it("an MX priority change is a mismatch", () => {
      const copy = copyOf(googleWorkspace).map((r) =>
        r.type === "MX" && r.priority === 5 ? { ...r, priority: 10 } : r,
      );
      expect(f(run(googleWorkspace, { copy }), "G1").hardBlock).toBe(true);
    });
  });

  describe("G2 mail provider", () => {
    const snapshot = googleWorkspace.records.filter(
      (r) => !r.name.startsWith("google._domainkey"),
    );
    it("Google MX without google._domainkey fails, overridable", () => {
      const res = run(googleWorkspace, {
        snapshot,
        copy: copyOf({ ...googleWorkspace, records: snapshot }),
      });
      const g2 = f(res, "G2");
      expect(g2.pass).toBe(false);
      expect(g2.overridable).toBe(true);
      expect(g2.detail).toEqual({
        rule: "G2",
        provider: "google",
        missingExpected: ["google._domainkey"],
      });
      expect(res.passed).toBe(false);
    });
    it("passes with an uploaded zone file", () => {
      const res = run(googleWorkspace, {
        snapshot,
        copy: copyOf({ ...googleWorkspace, records: snapshot }),
        zoneFileUploaded: true,
      });
      expect(f(res, "G2").pass).toBe(true);
      expect(res.passed).toBe(true);
    });
    it("passes with a staff override", () => {
      const res = run(googleWorkspace, {
        snapshot,
        copy: copyOf({ ...googleWorkspace, records: snapshot }),
        overrides: ["G2"],
      });
      expect(res.passed).toBe(true);
    });
    it("M365 complete passes", () => {
      expect(f(run(microsoft365), "G2").pass).toBe(true);
    });
  });

  describe("G3 DNSSEC", () => {
    it("on is a hard block, not overridable", () => {
      const res = run(dnssecOn, { overrides: ["G3"] });
      const g3 = f(res, "G3");
      expect(g3).toMatchObject({
        pass: false,
        hardBlock: true,
        overridable: false,
        overridden: false,
      });
      expect(g3.detail).toEqual({ rule: "G3", dnssec: true });
      expect(res.hardBlocked).toBe(true);
    });
    it("unknown is a hard block too (P14-P37)", () => {
      const res = run(googleWorkspace, { dnssec: null, overrides: ["G3"] });
      const g3 = f(res, "G3");
      expect(g3).toMatchObject({
        pass: false,
        hardBlock: true,
        overridable: false,
      });
      expect(g3.detail).toEqual({ rule: "G3", dnssec: null });
      expect(res.passed).toBe(false);
    });
  });

  describe("G4 CAA", () => {
    const caa: DnsRecord = {
      type: "CAA",
      name: googleWorkspace.domain,
      value: '0 issue "digicert.com"',
    };
    const z = {
      ...googleWorkspace,
      records: [...googleWorkspace.records, caa],
    };
    it("CAA without Let's Encrypt asks for one issue record", () => {
      const g4 = f(run(z), "G4");
      expect(g4.pass).toBe(false);
      expect(g4.detail).toEqual({
        rule: "G4",
        caaPresent: true,
        addRecord: {
          type: "CAA",
          name: z.domain,
          value: '0 issue "letsencrypt.org"',
        },
      });
    });
    it("passes once the record is in the copy", () => {
      const copy = [
        ...copyOf(z),
        {
          type: "CAA" as const,
          name: z.domain,
          value: '0 issue "letsencrypt.org"',
        },
      ];
      const res = run(z, { copy });
      expect(f(res, "G4").pass).toBe(true);
      expect(res.passed).toBe(true);
    });
    it("no CAA passes with nothing to add; a Let's Encrypt CAA passes", () => {
      expect(f(run(googleWorkspace), "G4").detail).toEqual({
        rule: "G4",
        caaPresent: false,
        addRecord: null,
      });
      const le = {
        ...googleWorkspace,
        records: [
          ...googleWorkspace.records,
          {
            ...caa,
            value: '0 issue "letsencrypt.org; validationmethods=http-01"',
          },
        ],
      };
      expect(f(run(le), "G4").pass).toBe(true);
    });
  });

  describe("G5 registrar-only services", () => {
    it("Namecheap forwarding fails until acknowledged; its MX stay in G1 (CR-B01)", () => {
      const copy = copyOf(namecheapForwarding);
      const res = run(namecheapForwarding, { copy });
      const g5 = f(res, "G5");
      expect(g5.pass).toBe(false);
      expect(g5.overridable).toBe(true);
      if (g5.detail.rule !== "G5") throw new Error("detail");
      expect(
        g5.detail.services.map((s) => [s.kind, s.registrar, s.acknowledged]),
      ).toEqual([["email_forwarding", "namecheap", false]]);
      expect(f(res, "G1").pass).toBe(true);
      expect(res.passed).toBe(false);

      const acked = run(namecheapForwarding, {
        copy,
        acks: ["G5:email_forwarding"],
      });
      expect(f(acked, "G5").pass).toBe(true);
      expect(acked.passed).toBe(true);

      const staff = run(namecheapForwarding, { copy, overrides: ["G5"] });
      expect(staff.passed).toBe(true);
    });

    it("forwarding MX missing from the copy is a G1 hard block, acknowledged or not (CR-B01)", () => {
      const copy = copyOf(namecheapForwarding).filter((r) => r.type !== "MX");
      const res = run(namecheapForwarding, {
        copy,
        acks: ["G5:email_forwarding"],
        overrides: ["G1", "G5"],
      });
      const g1 = f(res, "G1");
      expect(g1.pass).toBe(false);
      expect(g1.hardBlock).toBe(true);
      if (g1.detail.rule !== "G1") throw new Error("detail");
      expect(g1.detail.emailMissing).toBe(2);
      expect(res.passed).toBe(false);
    });

    it("a GoDaddy Workspace Email zone is not forwarding and its MX hard-block G1 when uncopied (CR-B01)", () => {
      const d = "gdmail.example";
      const records: DnsRecord[] = [
        { type: "MX", name: d, value: "smtp.secureserver.net", priority: 0 },
        {
          type: "MX",
          name: d,
          value: "mailstore1.secureserver.net",
          priority: 10,
        },
        { type: "TXT", name: d, value: "v=spf1 include:secureserver.net -all" },
        {
          type: "CNAME",
          name: `email.${d}`,
          value: "email.secureserver.net",
        },
        {
          type: "CNAME",
          name: `autodiscover.${d}`,
          value: "autodiscover.secureserver.net",
        },
      ];
      const z: FixtureZone = { domain: d, records, dnssec: false };
      const res = zoneGate({
        domain: d,
        snapshot: records,
        copy: records.filter((r) => r.type !== "MX"),
        takenAt: new Date(NOW.getTime() - HOUR),
        now: NOW,
        dnssec: false,
        zoneFileUploaded: false,
        acks: new Set(["G5:email_forwarding"]),
        overrides: new Set<GateRule>(["G1"]),
        registrar: "godaddy",
      });
      const g5 = f(res, "G5");
      if (g5.detail.rule !== "G5") throw new Error("detail");
      expect(g5.detail.services).toEqual([]);
      const g1 = f(res, "G1");
      expect(g1.hardBlock).toBe(true);
      if (g1.detail.rule !== "G1") throw new Error("detail");
      expect(g1.detail.emailMissing).toBe(2);
      expect(f(run(z, { copy: copyOf(z) }), "G1").pass).toBe(true);
    });
  });

  describe("G6 one SPF", () => {
    it("two apex SPF records are a hard block", () => {
      const res = run(twoSpf, { overrides: ["G6"] });
      const g6 = f(res, "G6");
      expect(g6).toMatchObject({
        pass: false,
        hardBlock: true,
        overridable: false,
      });
      if (g6.detail.rule !== "G6") throw new Error("detail");
      expect(g6.detail.spfCount).toBe(2);
      expect(g6.detail.values).toHaveLength(2);
      expect(res.hardBlocked).toBe(true);
    });
  });

  describe("G7 fresh", () => {
    it("fails at 25 h, overridable", () => {
      const res = run(googleWorkspace, {
        takenAt: new Date(NOW.getTime() - 25 * HOUR),
      });
      const g7 = f(res, "G7");
      expect(g7).toMatchObject({
        pass: false,
        hardBlock: false,
        overridable: true,
      });
      expect(g7.detail).toEqual({ rule: "G7", ageHours: 25 });
      expect(res.passed).toBe(false);
    });
    it("passes at exactly 24 h", () => {
      expect(
        f(
          run(googleWorkspace, {
            takenAt: new Date(NOW.getTime() - 24 * HOUR),
          }),
          "G7",
        ).pass,
      ).toBe(true);
    });
  });

  describe("record cap", () => {
    it("refuses snapshots above the cap", () => {
      expect(MAX_GATE_RECORDS).toBe(190);
      const res = run(big195);
      expect(res.tooManyRecords).toBe(true);
      expect(res.passed).toBe(false);
    });
  });

  it("overrides never clear any hard block", () => {
    const all: GateRule[] = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];
    const res = run(twoSpf, { dnssec: true, overrides: all });
    expect(f(res, "G3").pass).toBe(false);
    expect(f(res, "G6").pass).toBe(false);
    expect(res.passed).toBe(false);
    expect(res.hardBlocked).toBe(true);
  });
});
