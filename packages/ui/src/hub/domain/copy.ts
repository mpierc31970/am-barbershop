// Hub domain UI chrome copy (14-30; 14-UI-SPEC "S0-S3", "DNS records", "Leaving CDS",
// "Accessibility contract"). Labels, column names, badge words and small sentences the
// components own. Every sentence with a UI-SPEC copy id (DOM-*, FIND-*, NS-*, …) comes from
// `P14_COPY` in `@cds/core/dns` and is never retyped here (14-03 owns that file).

export type DomainStatusTone =
  | "none"
  | "checking"
  | "your-turn"
  | "cds"
  | "finishing"
  | "waiting"
  | "ready"
  | "live"
  | "broken"
  | "renew-soon";

/** Badge words of the owner domain tone map (UI-SPEC "Owner domain tone map"). */
export const DOMAIN_STATUS_WORDS: Readonly<Record<DomainStatusTone, string>> =
  Object.freeze({
    none: "Not connected",
    checking: "Checking",
    "your-turn": "Your turn",
    cds: "CDS is reviewing",
    finishing: "Finishing",
    waiting: "Waiting",
    ready: "Ready",
    live: "Live",
    broken: "Needs action now",
    "renew-soon": "Renew soon",
  });

export type RecordGroupKey =
  | "email"
  | "copy_exactly"
  | "verification"
  | "site"
  | "points_to_cds"
  | "sending"
  | "cds_sending"
  | "other";

export type RecordManager = "cds" | "email" | "yours";

export type RecordStatus =
  "copied" | "checking" | "added" | "pending" | "found" | "not_found";

export type RecordChange = "add" | "replace" | "update";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export const DOMAIN_UI_COPY = Object.freeze({
  domainLabel: "Your domain",
  weUse: (domain: string) => `We'll use ${domain}.`,
  dontHaveOne: "Don't have one yet?",
  registeredAt: "Registered at",
  inYourName: ", in your name.",
  renews: "Renews",
  groups: Object.freeze({
    email: "Your email",
    copy_exactly: "Copy exactly",
    verification: "Verification",
    site: "Your site",
    points_to_cds: "Points to CDS: change when your new site is ready",
    sending: "Sending email from your domain",
    cds_sending: "CDS sending records: remove",
    other: "Other",
  } satisfies Record<RecordGroupKey, string>),
  groupCount: (count: number) => plural(count, "record", "records"),
  caption: (group: string, count: number) =>
    `${group}: ${plural(count, "record", "records")}`,
  emailEmpty: "No email records found.",
  emailEmptyManage: "No email records. Set up email for my domain to add them.",
  siteNote: "These keep showing your current website until launch day.",
  copyExactlyNote: "Your email records are in Copy exactly. Copy them first.",
  cdsRowNote: "CDS keeps this record right for your site.",
  colType: "Type",
  colName: "Name",
  colValue: "Value",
  colStatus: "Status",
  colManager: "Who manages it",
  colChange: "Change",
  colAction: "Action",
  managers: Object.freeze({
    cds: "Managed by CDS",
    email: "Your email",
    yours: "Yours",
  } satisfies Record<RecordManager, string>),
  statuses: Object.freeze({
    copied: "Copied",
    checking: "Checking",
    added: "Added by CDS",
    pending: "Doesn't match yet",
    found: "Found at your new DNS",
    not_found: "Not found yet",
  } satisfies Record<RecordStatus, string>),
  changes: Object.freeze({
    add: "Add",
    replace: "Replace",
    update: "Update",
  } satisfies Record<RecordChange, string>),
  showFull: "Show full value",
  showLess: "Show less",
  removeName: (type: string, name: string) =>
    `Remove ${type} record for ${name}`,
  askName: (type: string, name: string) =>
    `Ask to change ${type} record for ${name}`,
  hardBlock: "This step can't be skipped.",
  registrarSelect: "Where is your domain registered?",
  nameserver: (n: number) => `Nameserver ${n}`,
  nameservers: "Nameservers",
  copy: "Copy",
  copyNameserver: (n: number) => `Copy nameserver ${n}`,
  copiedNameserver: (n: number) => `Copied nameserver ${n}`,
  sendBody: (domain: string, registrar: string) =>
    `For the person who manages ${domain}. They get the two nameservers and the steps for ${registrar}.`,
  theirEmail: "Their email",
  addNote: "Add a note (optional)",
  sending: "Sending…",
  invalidEmail: "Enter an email address like name@example.com.",
  sent: (email: string) => `Steps sent to ${email}.`,
  mainAddress: "Your main address",
  apexDescription: (domain: string) =>
    `Recommended. www.${domain} sends visitors here.`,
  wwwDescription: (domain: string) => `${domain} sends visitors here.`,
});
