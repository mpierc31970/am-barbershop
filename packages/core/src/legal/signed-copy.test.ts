// AGR-04, AGR-05, D81, D-UI-P9-15: deterministic, self-contained signed copy.
import { afterEach, describe, expect, it } from "vitest";
import { toEvidence, type AgreementEvidence } from "./evidence";
import { activeConsent, activePolicyVersions } from "./policies";
import { renderSignedCopy, signedCopyFilename } from "./signed-copy";
import type { ConsentVersion, PolicyVersion } from "./types";

const EVIDENCE_HASH = "e".repeat(56) + "01234567";

const policies: PolicyVersion[] = activePolicyVersions();
const consent: ConsentVersion = activeConsent()!;

function evidence(over: Record<string, unknown> = {}): AgreementEvidence {
  return toEvidence({
    format: "cds-agreement-evidence",
    format_version: 1,
    signature_id: "sig123456789abc",
    organization: "org123456789abc",
    org_name: "Rivera Bakery",
    signer: "usr123456789abc",
    signer_email: "ana@example.com",
    signer_name: "Ana Rivera",
    policies: policies.map((p) => ({
      key: p.key,
      version: p.version,
      title: p.title,
      sha256: p.sha256,
      effective_at: p.effectiveAt,
    })),
    consent: {
      key: "esign-consent",
      version: consent.version,
      sha256: consent.sha256,
    },
    consent_ticked: true,
    policies_ticked: policies.map((p) => p.key),
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
      monthlyTotalCents: 123456789,
    },
    retain_until: "2033-10-08T19:14:03.123Z",
    ...over,
  });
}

function render(ev = evidence(), texts = { policies, consent }): string {
  return renderSignedCopy(ev, EVIDENCE_HASH, texts);
}

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("renderSignedCopy", () => {
  it("is a standalone print-first document", () => {
    const html = render();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(
      "<title>Signed agreement · Rivera Bakery · 2026-10-08</title>",
    );
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html).toContain("@page { margin: 20mm }");
    expect(html).toContain("break-before: page");
    expect(html.match(/class="policy"/g)).toHaveLength(policies.length);
    expect(html).toContain("<h1>Signed agreement: Rivera Bakery</h1>");
  });

  it("needs nothing external", () => {
    const html = render();
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\ssrc=/i);
    expect(html).not.toMatch(/href="http/i);
    expect(html).not.toContain("@import");
    expect(html).not.toContain("url(");
  });

  it("shows the Draft box only when a signed text is draft", () => {
    const box = "DRAFT: these texts have not yet been reviewed by a lawyer.";
    const drafty = {
      policies: policies.map((p, i) => ({ ...p, draft: i === 0 })),
      consent: { ...consent, draft: false },
    };
    expect(render(evidence(), drafty)).toContain(box);
    const clean = {
      policies: policies.map((p) => ({ ...p, draft: false })),
      consent: { ...consent, draft: false },
    };
    expect(render(evidence(), clean)).not.toContain(box);
  });

  it("WR-B01: refuses a policy text whose sha256 differs from the evidence", () => {
    const swapped = {
      policies: policies.map((p, i) =>
        i === 0
          ? { ...p, bodyHtml: "<p>other</p>", sha256: "f".repeat(64) }
          : p,
      ),
      consent,
    };
    expect(() => render(evidence(), swapped)).toThrow(/sha256 mismatch/);
  });

  it("records every policy, the consent and the evidence hash", () => {
    const html = render();
    for (const p of policies) {
      expect(html).toContain(p.title);
      expect(html).toContain(`version ${p.version}`);
      expect(html).toContain(p.sha256);
    }
    expect(html).toContain(consent.sha256);
    expect(html).toContain("Ticked: yes");
    expect(html.split(EVIDENCE_HASH).length - 1).toBeGreaterThanOrEqual(2);
    expect(html).toContain(
      `Evidence hash: ${EVIDENCE_HASH}. Document kept until 8 October 2033.`,
    );
  });

  it("formats the signing time by hand in UTC", () => {
    expect(render()).toContain(
      "2026-10-08 19:14:03 UTC (8 October 2026, 7:14 pm UTC)",
    );
    const midnight = render(
      evidence({ signed_at: "2026-01-02T00:05:09.000Z" }),
    );
    expect(midnight).toContain(
      "2026-01-02 00:05:09 UTC (2 January 2026, 12:05 am UTC)",
    );
    const noon = render(evidence({ signed_at: "2026-06-30T12:00:00.000Z" }));
    expect(noon).toContain("(30 June 2026, 12:00 pm UTC)");
  });

  it("names the sign-in method and the signing type", () => {
    expect(render()).toContain("one-time code");
    expect(render()).toContain("First signing");
    const pw = render(evidence({ auth_method: "password", kind: "reaccept" }));
    expect(pw).toContain("<td>password</td>");
    expect(pw).toContain("Updated terms");
    expect(render(evidence({ auth_method: "unknown" }))).toContain(
      "<td>unknown</td>",
    );
  });

  it("escapes every evidence string", () => {
    const attack = "<img src=x onerror=alert(1)>";
    const html = render(
      evidence({
        signer_name: attack,
        org_name: `"Bad" & <b>`,
        user_agent: attack,
      }),
    );
    expect(html).not.toContain(attack);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&quot;Bad&quot; &amp; &lt;b&gt;");
  });

  it("renders the order table only when a snapshot exists", () => {
    const html = render();
    expect(html).toContain("<h2>Your order at signing</h2>");
    expect(html).toContain("$1,500.00");
    expect(html).toContain("$49.00");
    expect(html).toContain("$1,234,567.89");
    expect(html).toContain(
      "For reference. Prices are set by the order, not by these policies.",
    );
    const none = render(evidence({ order_snapshot: null }));
    expect(none).not.toContain("<h2>Your order at signing</h2>");
  });

  it("is byte-deterministic across runs and time zones", () => {
    const a = render();
    expect(render()).toBe(a);
    process.env.TZ = "America/Chicago";
    expect(render()).toBe(a);
    process.env.TZ = "Asia/Kolkata";
    expect(render()).toBe(a);
  });

  it("gives every table header a scope", () => {
    const html = render();
    const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? [];
    expect(tables.length).toBeGreaterThanOrEqual(2);
    for (const t of tables) expect(t).toContain("<th scope=");
    expect(html).not.toMatch(/<th(?! scope=)[ >]/);
  });

  it("prints the typed signature line", () => {
    expect(render()).toContain(
      "Signed electronically by typing their name, 2026-10-08 19:14:03 UTC, from 203.0.113.7.",
    );
  });
});

describe("signedCopyFilename", () => {
  it("slugs the business name and dates the file", () => {
    expect(
      signedCopyFilename("Rivera Bakery!", "2026-10-08T19:14:03.123Z"),
    ).toBe("CDS-agreement-rivera-bakery-2026-10-08.html");
  });

  it("falls back to site", () => {
    expect(signedCopyFilename("!!!", "2026-10-08T19:14:03.123Z")).toBe(
      "CDS-agreement-site-2026-10-08.html",
    );
  });
});
