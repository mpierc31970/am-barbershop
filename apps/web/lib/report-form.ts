// /report form contract (STAFF-24, D249, P13-P24; 13-UI-SPEC "Report page" lines 959-979).
// Pure and browser-safe: the client form and the server action share the field names, the
// caps, the copy and the validator, so a crafted POST meets the same rules as the form.
// ("use server" files may export only async functions, so none of this lives there.)
//
// The DMCA statement wording is DRAFT (UI-SPEC: "verbatim legal wording from the DRAFT
// policy; marked DRAFT until reviewed"). No published policy carries checkbox wording yet,
// so it lives here with the DRAFT mark until the lawyer review (GO-LIVE legal row).

export const REPORT_CATEGORIES = [
  "copyright",
  "scam",
  "illegal",
  "other",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** Caps (T-13-30-01). The case description is one field of at most 5,000 characters. */
export const REPORT_URL_MAX = 2000;
export const REPORT_HOST_MAX = 253;
export const REPORT_DESCRIPTION_MIN = 20;
export const REPORT_DESCRIPTION_MAX = 2000;
export const REPORT_ORIGINAL_MAX = 2000;
export const REPORT_NAME_MAX = 200;
export const REPORT_EMAIL_MAX = 254;
export const REPORT_SIGNATURE_MAX = 200;
export const REPORT_TOKEN_MAX = 2048;

/** Field names, in on-screen order (the error summary lists errors in this order). */
export const REPORT_FIELDS = [
  "category",
  "site",
  "url",
  "description",
  "name",
  "email",
  "originalWork",
  "goodFaith",
  "accuracy",
  "signature",
] as const;
export type ReportField = (typeof REPORT_FIELDS)[number];

/** DOM id for each field (the error summary links to `#<id>`). */
export const REPORT_FIELD_IDS: Readonly<Record<ReportField, string>> =
  Object.freeze({
    category: "report-category-copyright",
    site: "report-site",
    url: "report-url",
    description: "report-description",
    name: "report-name",
    email: "report-email",
    originalWork: "report-original",
    goodFaith: "report-good-faith",
    accuracy: "report-accuracy",
    signature: "report-signature",
  });

export const REPORT_COPY = {
  TITLE: "Report a problem",
  INTRO: "Tell us about content on a site CDS hosts. We review every report.",
  CATEGORY_LEGEND: "What are you reporting?",
  CATEGORY: {
    copyright: {
      title: "Copyright",
      description: "Someone used your work without permission.",
    },
    scam: { title: "Scam or fraud" },
    illegal: { title: "Illegal content" },
    other: { title: "Something else" },
  },
  SITE: "Site",
  URL: "Page address",
  DESCRIPTION: "What's wrong?",
  CONTACT_LEGEND: "Your contact",
  NAME: "Name",
  EMAIL: "Email",
  DMCA_LEGEND: "Copyright notice",
  DRAFT_MARK: "DRAFT: this wording has not been reviewed by a lawyer yet.",
  ORIGINAL: "Your original work",
  ORIGINAL_HELPER: "Where is it? A link or a short description.",
  DMCA_GOODFAITH:
    "I have a good-faith belief that the use described above is not authorized by the copyright owner, its agent or the law.",
  DMCA_ACCURATE:
    "The information in this notice is accurate, and under penalty of perjury, I am the copyright owner or authorized to act on the owner's behalf.",
  SIGNATURE: "Signature",
  SIGNATURE_HELPER: "Type your full name",
  SEND: "Send report",
  SENDING: "Sending…",
  ERROR_SUMMARY: "Check these and send again:",
  SENT_H: "Report received",
  SENT_BODY:
    "Your report number is {ref}. We sent a copy to {email}. CDS reviews reports within 2 business days.",
  SENT_BODY_NO_EMAIL:
    "Your report number is {ref}. CDS reviews reports within 2 business days.",
  AGAIN: "Report something else",
  ERR_CATEGORY: "Pick what you're reporting.",
  ERR_URL: "Enter the full page address, starting with https://",
  ERR_SITE: "Enter the site's address, like example.com.",
  ERR_DESCRIPTION_SHORT: "Tell us what's wrong in at least 20 characters.",
  ERR_DESCRIPTION_LONG: "Keep it under 2,000 characters.",
  ERR_ORIGINAL_LONG: "Keep it under 2,000 characters.",
  ERR_NAME: "Enter your name.",
  ERR_NAME_LONG: "Keep your name under 200 characters.",
  ERR_EMAIL: "Enter a valid email address.",
  ERR_GOODFAITH: "Tick the good-faith statement.",
  ERR_ACCURATE: "Tick the accuracy statement.",
  ERR_SIGNATURE: "Type your full name as your signature.",
  ERR_SIGNATURE_LONG: "Keep your signature under 200 characters.",
  ERR_SEND:
    "That didn't send. Check your connection and try again. Your text is kept.",
} as const;

/** Raw form values as strings/booleans (what the client keeps between submits). */
export type ReportValues = {
  category: string;
  site: string;
  url: string;
  description: string;
  name: string;
  email: string;
  originalWork: string;
  goodFaith: boolean;
  accuracy: boolean;
  signature: string;
};

export const EMPTY_REPORT_VALUES: ReportValues = Object.freeze({
  category: "",
  site: "",
  url: "",
  description: "",
  name: "",
  email: "",
  originalWork: "",
  goodFaith: false,
  accuracy: false,
  signature: "",
});

export type ReportFieldErrors = Partial<Record<ReportField, string>>;

export type ReportState =
  | {
      status: "idle";
      /** One form-level message (rate limit, Turnstile, send failure). */
      error: string | null;
      fieldErrors: ReportFieldErrors;
    }
  | { status: "sent"; ref: string; email: string | null };

export const INITIAL_REPORT_STATE: ReportState = Object.freeze({
  status: "idle",
  error: null,
  fieldErrors: {},
});

/** What createPublicReport takes (shape mirrored here so the client never imports @cds/db). */
export type ValidReport = {
  targetUrl: string;
  category: ReportCategory;
  description: string;
  reporterName: string | null;
  reporterEmail: string;
  dmcaStatement: {
    goodFaith: true;
    accuracy: true;
    signature: string;
  } | null;
};

const HOST_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const LOCAL_HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*localhost$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A bare host (no scheme or path; an optional port, as dev footers carry one), lower-cased;
 * null when it is not one.
 */
export function cleanHost(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^([^:/?#\s]+?)\.?(?::(\d{1,5}))?$/.exec(v.trim().toLowerCase());
  if (!m) return null;
  const host = m[1]!;
  if (host.length > REPORT_HOST_MAX) return null;
  if (!HOST_RE.test(host) && !LOCAL_HOST_RE.test(host)) return null;
  const port = m[2] ? Number(m[2]) : null;
  if (port !== null && (port < 1 || port > 65535)) return null;
  return port !== null ? `${host}:${port}` : host;
}

/** `?site=<host>` → `https://<host>/`, or "" when the value is not a host. */
export function prefillUrl(site: unknown): string {
  const host = cleanHost(site);
  return host ? `https://${host}/` : "";
}

/** The page address parsed with URL: http/https only, ≤ 2,000 characters. */
export function parseReportUrl(v: string): URL | null {
  if (v === "" || v.length > REPORT_URL_MAX) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.hostname === "") return null;
  return u;
}

function isCategory(v: string): v is ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(v);
}

function sameSite(a: string, b: string): boolean {
  const strip = (h: string) => h.replace(/^www\./, "");
  return strip(a) === strip(b);
}

/** Trim every text value (the server never trusts the client's trimming). */
export function trimReportValues(v: ReportValues): ReportValues {
  const t = (s: unknown) => (typeof s === "string" ? s.trim() : "");
  return {
    category: t(v.category),
    site: t(v.site),
    url: t(v.url),
    description: t(v.description),
    name: t(v.name),
    email: t(v.email).toLowerCase(),
    originalWork: t(v.originalWork),
    goodFaith: v.goodFaith === true,
    accuracy: v.accuracy === true,
    signature: t(v.signature),
  };
}

/**
 * Check one report (choice 3). Copyright needs a name, both statements and a signature.
 * The original-work line and a differing Site are folded into the case description,
 * which createPublicReport caps at 5,000 characters (2,000 + 2,000 + labels fits).
 */
export function validateReport(raw: ReportValues): {
  fieldErrors: ReportFieldErrors;
  report: ValidReport | null;
} {
  const v = trimReportValues(raw);
  const e: ReportFieldErrors = {};
  const category = isCategory(v.category) ? v.category : null;
  if (!category) e.category = REPORT_COPY.ERR_CATEGORY;
  const copyright = category === "copyright";

  let siteHost: string | null = null;
  if (v.site !== "") {
    siteHost = cleanHost(v.site);
    if (!siteHost) e.site = REPORT_COPY.ERR_SITE;
  }
  const url = parseReportUrl(v.url);
  if (!url) e.url = REPORT_COPY.ERR_URL;

  if (v.description.length < REPORT_DESCRIPTION_MIN)
    e.description = REPORT_COPY.ERR_DESCRIPTION_SHORT;
  else if (v.description.length > REPORT_DESCRIPTION_MAX)
    e.description = REPORT_COPY.ERR_DESCRIPTION_LONG;

  if (v.name.length > REPORT_NAME_MAX) e.name = REPORT_COPY.ERR_NAME_LONG;
  else if (copyright && v.name === "") e.name = REPORT_COPY.ERR_NAME;

  if (
    v.email === "" ||
    v.email.length > REPORT_EMAIL_MAX ||
    !EMAIL_RE.test(v.email)
  )
    e.email = REPORT_COPY.ERR_EMAIL;

  if (copyright) {
    if (v.originalWork.length > REPORT_ORIGINAL_MAX)
      e.originalWork = REPORT_COPY.ERR_ORIGINAL_LONG;
    if (!v.goodFaith) e.goodFaith = REPORT_COPY.ERR_GOODFAITH;
    if (!v.accuracy) e.accuracy = REPORT_COPY.ERR_ACCURATE;
    if (v.signature === "") e.signature = REPORT_COPY.ERR_SIGNATURE;
    else if (v.signature.length > REPORT_SIGNATURE_MAX)
      e.signature = REPORT_COPY.ERR_SIGNATURE_LONG;
  }

  if (Object.keys(e).length > 0 || !category || !url) {
    return { fieldErrors: e, report: null };
  }

  const parts = [v.description];
  if (copyright && v.originalWork !== "")
    parts.push(`Original work: ${v.originalWork}`);
  if (siteHost && !sameSite(siteHost, url.host))
    parts.push(`Site named by the reporter: ${siteHost}`);

  return {
    fieldErrors: {},
    report: {
      targetUrl: url.toString(),
      category,
      description: parts.join("\n\n"),
      reporterName: v.name === "" ? null : v.name,
      reporterEmail: v.email,
      dmcaStatement: copyright
        ? { goodFaith: true, accuracy: true, signature: v.signature }
        : null,
    },
  };
}

/** Read the form's values from FormData (checkboxes are "on" when ticked). */
export function reportValuesFrom(fd: FormData): ReportValues {
  const s = (name: string, max: number) => {
    const x = fd.get(name);
    // Cut far above every cap so an oversized value still fails validation, never passes.
    return typeof x === "string" ? x.slice(0, max * 2 + 1) : "";
  };
  return {
    category: s("category", 32),
    site: s("site", REPORT_HOST_MAX),
    url: s("url", REPORT_URL_MAX),
    description: s("description", REPORT_DESCRIPTION_MAX),
    name: s("name", REPORT_NAME_MAX),
    email: s("email", REPORT_EMAIL_MAX),
    originalWork: s("originalWork", REPORT_ORIGINAL_MAX),
    goodFaith: fd.get("goodFaith") === "on",
    accuracy: fd.get("accuracy") === "on",
    signature: s("signature", REPORT_SIGNATURE_MAX),
  };
}
