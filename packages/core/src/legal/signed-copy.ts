// Signed copy renderer (AGR-04, AGR-05; CONTEXT A2-Q3; UI-SPEC "Signed copy document";
// D-UI-P9-7, -14, -15, -16). One self-contained, print-first HTML document: inline CSS, no
// scripts, no external fonts, images or links. Every evidence string goes through escapeHtml;
// policy and consent bodies are bodyHtml, sanitised at codegen (T-09-07-01). Dates are
// formatted by hand from UTC parts with a fixed month table (no Intl, no locale methods), so
// the same inputs always give the same bytes on any host (D81, T-09-07-03). The policy texts
// are passed in, never looked up here, so a verification re-render uses exactly the recorded
// versions. Pure.
import { escapeHtml } from "../email/escape";
import { InvalidInput } from "../errors";
import type { AgreementEvidence, OrderSnapshot } from "./evidence";
import type { ConsentVersion, PolicyVersion } from "./types";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const DRAFT_TEXT = "DRAFT: these texts have not yet been reviewed by a lawyer.";

const AUTH_LABEL: Readonly<Record<AgreementEvidence["auth_method"], string>> = {
  otp: "one-time code",
  password: "password",
  unknown: "unknown",
};

const KIND_LABEL: Readonly<Record<AgreementEvidence["kind"], string>> = {
  signup: "First signing",
  reaccept: "Updated terms",
};

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { background: #FFFFFF; }
body { margin: 0; padding: 32px 16px; background: #FFFFFF; color: #1B1B19; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 16px; line-height: 1.6; }
main { max-width: 72ch; margin: 0 auto; }
h1 { font-size: 28px; font-weight: 600; line-height: 1.25; margin: 0 0 24px; }
h2 { font-size: 20px; font-weight: 600; line-height: 1.3; margin: 32px 0 8px; }
h3 { font-size: 16px; font-weight: 600; margin: 24px 0 8px; }
p { margin: 0 0 12px; }
.draft { border: 2px solid #1B1B19; padding: 16px; font-weight: 600; margin: 0 0 24px; }
.label, .meta { font-size: 14px; color: #5B5B56; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 14px; word-break: break-all; }
table { width: 100%; border-collapse: collapse; margin: 0 0 16px; }
th, td { text-align: left; vertical-align: top; padding: 8px 12px 8px 0; border-bottom: 1px solid #D9D9D4; }
th { font-size: 14px; font-weight: 400; color: #5B5B56; width: 30%; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
ul { padding-left: 20px; margin: 0 0 16px; }
.policy,
.consent { break-before: page; }
.text { border-top: 1px solid #D9D9D4; padding-top: 16px; }
.signature { font-size: 28px; font-weight: 400; margin: 24px 0 0; padding-bottom: 8px; border-bottom: 1px solid #D9D9D4; }
.hash-line { word-break: break-all; }
footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #D9D9D4; }
@page { margin: 20mm }
@media print { body { padding: 0; } }
`;

type Parts = {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
};

function utcParts(iso: string): Parts {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new InvalidInput(`invalid date ${iso}`);
  const dt = new Date(t);
  return {
    y: dt.getUTCFullYear(),
    mo: dt.getUTCMonth(),
    d: dt.getUTCDate(),
    h: dt.getUTCHours(),
    mi: dt.getUTCMinutes(),
    s: dt.getUTCSeconds(),
  };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

function ymd(p: Parts): string {
  return `${String(p.y).padStart(4, "0")}-${pad2(p.mo + 1)}-${pad2(p.d)}`;
}

function dateWords(p: Parts): string {
  return `${p.d} ${MONTHS[p.mo]} ${p.y}`;
}

/** "2026-10-08 19:14:03 UTC" */
function isoUtc(iso: string): string {
  const p = utcParts(iso);
  return `${ymd(p)} ${pad2(p.h)}:${pad2(p.mi)}:${pad2(p.s)} UTC`;
}

/** "2026-10-08 19:14:03 UTC (8 October 2026, 7:14 pm UTC)" */
function isoAndWords(iso: string): string {
  const p = utcParts(iso);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  const ampm = p.h < 12 ? "am" : "pm";
  return `${isoUtc(iso)} (${dateWords(p)}, ${h12}:${pad2(p.mi)} ${ampm} UTC)`;
}

/** "YYYY-MM-DD" → "8 October 2026", without going through Date (no TZ shift). */
function ymdWords(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return s;
  return `${Number(m[3])} ${MONTHS[mo]} ${m[1]}`;
}

/** Integer cents → "$1,234.00"; null → "Price coming soon". */
function money(cents: number | null): string {
  if (cents === null) return "Price coming soon";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = String(Math.floor(abs / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
  return `${neg ? "-" : ""}$${dollars}.${pad2(abs % 100)}`;
}

const e = escapeHtml;

function row(label: string, valueHtml: string, mono = false): string {
  return `<tr><th scope="row">${e(label)}</th><td${mono ? ' class="mono"' : ""}>${valueHtml}</td></tr>`;
}

function orderSection(o: NonNullable<OrderSnapshot>): string {
  const build =
    o.installments > 1
      ? `${money(o.buildCents)} in ${o.installments} payments`
      : money(o.buildCents);
  const items = o.monthlyItems
    .map(
      (it) =>
        `<tr><th scope="row">${e(it.label)}</th><td class="num">${e(money(it.monthlyCents))} / month</td></tr>`,
    )
    .join("\n");
  return `<section>
<h2>Your order at signing</h2>
<p class="label">For reference. Prices are set by the order, not by these policies.</p>
<table>
<tr><th scope="row">Path</th><td>${e(o.path)}</td></tr>
<tr><th scope="row">Billing</th><td>${e(o.cadence)}</td></tr>
<tr><th scope="row">Build fee</th><td class="num">${e(build)}</td></tr>
${items}
<tr><th scope="row">Monthly total</th><td class="num">${e(money(o.monthlyTotalCents))} / month</td></tr>
</table>
</section>`;
}

/**
 * Renders the signed copy. `texts` must contain the exact policy and consent versions the
 * evidence records (matched by key, version and sha256); a missing or different text throws
 * InvalidInput rather than rendering other text.
 */
export function renderSignedCopy(
  evidence: AgreementEvidence,
  evidenceSha256: string,
  texts: { policies: readonly PolicyVersion[]; consent: ConsentVersion },
): string {
  const signed = evidence.policies.map((ep) => {
    const t = texts.policies.find(
      (p) => p.key === ep.key && p.version === ep.version,
    );
    // WR-B01: the exact text signed, not just the same version number.
    if (!t || t.sha256 !== ep.sha256) {
      throw new InvalidInput(
        `signed copy needs ${ep.key} version ${ep.version}${t ? " (sha256 mismatch)" : ""}`,
      );
    }
    return { ep, t };
  });
  const c = texts.consent;
  if (
    c.version !== evidence.consent.version ||
    c.sha256 !== evidence.consent.sha256
  ) {
    throw new InvalidInput(
      `signed copy needs consent version ${evidence.consent.version}`,
    );
  }

  const draft = c.draft || signed.some(({ t }) => t.draft);
  const signedAt = utcParts(evidence.signed_at);
  const keptUntil = dateWords(utcParts(evidence.retain_until));
  const hash = e(evidenceSha256);
  const org = e(evidence.org_name);

  const record = [
    row("Signed by", e(evidence.signer_name)),
    row("Email", e(evidence.signer_email)),
    row("On behalf of", org),
    row("Signed at", e(isoAndWords(evidence.signed_at))),
    row("IP address", e(evidence.ip)),
    row("Signed in with", e(AUTH_LABEL[evidence.auth_method])),
    row("Type", e(KIND_LABEL[evidence.kind])),
    row("Signature id", e(evidence.signature_id), true),
    row("Evidence hash", hash, true),
  ].join("\n");

  const list = signed
    .map(
      ({ ep }) =>
        `<li>${e(ep.title)}, version ${ep.version}, sha256 <span class="mono">${e(ep.sha256)}</span></li>`,
    )
    .join("\n");

  const sections = signed
    .map(
      ({ ep, t }) => `<section class="policy">
<h2>${e(ep.title)}</h2>
<p class="meta">Version ${ep.version} · Effective ${e(ymdWords(ep.effective_at))} · sha256 <span class="mono">${e(ep.sha256)}</span></p>
<div class="text">
${t.bodyHtml}
</div>
</section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Signed agreement · ${org} · ${ymd(signedAt)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${draft ? `<p class="draft">${e(DRAFT_TEXT)}</p>\n` : ""}<h1>Signed agreement: ${org}</h1>
<section>
<h2>Signing record</h2>
<table>
${record}
</table>
</section>
<section>
<h2>Policies signed</h2>
<ul>
${list}
</ul>
</section>
${evidence.order_snapshot ? `${orderSection(evidence.order_snapshot)}\n` : ""}${sections}
<section class="consent">
<h2>Electronic signature consent</h2>
<p class="meta">Version ${evidence.consent.version} · sha256 <span class="mono">${e(evidence.consent.sha256)}</span></p>
<div class="text">
${c.bodyHtml}
</div>
<p>Ticked: yes</p>
</section>
<section>
<h2>Signature</h2>
<p class="signature">${e(evidence.signer_name)}</p>
<p class="label">Signed electronically by typing their name, ${e(isoUtc(evidence.signed_at))}, from ${e(evidence.ip)}.</p>
</section>
<footer>
<p class="meta hash-line">Evidence hash: ${hash}. Document kept until ${e(keptUntil)}.</p>
</footer>
</main>
</body>
</html>
`;
}

/** `CDS-agreement-{slug}-{yyyy-mm-dd}.html`; slug reduced to [a-z0-9-], fallback `site`. */
export function signedCopyFilename(
  businessSlug: string,
  signedAtIso: string,
): string {
  const slug =
    String(businessSlug)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "site";
  return `CDS-agreement-${slug}-${ymd(utcParts(signedAtIso))}.html`;
}
