// packages/core/src/dns/registrar.ts (P14, DOM-05).
// Owner: 14-05 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Registrars as data: the owner-facing list (UI-SPEC `RegistrarSteps`), RDAP name mapping,
// per-registrar step texts (D-UI-P14-8; 14-05 choice 6) and the registrar-only services
// the gate's G5 rule flags (14-05 choice 4: forwarding/parking only works on the
// registrar's own DNS, so it is acknowledged; non-email services are never copied, while
// email-class records are always copied and stay in G1: CR-B01). Step texts use `**bold**`
// for the words on the registrar's screen. Pure and Edge-safe.

import { mailHostMatches } from "./classify";
import { canonicalValue, recordKey, type DnsRecord } from "./record";

export type RegistrarId =
  | "godaddy"
  | "namecheap"
  | "hostinger"
  | "squarespace"
  | "ionos"
  | "porkbun"
  | "other";

export type Registrar = { readonly id: RegistrarId; readonly name: string };

/** UI-SPEC order (Select "Where is your domain registered?"). */
export const REGISTRARS: readonly Registrar[] = Object.freeze(
  (
    [
      { id: "godaddy", name: "GoDaddy" },
      { id: "namecheap", name: "Namecheap" },
      { id: "hostinger", name: "Hostinger" },
      { id: "squarespace", name: "Squarespace (was Google Domains)" },
      { id: "ionos", name: "IONOS" },
      { id: "porkbun", name: "Porkbun" },
      { id: "other", name: "Another registrar" },
    ] as const
  ).map((r) => Object.freeze({ ...r })),
);

/** Short name for owner copy ("Your email forwarding at {Namecheap}…"). */
export function registrarName(id: RegistrarId): string {
  if (id === "squarespace") return "Squarespace";
  if (id === "other") return "your registrar";
  return (REGISTRARS.find((r) => r.id === id) as Registrar).name;
}

/** Map an RDAP registrar `fn` to a list entry; anything unknown is `other`. */
export function registrarFromRdapName(
  name: string | null | undefined,
): RegistrarId {
  const n = (name ?? "").toLowerCase();
  if (n.includes("godaddy") || n.includes("wild west domains"))
    return "godaddy";
  if (n.includes("namecheap")) return "namecheap";
  if (n.includes("hostinger")) return "hostinger";
  if (n.includes("squarespace") || /^google\b/.test(n)) return "squarespace";
  if (n.includes("ionos") || n.includes("1&1") || n.includes("1and1"))
    return "ionos";
  if (n.includes("porkbun")) return "porkbun";
  return "other";
}

export type RegistrarStepKind =
  "nameservers" | "zone_export" | "dnssec" | "handback";

export const REGISTRAR_STEP_KINDS: readonly RegistrarStepKind[] = Object.freeze(
  ["nameservers", "zone_export", "dnssec", "handback"],
);

const DONE = "Save. You're done there.";

type StepTable = Record<RegistrarStepKind, readonly string[]>;

