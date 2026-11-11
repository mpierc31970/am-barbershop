// Settings › Domain › DNS records and email setup view models (14-32 choices 2 and 3; 14-UI-SPEC
// "DNS records", "Email setup"). Pure, server-side only (it type-imports @cds/db, so client
// islands never import it; they take the built rows as props):
// - recordGroups: the 14-28 owner view -> RecordGroupList groups. The apex shows as "@",
//   every row keeps its "Who manages it" label; actions: Remove on removable rows (verification
//   TXT, owner CNAME), Ask to change on other "Yours" rows, none on CDS and email rows (Your
//   email gets Change email setup on its header instead).
// - emailPreviewView: the 14-28 preview -> step 3's groups (Change: Add / Replace / Update),
//   the SPF merge include and the provider being replaced.
// - currentEmailPreset: the preset matching today's apex MX ("Your current email").
import {
  EMAIL_PRESETS,
  EMAIL_PRESET_IDS,
  detectMailProvider,
  fqdn,
  mailProvider,
  recordKey,
  type DnsRecord,
  type EmailPresetId,
} from "@cds/core/dns";
import type { EmailSetupPreview, OwnerDnsRecordsView } from "@cds/db";
import type {
  DomainRecordRow,
  EmailSetupPreviewView,
  RecordChange,
  RecordGroup,
} from "@cds/ui/hub/domain";

export const RECORDS_VIEW_COPY = Object.freeze({
  heading: "DNS records",
  backToDomain: "Domain",
  explainer:
    "DNS records tell the internet where your website and email live. Support keeps them in one place for you.",
  currentEmail: "Your current email",
  noEmail: "No email set up on this domain yet.",
  emailOwnerOnly: "Only the owner can set up email for the domain.",
});

/** "riverabakery.com" -> "@"; anything else is shown as its full name. */
export function relativeName(name: string, domain: string): string {
  const n = fqdn(name);
  return n === fqdn(domain) ? "@" : n;
}

export function recordGroups(
  view: OwnerDnsRecordsView,
  opts: { canEdit: boolean },
): RecordGroup[] {
  return view.groups.map((g) => ({
    key: g.key,
    records: g.records.map((r): DomainRecordRow => {
      const row: DomainRecordRow = {
        key: r.id,
        type: r.type,
        name: relativeName(r.name, view.domain),
        value: r.value,
        manager: r.label,
      };
      if (r.priority !== undefined) row.priority = r.priority;
      if (r.pending) row.status = "checking";
      if (opts.canEdit && r.label === "yours") {
        row.action = r.removable ? "remove" : "ask";
      }
      return row;
    }),
  }));
}

const isSpf = (r: DnsRecord): boolean =>
  r.type === "TXT" && /^"?v=spf1(\s|$)/i.test(r.value.trim());

/** A verification TXT: a TXT that is neither the SPF nor a DKIM key. */
const isVerificationTxt = (r: DnsRecord): boolean =>
  r.type === "TXT" && !isSpf(r) && !/(^|\.)_domainkey\./i.test(fqdn(r.name));

function changeFor(r: DnsRecord, preview: EmailSetupPreview): RecordChange {
  if (isSpf(r)) return preview.spf.before === null ? "add" : "update";
  // A verification TXT sits beside the apex's other TXT records: always an add.
  if (isVerificationTxt(r)) return "add";
  const name = fqdn(r.name);
  const replaced = [...preview.replace, ...preview.remove].some(
    (c) => fqdn(c.name) === name && (c.type === r.type || r.type !== "MX"),
  );
  return replaced ? "replace" : "add";
}

/**
 * Step 3 of email setup. Names stay full (RecordGroupList shows them as written), so the
 * preview needs no domain read of its own.
 */
export function emailPreviewView(
  preview: EmailSetupPreview,
): EmailSetupPreviewView {
  const email: DomainRecordRow[] = [];
  const verification: DomainRecordRow[] = [];
  for (const r of preview.add) {
    const row: DomainRecordRow = {
      key: recordKey(r),
      type: r.type,
      name: fqdn(r.name),
      value: r.value,
      change: changeFor(r, preview),
    };
    if (r.priority !== undefined) row.priority = r.priority;
    (isVerificationTxt(r) ? verification : email).push(row);
  }
  const groups: RecordGroup[] = [{ key: "email", records: email }];
  if (verification.length > 0) {
    groups.push({ key: "verification", records: verification });
  }
  const spfChanged = preview.spf.after !== preview.spf.before;
  return {
    groups,
    spfInclude: spfChanged ? EMAIL_PRESETS[preview.preset].spfInclude : null,
    replacesProvider: preview.replacesProvider,
  };
}

/** Today's email provider from the apex MX: its display name and matching preset, if any. */
export function currentEmail(view: OwnerDnsRecordsView): {
  name: string | null;
  preset: EmailPresetId | null;
} {
  const apex = fqdn(view.domain);
  const mx: DnsRecord[] = view.groups
    .flatMap((g) => g.records)
    .filter((r) => r.type === "MX" && fqdn(r.name) === apex)
    .map((r) => ({
      type: r.type,
      name: r.name,
      value: r.value,
      ...(r.priority !== undefined ? { priority: r.priority } : {}),
    }));
  if (mx.length === 0) return { name: null, preset: null };
  const id = detectMailProvider(mx, apex);
  if (id === null) return { name: null, preset: null };
  const preset =
    EMAIL_PRESET_IDS.find((p) => EMAIL_PRESETS[p].provider === id) ?? null;
  return { name: mailProvider(id).name, preset };
}
