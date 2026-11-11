// AGR-03, D187, RESEARCH Pattern 2: deny-by-default evidence builder.
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import { canonicalJson } from "./canonical";
import {
  EVIDENCE_FIELDS,
  evidenceIp,
  toEvidence,
  UNKNOWN_IP,
} from "./evidence";

// Copied from packages/db/src/registry.test.ts (D187 secret-name pattern).
const SECRET_RE = /(password|token|secret|api_?key|hash|credential|otp)/i;

const SHA_A = "a".repeat(64);
const SHA_B = "0123456789abcdef".repeat(4);

function validInput(): Record<string, unknown> {
  return {
    format: "cds-agreement-evidence",
    format_version: 1,
    signature_id: "sig123456789abc",
    organization: "org123456789abc",
    org_name: "Rivera Bakery",
    signer: "usr123456789abc",
    signer_email: "ana@example.com",
    signer_name: "Ana Rivera",
    policies: [
      {
        key: "service-agreement",
        version: 1,
        title: "Service agreement",
        sha256: SHA_A,
        effective_at: "2026-10-01",
      },
      {
        key: "dpa",
        version: 2,
        title: "Data processing agreement",
        sha256: SHA_B,
        effective_at: "2026-10-01",
      },
    ],
    consent: { key: "esign-consent", version: 1, sha256: SHA_B },
    consent_ticked: true,
    policies_ticked: ["service-agreement", "dpa"],
    ip: "203.0.113.7",
    user_agent: "Mozilla/5.0",
    auth_method: "otp",
    signed_at: "2026-10-08T19:14:03.123Z",
    kind: "signup",
    order_snapshot: {
      path: "standard",
      cadence: "monthly",
      buildCents: 150000,
      installments: 1,
      monthlyItems: [
        { label: "Base platform", monthlyCents: 4900 },
        { label: "Appointments", monthlyCents: null },
      ],
      monthlyTotalCents: 4900,
    },
    retain_until: "2033-10-08T19:14:03.123Z",
  };
}

function allKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      allKeys(x, out);
    }
  }
  return out;
}

describe("EVIDENCE_FIELDS", () => {
  it("is the 19 approved keys, sorted", () => {
    expect(EVIDENCE_FIELDS).toHaveLength(19);
    expect([...EVIDENCE_FIELDS]).toEqual([...EVIDENCE_FIELDS].sort());
    expect(EVIDENCE_FIELDS).not.toContain("document_sha256");
  });

  it("no field name and no nested key matches the secret pattern", () => {
    for (const f of EVIDENCE_FIELDS) expect(SECRET_RE.test(f)).toBe(false);
    for (const k of allKeys(toEvidence(validInput()))) {
      expect(SECRET_RE.test(k), k).toBe(false);
    }
  });
});

describe("toEvidence", () => {
  it("keeps exactly the approved keys and drops extras", () => {
    const ev = toEvidence({
      ...validInput(),
      password: "hunter2",
      token: "t",
      document_sha256: SHA_A,
      session: "s",
    });
    expect(Object.keys(ev).sort()).toEqual([...EVIDENCE_FIELDS].sort());
    const json = canonicalJson(ev);
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("document_sha256");
  });

  it("drops extra nested keys too", () => {
    const input = validInput();
    (input.consent as Record<string, unknown>).secret = "x";
    (input.policies as Record<string, unknown>[])[0]!.token = "y";
    const ev = toEvidence(input);
    expect(Object.keys(ev.consent).sort()).toEqual([
      "key",
      "sha256",
      "version",
    ]);
    expect(Object.keys(ev.policies[0]!)).not.toContain("token");
  });

  it("accepts a null order snapshot", () => {
    expect(
      toEvidence({ ...validInput(), order_snapshot: null }).order_snapshot,
    ).toBeNull();
  });

  it("serialises identically regardless of input key order", () => {
    const a = validInput();
    const b = Object.fromEntries(Object.entries(a).reverse());
    expect(canonicalJson(toEvidence(b))).toBe(canonicalJson(toEvidence(a)));
  });

  const bad: [string, (i: Record<string, unknown>) => void][] = [
    ["missing signer_name", (i) => delete i.signer_name],
    ["empty signer_name", (i) => (i.signer_name = "  ")],
    [
      "float in order_snapshot",
      (i) => ((i.order_snapshot as Record<string, unknown>).buildCents = 12.5),
    ],
    ["auth_method outside enum", (i) => (i.auth_method = "magic")],
    ["signed_at without Z", (i) => (i.signed_at = "2026-10-08T19:14:03.123")],
    ["retain_until not ISO", (i) => (i.retain_until = "2033-10-08")],
    [
      "non-hex policy sha256",
      (i) =>
        ((i.policies as Record<string, unknown>[])[0]!.sha256 = "z".repeat(64)),
    ],
    [
      "unknown policy key",
      (i) => ((i.policies as Record<string, unknown>[])[0]!.key = "nda"),
    ],
    ["consent_ticked false", (i) => (i.consent_ticked = false)],
    ["wrong format", (i) => (i.format = "other")],
    ["format_version 2", (i) => (i.format_version = 2)],
    ["kind outside enum", (i) => (i.kind = "renewal")],
    ["policies_ticked unknown key", (i) => (i.policies_ticked = ["nda"])],
    ["empty policies", (i) => (i.policies = [])],
    // WR-B03
    ["empty ip", (i) => (i.ip = "")],
    ["non-IP ip", (i) => (i.ip = "not an ip")],
    [
      "duplicate policy key",
      (i) => {
        const ps = i.policies as Record<string, unknown>[];
        ps.push({ ...ps[0]! });
      },
    ],
    [
      "ticked set differs from signed set",
      (i) => (i.policies_ticked = (i.policies_ticked as string[]).slice(1)),
    ],
    [
      "duplicate ticked key",
      (i) => {
        const t = i.policies_ticked as string[];
        i.policies_ticked = [...t.slice(1), t[1]];
      },
    ],
  ];
  for (const [name, mutate] of bad) {
    it(`throws InvalidInput on ${name}`, () => {
      const input = validInput();
      mutate(input);
      expect(() => toEvidence(input)).toThrow(InvalidInput);
    });
  }

  it('WR-B03: accepts IPv4, IPv6 and the explicit "unknown"', () => {
    for (const ip of ["203.0.113.7", "2001:db8::1", "::1", UNKNOWN_IP]) {
      expect(toEvidence({ ...validInput(), ip }).ip).toBe(ip);
    }
  });

  it("WR-B03: evidenceIp keeps an address and turns anything else into unknown", () => {
    expect(evidenceIp(" 203.0.113.7 ")).toBe("203.0.113.7");
    expect(evidenceIp("2001:db8::1")).toBe("2001:db8::1");
    for (const v of ["", "  ", "x", undefined, null, "a".repeat(80)]) {
      expect(evidenceIp(v)).toBe(UNKNOWN_IP);
    }
  });
});

describe("toEvidence user_agent (IN-B04)", () => {
  it("caps at 512 code points without splitting a surrogate pair", () => {
    const ua = "a".repeat(511) + "😀" + "b";
    const ev = toEvidence({ ...validInput(), user_agent: ua });
    expect([...ev.user_agent]).toHaveLength(512);
    expect(ev.user_agent.endsWith("😀")).toBe(true);
  });
});