const STEPS: Record<RegistrarId, StepTable> = {
  godaddy: {
    nameservers: [
      "Sign in to GoDaddy and open **My Products**.",
      "Next to your domain, choose **DNS**, then the **Nameservers** tab.",
      "Choose **Change Nameservers**, then **I'll use my own nameservers**.",
      "Replace the nameservers with the two above. Remove any others.",
      DONE,
    ],
    zone_export: [
      "Sign in to GoDaddy and open **My Products**.",
      "Next to your domain, choose **DNS**.",
      "Open the **…** menu above your records and choose **Export Zone File**.",
      "Save the file, then add it here.",
    ],
    dnssec: [
      "Sign in to GoDaddy and open **My Products**.",
      "Next to your domain, choose **DNS**, then the **DNSSEC** tab.",
      "Delete each DS record listed there, or turn DNSSEC **Off**.",
      "Save, then come back here and choose **Check again**.",
    ],
    handback: [
      "Sign in to GoDaddy and open **My Products**.",
      "Next to your domain, choose **DNS**, then the **Nameservers** tab.",
      "Choose **Change Nameservers**, then **GoDaddy Nameservers (recommended)**.",
      DONE,
    ],
  },
  namecheap: {
    nameservers: [
      "Sign in to Namecheap and open **Domain List**.",
      "Choose **Manage** next to your domain.",
      "Under **Nameservers**, choose **Custom DNS**.",
      "Enter the two nameservers above. Remove any others.",
      DONE,
    ],
    zone_export: [
      "Sign in to Namecheap and open **Domain List**.",
      "Choose **Manage** next to your domain, then **Advanced DNS**.",
      "Choose **Export** (or **Export BIND**) above your records.",
      "Save the file, then add it here.",
    ],
    dnssec: [
      "Sign in to Namecheap and open **Domain List**.",
      "Choose **Manage** next to your domain, then **Advanced DNS**.",
      "Find **DNSSEC** and switch it off.",
      "Save, then come back here and choose **Check again**.",
    ],
    handback: [
      "Sign in to Namecheap and open **Domain List**.",
      "Choose **Manage** next to your domain.",
      "Under **Nameservers**, choose **Namecheap BasicDNS**.",
      DONE,
    ],
  },
  hostinger: {
    nameservers: [
      "Sign in to Hostinger and open **Domains**.",
      "Choose your domain, then **DNS / Nameservers**.",
      "Choose **Change Nameservers**, then **Change nameservers** again.",
      "Enter the two nameservers above. Remove any others.",
      DONE,
    ],
    zone_export: [
      "Sign in to Hostinger and open **Domains**.",
      "Choose your domain, then **DNS / Nameservers**.",
      "Choose **Export** (or **Download DNS records**) above your records.",
      "Save the file, then add it here.",
    ],
    dnssec: [
      "Sign in to Hostinger and open **Domains**.",
      "Choose your domain, then **DNSSEC**.",
      "Turn DNSSEC off, or delete each DS record listed there.",
      "Save, then come back here and choose **Check again**.",
    ],
    handback: [
      "Sign in to Hostinger and open **Domains**.",
      "Choose your domain, then **DNS / Nameservers**.",
      "Choose **Change Nameservers**, then **Use Hostinger nameservers**.",
      DONE,
    ],
  },
  squarespace: {
    nameservers: [
      "Sign in to Squarespace and open **Domains**.",
      "Choose your domain, then **DNS** and **Domain Nameservers**.",
      "Choose **Use custom nameservers**.",
      "Enter the two nameservers above. Remove any others.",
      DONE,
    ],
    zone_export: [
      "Sign in to Squarespace and open **Domains**.",
      "Choose your domain, then **DNS** and **DNS Settings**.",
      "Squarespace has no zone file download. Skip this step: we copy your records from the internet instead.",
    ],
    dnssec: [
      "Sign in to Squarespace and open **Domains**.",
      "Choose your domain, then **DNS** and **DNSSEC**.",
      "Turn DNSSEC off.",
      "Save, then come back here and choose **Check again**.",
    ],
    handback: [
      "Sign in to Squarespace and open **Domains**.",
      "Choose your domain, then **DNS** and **Domain Nameservers**.",
      "Choose **Use Squarespace nameservers**.",
      DONE,
    ],
  },
  ionos: {
    nameservers: [
      "Sign in to IONOS and open **Domains & SSL**.",
      "Choose the gear next to your domain, then **Nameservers**.",
      "Choose **Use custom nameservers**.",
      "Enter the two nameservers above. Remove any others.",
      DONE,
    ],
    zone_export: [
      "Sign in to IONOS and open **Domains & SSL**.",
      "Choose the gear next to your domain, then **DNS**.",
      "Look for **Export** above your records and save the file.",
      "If there is no Export, skip this step: we copy your records from the internet instead.",
    ],
    dnssec: [
      "Sign in to IONOS and open **Domains & SSL**.",
      "Choose the gear next to your domain, then **DNSSEC**.",
      "Turn DNSSEC off.",
      "Save, then come back here and choose **Check again**.",
    ],
    handback: [
      "Sign in to IONOS and open **Domains & SSL**.",
      "Choose the gear next to your domain, then **Nameservers**.",
      "Choose **Use IONOS nameservers**.",
      DONE,
    ],
  },
  porkbun: {
    nameservers: [
      "Sign in to Porkbun and open **Domain Management**.",
      "Next to your domain, choose **Details**, then **Authoritative Nameservers** (edit).",
      "Delete the nameservers listed there.",
      "Enter the two nameservers above, one per line.",
      DONE,
    ],
    zone_export: [
      "Sign in to Porkbun and open **Domain Management**.",
      "Next to your domain, choose **DNS**.",
      "Choose **Export** (BIND) under your records.",
      "Save the file, then add it here.",
    ],
    dnssec: [
      "Sign in to Porkbun and open **Domain Management**.",
      "Next to your domain, choose **Details**, then **DNSSEC** (edit).",
      "Delete each DS record listed there.",
      "Save, then come back here and choose **Check again**.",
    ],
    handback: [
      "Sign in to Porkbun and open **Domain Management**.",
      "Next to your domain, choose **Details**, then **Authoritative Nameservers** (edit).",
      "Choose **Use Porkbun defaults**.",
      DONE,
    ],
  },
  other: {
    nameservers: [
      "Sign in where you bought your domain.",
      "Open your domain's settings and find **Nameservers**.",
      "Choose custom nameservers, then enter the two above. Remove any others.",
      DONE,
    ],
    zone_export: [
      "Sign in where you bought your domain.",
      "Open your domain's DNS settings.",
      "Look for **Export zone file**, **Download DNS records** or **Export BIND** in your registrar's DNS settings.",
      "Save the file, then add it here.",
    ],
    dnssec: [
      "Sign in where you bought your domain.",
      "Open your domain's settings and find **DNSSEC** (sometimes **DS records**).",
      "Turn DNSSEC off, or delete each DS record.",
      "Save, then come back here and choose **Check again**.",
    ],
    handback: [
      "Sign in where you bought your domain.",
      "Open your domain's settings and find **Nameservers**.",
      "Choose the registrar's own (default) nameservers.",
      DONE,
    ],
  },
};

