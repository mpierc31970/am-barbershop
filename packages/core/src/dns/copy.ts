// packages/core/src/dns/copy.ts (P14, DOM-08, DOM-10, LIFE-01, ONB-10).
// Owner: 14-03 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// P14 copy: the one copy source for Domain, DNS records, email setup, the preview strip, the
// launch review, Leaving CDS, the staff Domain/Offboarding views, /test-dns and P14 mail
// (14-UI-SPEC "Copywriting Contract", "Voice", "Today and Needs you", "Emails"). Pure and
// browser/Edge-safe: no imports beyond types. Keys are the UI-SPEC copy IDs with "-" written
// as "_" (a "-T / -B" pair becomes `_T` and `_B`). Strings are verbatim. Where the UI-SPEC
// shows example data (riverabakery.com, GoDaddy, Google Workspace, 7, 3 Mar, 23 days) the
// value is a function of a typed slot object; the sentence shape is the contract. Dates and
// day counts arrive already formatted by the caller ("3 Mar", "14 Nov 2026").
// Never retype this copy in a component.

/** "1 record" / "7 records". */
function n(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

type Domain = { domain: string };
type Registrar = { registrar: string };
type DomainAt = Domain & Registrar;

/** The ten staff alert kinds of `staff.domain_alert` (14-03 choice 2). */
export type StaffDomainAlertKind =
  | "post_switch_mismatch"
  | "move_failed"
  | "gate_override_needed"
  | "handback_mismatch"
  | "ns_slow"
  | "expiry_7d"
  | "delegation_lost"
  | "launch_requested"
  | "dnssec_unknown"
  | "handback_overdue";

/** Move step keys (P14-P33), in order. */
export type MoveStepKey =
  | "snapshot"
  | "zone"
  | "gate"
  | "nameservers"
  | "delegation"
  | "site_records"
  | "edge"
  | "https"
  | "cutover"
  | "search";

/** Gate rules G1-G7 (P14-P10, UI-SPEC GateReport). */
export type GateRuleId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7";

export const P14_COPY = Object.freeze({
  // ---- Buttons (Copywriting Contract: primary CTAs and secondary actions) ----
  BTN_CHECK_DOMAIN: "Check my domain",
  BTN_CHECKING: "Checking…",
  BTN_IVE_CHANGED: "I've changed them",
  BTN_SEND_STEPS: "Send steps",
  BTN_ADD_RECORD: "Add record",
  BTN_NEXT: "Next",
  BTN_ADD_EMAIL_RECORDS: "Add email records",
  BTN_SAVE_SENDING: "Save sending address",
  BTN_SAVE_MAIN: "Save main address",
  BTN_READY_TO_LAUNCH: "Ready to launch",
  BTN_CONFIRM_DETAILS: "Confirm these details",
  BTN_SEND_TO_CDS: "Send to Support",
  BTN_RETRY_STEP: "Retry step",
  BTN_RETRYING: "Retrying…",
  BTN_START_MOVE: "Start move",
  BTN_OVERRIDE: "Override",
  BTN_MAKE_IT_LIVE: "Make it live",
  BTN_NOT_YET: "Not yet",
  BTN_TEST_DNS_CHANGE_NS: "Change nameservers to ours",
  BTN_USE_DIFFERENT_DOMAIN: "Use a different domain",
  BTN_ASK_SUPPORT: "Ask Support",
  BTN_CHECK_AGAIN: "Check again",
  BTN_ADD_ZONE_FILE_OWNER: "Add your zone file",
  BTN_SEND_STEPS_SOMEONE: "Send these steps to someone",
  BTN_DONT_SEND: "Don't send",
  BTN_CHECK_NOW: "Check now",
  BTN_SHOW_NAMESERVERS: "Show the nameservers again",
  BTN_SWITCHED_BACK: "I've switched them back",
  BTN_DNS_RECORDS: "DNS records",
  BTN_SET_UP_EMAIL: "Set up email for my domain",
  BTN_CHANGE_MAIN: "Change main address",
  BTN_KEEP_DOMAIN: ({ domain }: Domain) => `Keep ${domain}`,
  BTN_ADD_A_RECORD: "Add a record",
  BTN_DONT_ADD: "Don't add",
  BTN_REMOVE: "Remove",
  BTN_REMOVE_RECORD: "Remove record",
  BTN_KEEP_RECORD: "Keep record",
  BTN_ASK_TO_CHANGE: "Ask to change",
  BTN_CHANGE_EMAIL_SETUP: "Change email setup",
  BTN_ASK_CDS_SET_UP: "Ask Support to set it up",
  BTN_BACK: "Back",
  BTN_BACK_TO_RECORDS: "Back to DNS records",
  BTN_REVIEW_ON_PREVIEW: "Review on your preview address",
  BTN_SHOW_PAGES: "Show pages",
  BTN_SEE_REQUESTS: "See your requests",
  BTN_CONFIRM_YOUR_DETAILS: "Confirm your details",
  BTN_CHECK_ON_PHONE: "Check on your phone",
  BTN_CHECKED_ON_PHONE_ITEM: "I checked it on my phone",
  BTN_OPEN_REVIEW_MODE: "Open my site in review mode",
  BTN_SEND_TEST_MESSAGE: "Send a test message",
  BTN_COPY_LINK: "Copy link",
  BTN_OPEN_INBOX: "Open Inbox",
  BTN_LOOKS_GOOD: "Looks good",
  BTN_NEEDS_CHANGE: "Needs a change",
  BTN_PREVIOUS_PAGE: "Previous page",
  BTN_NEXT_PAGE: "Next page",
  BTN_BACK_TO_REVIEW: "Back to your review",
  BTN_BACK_TO_PAGE: "Back to the page",
  BTN_CHECKED_ON_PHONE: "Checked on my phone",
  BTN_OPEN_ON_PREVIEW: "Open on your preview address",
  BTN_COPY_PREVIEW_LINK: "Copy preview link",
  BTN_LEAVE_CDS: "Move away…",
  BTN_KEEP_MY_SITE: "Keep my site",
  BTN_OPEN_CHECKLIST: "Open checklist",
  BTN_DOWNLOAD_ZONE_FILE: "Download zone file",
  BTN_CHECK_NEW_DNS: "Check my new DNS",
  BTN_DOWNLOAD_DATA: "Download your data",
  BTN_STAY: "Stay with us",
  BTN_KEEP_LEAVING: "Keep leaving",
  BTN_START_NOTICE: "Start the 30-day notice",
  BTN_REPLACE_EMAIL: "Replace my current email",
  BTN_RETAKE_SNAPSHOT: "Re-take snapshot",
  BTN_ADD_ZONE_FILE_STAFF: "Add zone file",
  BTN_CANCEL_MOVE: "Cancel move",
  BTN_KEEP_MOVE: "Keep the move",
  BTN_MOVE_DOMAIN: "Move domain",
  BTN_NOT_NOW: "Not now",
  BTN_KEEP_BLOCK: "Keep the block",
  BTN_RERUN_POST_SWITCH: "Re-run post-switch check",
  BTN_START_OFFBOARDING: "Start offboarding",
  BTN_RERUN_HANDBACK: "Re-run handback check",
  BTN_CANCEL_OFFBOARDING: "Cancel offboarding",
  BTN_KEEP_OFFBOARDING: "Keep offboarding",

  // ---- Domain (S0-S8) ----
  EMPTY_H: "Connect your domain",
  DOM_CLOSED:
    "Domain connection opens soon. Support will email you when you can connect yours.",
  DOM_WHY_NOW:
    "Connect it now while Support builds your site, so launch day takes minutes. Your current website and email keep working until launch.",
  DOM_FIELD_HELP: "Just the name, like riverabakery.com. No https:// or www.",
  DOM_OWN:
    "Your domain stays registered in your name. Support never buys or transfers domains.",
  DOM_ADMIN_READ: "Only the owner can change the domain.",
  DOM_INVALID: "Enter a domain like riverabakery.com.",
  DOM_SUBDOMAIN:
    "Enter your main domain, like riverabakery.com, not a part of it like shop.riverabakery.com.",
  DOM_RESERVED: "That address is reserved. Enter your own domain.",
  DOM_TAKEN:
    "That domain is already connected to another site. If it's yours, ask Support.",
  DOM_NOT_REGISTERED: ({ domain }: Domain) =>
    `We couldn't find ${domain} registered anywhere. Check the spelling. If you haven't bought it yet, buy it from a registrar first.`,
  DOM_CF_REGISTRAR: ({ domain }: Domain) =>
    `${domain} is registered at Cloudflare, which doesn't allow its nameservers to change. Support will set it up with you.`,
  RDAP_UNKNOWN:
    "We couldn't see where it's registered. That's fine: you'll choose your registrar in a later step.",
  CHECKING_BODY: ({ domain }: Domain) =>
    `We're reading every DNS record on ${domain}, email first. This usually takes a minute or two. You can leave this page; we'll email you.`,
  EMAIL_FOUND: ({ provider, count }: { provider: string; count: number }) =>
    `We found your email at ${provider}. We'll copy these ${n(count, "record", "records")} exactly before anything changes.`,
  EMAIL_FOUND_UNKNOWN: ({ count }: { count: number }) =>
    `We found email on this domain. We'll copy these ${n(count, "record", "records")} exactly before anything changes.`,
  EMAIL_NONE: ({ count }: { count: number }) =>
    `We didn't find any email on this domain. We'll copy all ${n(count, "record", "records")} exactly before anything changes.`,
  COPY_SAFE: ({ registrar }: Registrar) =>
    `Your email keeps working the whole time. Support never changes your records at ${registrar}.`,
  FIND_DNSSEC_T: ({ registrar }: Registrar) =>
    `Turn off DNSSEC at ${registrar} first`,
  FIND_DNSSEC_B: ({ registrar }: Registrar) =>
    `DNSSEC is an extra lock on your DNS. If it's on when your nameservers change, your website and email stop working. Turn it off at ${registrar}, wait a few minutes, then check again.`,
  FIND_SPF_T: ({ count }: { count: number }) =>
    `Your domain has ${n(count, "SPF record", "SPF records")}. Email allows only one.`,
  FIND_SPF_B:
    "SPF lists who may send email for your domain. With two, other servers can reject your email. Your email provider can merge them into one, or Support can help.",
  FIND_FWD_T: ({ registrar }: Registrar) =>
    `Your email forwarding at ${registrar} stops when you switch.`,
  FIND_FWD_B: ({ registrar }: Registrar) =>
    `Forwarding only works on ${registrar}'s own DNS. Set up a mailbox first, or keep forwarding by setting it up with an email provider.`,
  FIND_WEBFWD_T: ({ registrar }: Registrar) =>
    `Your web forwarding at ${registrar} stops when you switch.`,
  FIND_WEBFWD_B: ({ registrar }: Registrar) =>
    `${registrar}'s forwarding only works on its own DNS. Once you switch, the domain shows your new site instead.`,
  FIND_G2_T: ({ provider }: { provider: string }) =>
    `We couldn't find all of your ${provider} records.`,
  FIND_G2_B:
    "Some email records are hard to see from outside. Add your zone file so we copy everything, or Support will check it with you.",
  FIND_CDS_T: ({ count }: { count: number }) =>
    `Support is reviewing ${n(count, "record", "records")} with you.`,
  FIND_CDS_B: ({ registrar }: Registrar) =>
    `We want every email record copied exactly before you switch. Nothing has changed at ${registrar}.`,
  FIND_CDS_WAIT: "We'll email you when it's done.",
  FIND_STILL_ON: ({ registrar }: Registrar) =>
    `Still on. Changes at ${registrar} can take a few minutes.`,
  GATE_PASS: "Every record matches. Your email keeps working when you switch.",
  ZONE_ADDED: ({ count }: { count: number }) =>
    `Zone file added. We found ${count} more ${count === 1 ? "record" : "records"} and added them to the copy.`,
  ZONE_TOO_BIG:
    "This file is too big for a zone file. Check you exported DNS records, not a full backup.",
  ZONE_UNREADABLE:
    "We couldn't read this as a zone file. Export it again as a text or BIND zone file, or skip this step.",
  ZONE_WRONG_DOMAIN: ({
    fileDomain,
    domain,
  }: { fileDomain: string } & Domain) =>
    `This zone file is for ${fileDomain}, not ${domain}.`,
  NS_REPLACE: ({ registrar }: Registrar) =>
    `At ${registrar}, replace every nameserver with these two. Remove any others.`,
  NS_SAFE:
    "Your current website and email keep working while the change spreads.",
  NS_NOT_YET:
    "We don't see the change yet. That's normal: it can take a while to spread. We'll keep checking and email you.",
  WAITING_BODY:
    "Usually under an hour, sometimes up to 48. We'll email you when it's done.",
  NS_SLOW: ({ registrar }: Registrar) =>
    `It's been 2 days. Check the nameservers at ${registrar} match these two exactly, or send the steps to someone who manages the domain.`,
  CONNECTED_READY: ({ domain }: Domain) =>
    `Ready. Goes live at ${domain} when Support approves your launch.`,
  LAUNCH_FINISHING:
    "We're finishing your launch. Your site stays on its preview address until it's done.",
  DOM_MOVE_HELP:
    "Moving to a different domain? Ask Support. Support moves it for you, and your old domain keeps sending visitors to the new one.",
  MISMATCH_T: ({ registrar }: Registrar) =>
    `Switch your nameservers back to ${registrar}'s`,
  MISMATCH_B: ({ count, registrar }: { count: number } & Registrar) =>
    `After the switch, ${n(count, "email record", "email records")} didn't match the copy. Your email keeps working at ${registrar}, because Support never changed anything there. Change your nameservers back now. Support has been alerted and will contact you today.`,
  SWITCHBACK_WAIT: "Waiting for the switch back. Usually under an hour.",
  LOST_T: ({ domain }: Domain) => `${domain} no longer points to us`,
  LOST_B: ({ registrar }: Registrar) =>
    `The nameservers at ${registrar} were changed. Your site and email may stop working. Change them back to these two, or ask Support.`,
  EXPIRY_30: ({ domain, registrar, date }: DomainAt & { date: string }) =>
    `Renew ${domain} at ${registrar} before ${date}, or your site and email stop.`,
  EXPIRY_7: ({ domain, registrar, date }: DomainAt & { date: string }) =>
    `Renew ${domain} at ${registrar}, or your site and email stop on ${date}.`,
  CHECK_FAILED: ({ domain }: Domain) =>
    `We couldn't read ${domain}'s records just now. We'll try again in a few minutes; nothing has changed.`,

  // ---- DNS records and email setup ----
  RECORDS_INTRO:
    "You can add or remove verification records yourself. Everything else is kept safe by Support. To change one, ask Support.",
  RECORDS_GROUP_EMPTY: "None yet.",
  REC_NAME_INVALID:
    "Use letters, numbers, dots, dashes or underscores, or @ for the domain itself.",
  REC_VALUE_EMPTY: "Paste the value the service gave you.",
  REC_EXISTS:
    "A record with that name already exists. Ask Support to change it.",
  REC_PROTECTED:
    "That name is kept safe by Support. Use Set up email for my domain, or ask Support.",
  REC_SPF:
    "That's an SPF record, which belongs to your email. Use Set up email for my domain instead.",
  REC_ADDED: ({ type }: { type: string }) =>
    `${type} record added. It can take a few minutes to show everywhere.`,
  REC_REMOVE_H: ({ type }: { type: string }) => `Remove this ${type} record?`,
  REC_REMOVE_B: ({ domain }: Domain) =>
    `Services that use it to check you own ${domain} may stop working. You can add it again later.`,
  REPLACE_WARN: ({ current, next }: { current: string; next: string }) =>
    `This replaces your current email at ${current}. New email goes to ${next} once the records update, usually within an hour, and stops arriving at ${current}.`,
  EMAIL_VALUE_FORMAT: ({
    service,
    prefix,
  }: {
    service: string;
    prefix: string;
  }) =>
    `That doesn't look like a ${service} verification value. It starts with ${prefix}.`,
  EMAIL_DONE_H: ({ provider }: { provider: string }) =>
    `Email records added for ${provider}`,
  EMAIL_DONE_B: ({ console }: { console: string }) =>
    `Finish in ${console}: click Verify. It can take up to an hour to work.`,
  EMAIL_WRITE_FAILED:
    "We couldn't add the records, so nothing changed. Try again in a minute.",
  SEND_PENDING: ({ domain }: Domain) =>
    `Setting up sending from ${domain}. This usually takes under an hour.`,
  SEND_ON: ({ address }: { address: string }) =>
    `Emails now send from ${address}.`,
  SEND_FAILED: ({ domain }: Domain) =>
    `We couldn't finish setting up sending from ${domain}. Support is checking it. Emails still send under your business name.`,
  SEND_LOCAL_INVALID:
    "Use letters, numbers, dots or dashes, like hello or bookings.",
  INTEG_PRELAUNCH: ({ domain }: Domain) =>
    `Search engines hear about your site once it's live on ${domain}. Your preview address is hidden from them on purpose.`,

  // ---- Main address and destructive dialogs ----
  CHANGE_MAIN_H: "Change your main address?",
  CHANGE_MAIN_B:
    "Visitors and search engines are sent to the new main address. Links to the old one keep working.",
  DIFFERENT_DOMAIN_H: "Use a different domain?",
  DIFFERENT_DOMAIN_B: ({ domain, registrar }: DomainAt) =>
    `We stop copying ${domain}. Nothing changed at ${registrar}.`,

  // ---- Preview strip and preview links ----
  STRIP: "Preview: this site is in development and not live yet.",
  STRIP_SHORT: "Preview: not live yet.",
  STRIP_DRAFT: "Preview: showing unpublished changes.",
  STRIP_EXPIRED: "Preview link expired. Showing the published version.",
  REVIEW_STRIP: ({
    page,
    total,
    title,
  }: {
    page: number;
    total: number;
    title: string;
  }) => `Review mode · Page ${page} of ${total} · ${title}`,
  PREVIEW_LINK_HELP:
    "Anyone with this link can see your unpublished changes for 60 minutes.",

  // ---- Launch review ----
  NOTE_SHORT: "Tell us a little more, at least 10 characters.",
  SUBMIT_H: ({ domain }: Domain) => `Your site goes live at ${domain}.`,
  DOMAIN_NOT_READY:
    "Your domain isn't ready yet. Finish connecting it in Settings › Domain.",
  SUBMITTED_H: "Support is giving it a final look.",
  SUBMITTED_B:
    "Usually within 1 business day. We'll email you the moment you're live. You can still edit, but changed pages need another look.",
  RESUBMIT: ({ title }: { title: string }) =>
    `You changed ${title} after sending. Look at it again so Support can launch.`,
  TESTFORM_DONE: "It's in your Inbox",
  TESTFORM_NA: "Your site has no form, so there's nothing to test.",
  FACTS_EMAIL: ({ email }: { email: string }) =>
    `Confirm your email address first. We sent the link to ${email}.`,
  ERR_SEND_STRIP: "That didn't save. Try again.",
  /** WR-D05: a server action that rejects (network, deploy skew, 500) in a client island. */
  ERR_GENERIC: "Something went wrong. Try again.",

  // ---- Leaving CDS ----
  LEAVE_INTRO:
    "We're sorry to see you go. Here's exactly what happens, in order.",
  IMPERSONATING_LEAVE:
    "You're viewing as support staff, so this is turned off. Only the owner can start leaving. Staff use the console.",
  BANNER: ({ days, next }: { days: number; next: string }) =>
    `Moving away · ${n(days, "day", "days")} left · Next: ${next}`,
  LOCKED: "Opens once your DNS has moved back.",
  HANDBACK_NA:
    "Your domain never moved to us, so there's nothing to hand back.",
  HANDBACK_AFTER: ({ registrar }: Registrar) =>
    `${registrar}'s DNS only answers after the switch. We'll check through public DNS straight after you change.`,
  HANDBACK_DONE: "Your DNS is back with you. Your email keeps working.",
  HANDBACK_MISMATCH: ({ count }: { count: number }) =>
    `${n(count, "email record", "email records")} ${count === 1 ? "is" : "are"} missing at your new DNS. Switch your nameservers back to ours until ${count === 1 ? "it's" : "they're"} added: your email keeps working there.`,
  ADDONS_NA: "Nothing to settle for your add-ons.",
  STAY_H: "Stay with us?",
  STAY_B:
    "Your notice is cancelled and everything carries on as before, including your price.",

  // ---- Staff ----
  CANCEL_DELEGATED:
    "Their DNS now lives with us. Hand it back first. The zone is kept; cancelling only stops the site steps.",
  APPROVE_BLOCKED: ({ waitingOn }: { waitingOn: string }) =>
    `Domain not prepared: ${waitingOn}.`,
  /** CR-D01: pages changed after Ready to launch, so the owner's send is stale. */
  APPROVE_RESEND: ({ count }: { count: number }) =>
    `The owner needs to send the review again: ${count} ${count === 1 ? "page" : "pages"} changed since.`,
  /** WR-C03: Approve launch's toast, by the move status after the first run. */
  APPROVE_LAUNCHING: ({ business }: { business: string }) =>
    `Launching ${business}. Follow it on Site › Domain.`,
  APPROVE_LIVE: ({ business }: { business: string }) => `${business} is live.`,
  APPROVE_STOPPED: ({ business, step }: { business: string; step: string }) =>
    `The launch of ${business} stopped at step ${step}. Open Site › Domain to retry.`,
  APPROVE_B: ({ business, domain }: { business: string } & Domain) =>
    `Make ${business} live at ${domain}? Support runs the last five domain steps (records, edge, HTTPS, switch, search). It takes a few minutes. Live is final once the switch finishes.`,
  STAFF_NO_DOMAIN: "No domain connected yet.",
  STAFF_NOT_LEAVING: ({ business }: { business: string }) =>
    `${business} isn't leaving.`,
  SUPER_ONLY: "Super Admin only",
  NO_OVERRIDE: "No override",

  // ---- /test-dns ----
  TEST_DNS_STRIP: "Test DNS page. No real DNS changes.",
  TEST_DNS_EMPTY: "No fake zones yet. Connect a domain in the hub first.",
  TEST_DNS_RUN_HINT:
    "Run `npm run domains:run` or wait for the next 5-minute run to see the hub change.",

  // ---- Mail first lines (UI-SPEC "Emails") ----
  MAIL_RECORDS_COPIED_S: ({ domain }: Domain) => `Next step for ${domain}`,
  MAIL_RECORDS_COPIED_B: ({ domain, registrar }: DomainAt) =>
    `Every record on ${domain} is copied, email included. Next: change your nameservers at ${registrar}.`,
  MAIL_STEPS_S: ({ domain }: Domain) => `Nameserver steps for ${domain}`,
  MAIL_STEPS_B: ({
    sender,
    business,
    domain,
  }: { sender: string; business: string } & Domain) =>
    `${sender} at ${business} asked you to change the nameservers for ${domain}.`,
  MAIL_CONNECTED_S: ({ domain }: Domain) => `${domain} is connected`,
  MAIL_CONNECTED_B: ({ domain }: Domain) =>
    `Your nameservers changed and your email records match. Your site goes live at ${domain} when Support approves your launch.`,
  MAIL_SWITCH_BACK_S: ({ domain }: Domain) =>
    `Action needed: switch ${domain}'s nameservers back`,
  MAIL_EXPIRY_S: ({ domain, date }: Domain & { date: string }) =>
    `Renew ${domain} by ${date}`,
  MAIL_REVIEW_SENT_S: "Support is giving your site a final look",
  MAIL_LEAVING_S: "Your 30-day notice has started",
  MAIL_LEAVING_B: ({ endsOn }: { endsOn: string }) =>
    `Your site stays up until ${endsOn}. First, move your DNS so your email keeps working.`,
  MAIL_HANDED_BACK_S: "Your DNS is back with you",
  MAIL_HANDBACK_OVERDUE_S: "Your DNS is still with us",
  MAIL_HANDBACK_OVERDUE_B:
    "Your notice has ended, but your DNS is still with us. Move it so we can close your site.",
} as const);

/** One-line explainers shown the first time a term appears on a screen (UI-SPEC "Voice"). */
export const JARGON = Object.freeze({
  domain: "Your address on the web, like riverabakery.com.",
  dnsRecords:
    "DNS records tell the internet where your website and email live.",
  nameservers:
    "Nameservers decide which company holds your DNS records. Changing them moves your records to us. Your domain stays registered where it is.",
  registrar: "The company you pay for your domain, like GoDaddy or Namecheap.",
  zoneFile:
    "A file from your registrar listing every DNS record on your domain.",
  mx: "MX records send your email to your email provider.",
  txt: "A TXT record is a short line of text. Services like Google use one to check you own the domain.",
  cname: "A CNAME record points one name on your domain to another address.",
  spf: "SPF lists who may send email for your domain.",
  dnssec:
    "DNSSEC is an extra lock on your DNS. It has to be off while your records move.",
  https:
    "The padlock in the browser. Support sets it up for you and keeps it renewed.",
} as const);

/** The owner allowlisted view of a move (S5b "Launch steps"), in order. */
export const OWNER_STEP_WORDS = ({ domain }: Domain): readonly string[] =>
  Object.freeze([
    "Records copied",
    "Nameservers changed",
    "Pointing your domain to your new site",
    "Setting up the secure connection",
    `Switching to ${domain}`,
    "Telling search engines",
  ]);

/** Which owner step word (index into OWNER_STEP_WORDS) each move step shows as. */
export const OWNER_STEP_FOR: Readonly<Record<MoveStepKey, number>> =
  Object.freeze({
    snapshot: 0,
    zone: 0,
    gate: 0,
    nameservers: 1,
    delegation: 1,
    site_records: 2,
    edge: 2,
    https: 3,
    cutover: 4,
    search: 5,
  });

/** Staff step names for the MoveTimeline (UI-SPEC staff Domain). */
export const STAFF_STEP_WORDS: Readonly<Record<MoveStepKey, string>> =
  Object.freeze({
    snapshot: "1 Snapshot",
    zone: "2 Zone",
    gate: "3 Gate",
    nameservers: "4 Nameservers",
    delegation: "5 Delegation verified",
    site_records: "6 Site records",
    edge: "7 Edge",
    https: "8 HTTPS",
    cutover: "9 Cutover",
    search: "10 Search",
  });

/** The marker row between step 5 and step 6. */
export const STAFF_PREPARED_WORDS = "Prepared (waits for launch approval)";

/** Gate rule staff names (UI-SPEC GateReport). */
export const GATE_RULE_NAMES: Readonly<Record<GateRuleId, string>> =
  Object.freeze({
    G1: "G1 Exact copy",
    G2: "G2 Mail provider complete",
    G3: "G3 DNSSEC off",
    G4: "G4 CAA allows Let's Encrypt",
    G5: "G5 Registrar-only services",
    G6: "G6 One SPF",
    G7: "G7 Fresh (≤ 24 h)",
  });

/** Words in the staff alert subject `[CDS] <business> · <kind words> · <domain>`. */
export const STAFF_ALERT_KIND_WORDS: Readonly<
  Record<StaffDomainAlertKind, string>
> = Object.freeze({
  post_switch_mismatch: "post-switch mismatch",
  move_failed: "move failed",
  gate_override_needed: "gate needs override",
  handback_mismatch: "handback mismatch",
  ns_slow: "nameservers slow",
  expiry_7d: "domain expires in 7 days",
  delegation_lost: "delegation lost",
  launch_requested: "launch requested",
  dnssec_unknown: "DNSSEC unknown",
  handback_overdue: "handback overdue",
});

type NeedsYouCopy = { title: string; sub: string; action: string };

/** Needs you items (UI-SPEC "Today and Needs you"). */
export const NEEDS_YOU = Object.freeze({
  connect: (): NeedsYouCopy => ({
    title: "Connect your domain",
    sub: "So launch day takes minutes.",
    action: "Connect your domain",
  }),
  dnssec: ({ registrar }: Registrar): NeedsYouCopy => ({
    title: `Turn off DNSSEC at ${registrar}`,
    sub: "Needed before your records can move.",
    action: "See how",
  }),
  forwarding: (): NeedsYouCopy => ({
    title: "Your email forwarding stops when you switch",
    sub: "Tell us you've read it.",
    action: "Review",
  }),
  nameservers: ({ registrar }: Registrar): NeedsYouCopy => ({
    title: `Change your nameservers at ${registrar}`,
    sub: "Two values to paste. About 5 minutes.",
    action: "See the steps",
  }),
  switchBack: ({ registrar }: Registrar): NeedsYouCopy => ({
    title: "Switch your nameservers back",
    sub: `Your email is safer at ${registrar}.`,
    action: "See what to do",
  }),
  lostDelegation: ({ domain }: Domain): NeedsYouCopy => ({
    title: `${domain} no longer points to us`,
    sub: "Your site and email may stop.",
    action: "See what to do",
  }),
  renew: ({
    domain,
    registrar,
    date,
  }: DomainAt & { date: string }): NeedsYouCopy => ({
    title: `Renew ${domain} at ${registrar}`,
    sub: `Expires ${date}.`,
    action: "How to renew",
  }),
  review: ({ done, total }: { done: number; total: number }): NeedsYouCopy => ({
    title: "Review your site before it goes live",
    sub: `${done} of ${total} done`,
    action: "Continue review",
  }),
  leavingDns: (): NeedsYouCopy => ({
    title: "Move your DNS before you leave",
    sub: "Your email depends on it.",
    action: "Start",
  }),
});