for (const t of Object.values(STEPS)) {
  for (const k of REGISTRAR_STEP_KINDS) Object.freeze(t[k]);
  Object.freeze(t);
}
Object.freeze(STEPS);

/** The 3-5 Body steps for one registrar; nameserver and handback lists end with DONE. */
export function registrarSteps(
  kind: RegistrarStepKind,
  id: RegistrarId,
): string[] {
  return [...STEPS[id][kind]];
}

export type RegistrarServiceKind =
  "email_forwarding" | "web_forwarding" | "parking";

export const REGISTRAR_SERVICE_KINDS: readonly RegistrarServiceKind[] =
  Object.freeze(["email_forwarding", "web_forwarding", "parking"]);

export type RegistrarService = {
  kind: RegistrarServiceKind;
  /** The registrar the pattern belongs to (falls back to the caller's registrar). */
  registrar: RegistrarId;
  records: DnsRecord[];
};

type ServicePattern = {
  kind: RegistrarServiceKind;
  registrar: RegistrarId;
  /** Only applies when the zone's registrar is this one. */
  onlyAt?: RegistrarId;
  test: (r: DnsRecord) => boolean;
};

const mxTo = (pat: string) => (r: DnsRecord) =>
  r.type === "MX" && mailHostMatches(canonicalValue(r), pat);
const aIs = (ips: readonly string[]) => (r: DnsRecord) =>
  r.type === "A" && ips.includes(canonicalValue(r));
const aIn = (prefix: string) => (r: DnsRecord) =>
  r.type === "A" && canonicalValue(r).startsWith(prefix);
const cnameTo = (pat: string) => (r: DnsRecord) =>
  r.type === "CNAME" && mailHostMatches(canonicalValue(r), pat);

/** Registrar-only service patterns (14-05 choice 4). */
export const REGISTRAR_SERVICE_PATTERNS: readonly ServicePattern[] =
  Object.freeze([
    {
      kind: "email_forwarding",
      registrar: "namecheap",
      test: mxTo("eforward*.registrar-servers.com"),
    },
    {
      kind: "email_forwarding",
      registrar: "godaddy",
      onlyAt: "godaddy",
      test: (r: DnsRecord) =>
        mxTo("mailstore1.secureserver.net")(r) ||
        mxTo("smtp.secureserver.net")(r),
    },
    {
      kind: "web_forwarding",
      registrar: "godaddy",
      test: aIs(["3.33.152.147", "15.197.142.173"]),
    },
    { kind: "parking", registrar: "godaddy", test: aIs(["34.102.136.180"]) },
    { kind: "parking", registrar: "namecheap", test: aIn("192.64.119.") },
    {
      kind: "parking",
      registrar: "hostinger",
      test: cnameTo("*.dns-parking.com"),
    },
  ] satisfies ServicePattern[]);

/** True when the zone's apex SPF names GoDaddy's mail (forwarding counts as GoDaddy). */
function spfSaysGodaddy(records: readonly DnsRecord[]): boolean {
  return records.some(
    (r) =>
      r.type === "TXT" &&
      /^v=spf1\s/i.test(canonicalValue(r)) &&
      /include:secureserver\.net/i.test(canonicalValue(r)),
  );
}

/** Client host labels GoDaddy's mailbox products (Workspace Email, cPanel) publish. */
const GODADDY_MAILBOX_LABELS = new Set([
  "email",
  "mail",
  "webmail",
  "autodiscover",
  "imap",
  "pop",
  "smtp",
]);

/**
 * True when the zone shows GoDaddy *mailboxes* (CR-B01): a client CNAME such as
 * `email.<d>` or `autodiscover.<d>` to `*.secureserver.net`. Forwarding has none, so the
 * GoDaddy email-forwarding pattern stays quiet for these zones.
 */
function godaddyMailboxes(records: readonly DnsRecord[]): boolean {
  return records.some(
    (r) =>
      r.type === "CNAME" &&
      GODADDY_MAILBOX_LABELS.has(
        (r.name.toLowerCase().split(".")[0] ?? "") as string,
      ) &&
      mailHostMatches(canonicalValue(r), "*.secureserver.net"),
  );
}

/**
 * Registrar-only services in a snapshot, one entry per kind in fixed order
 * (email forwarding, web forwarding, parking). The gate needs ack `G5:<kind>` for each.
 */
export function registrarOnlyServices(
  records: readonly DnsRecord[],
  registrar: RegistrarId,
): RegistrarService[] {
  const atGodaddy =
    (registrar === "godaddy" || spfSaysGodaddy(records)) &&
    !godaddyMailboxes(records);
  const out: RegistrarService[] = [];
  for (const kind of REGISTRAR_SERVICE_KINDS) {
    let owner: RegistrarId = registrar;
    let found = false;
    const hits: DnsRecord[] = [];
    for (const r of records) {
      const pat = REGISTRAR_SERVICE_PATTERNS.find(
        (p) =>
          p.kind === kind && (p.onlyAt !== "godaddy" || atGodaddy) && p.test(r),
      );
      if (!pat) continue;
      if (!found) owner = pat.registrar;
      found = true;
      hits.push(r);
    }
    if (hits.length) out.push({ kind, registrar: owner, records: hits });
  }
  return out;
}

/**
 * Record keys a CDS zone never copies (CR-B01): only the records of non-email services
 * (web forwarding, parking). Email forwarding MX keep working from any DNS host and dropping
 * them breaks mail, so they are always copied and stay under G1's email hard block; G5
 * only asks the owner to acknowledge the forwarding.
 */
export function registrarRecordsNotCopied(
  records: readonly DnsRecord[],
  registrar: RegistrarId,
): Set<string> {
  return new Set(
    registrarOnlyServices(records, registrar)
      .filter((s) => s.kind !== "email_forwarding")
      .flatMap((s) => s.records.map(recordKey)),
  );
}

/** Ack key for one registrar-only service (`G5:email_forwarding`). */
export function registrarServiceAckKey(kind: RegistrarServiceKind): string {
  return `G5:${kind}`;
}
