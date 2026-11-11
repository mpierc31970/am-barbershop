// /contact form contract (15-19; HUB-07, HUB-03; A3-Q2, D-UI-P15-19, D-UI-P15-20; UI-SPEC
// "Contact"). Pure and browser-safe: the client form, the page's prefill and the server action
// share the field names, the caps, the copy and the validator, so a crafted POST meets the same
// rules as the form. ("use server" files may export only async functions, so none of this lives
// in actions/contact.ts.) Every visible string comes from MK_COPY.CONTACT (@cds/core/marketing).
// The repository (createHubInquiry) validates the same fields again (T-15-19-02).
import { isEmail } from "@cds/core/email";
import { contactAboutPrefill, MK_COPY, SHOP_SOON } from "@cds/core/marketing";

/** Caps (migration 1790000900 / HUB_INQUIRY_LIMITS; P15-P14). */
export const NAME_MAX = 100;
export const EMAIL_MAX = 254;
export const BUSINESS_MAX = 120;
export const PHONE_MAX = 40;
export const ABOUT_MAX = 60;
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;
export const CONTACT_TOKEN_MAX = 2048;

export const CONTACT_TOPICS = ["question", "call", "press"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

/** Field names, in on-screen order (the error summary lists errors in this order). */
export const CONTACT_FIELDS = [
  "name",
  "email",
  "business",
  "topic",
  "phone",
  "message",
] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

/** DOM id for each field (the error summary links to `#<id>`; topic is the fieldset). */
export const CONTACT_FIELD_IDS: Readonly<Record<ContactField, string>> =
  Object.freeze({
    name: "contact-name",
    email: "contact-email",
    business: "contact-business",
    topic: "contact-topic",
    phone: "contact-phone",
    message: "contact-message",
  });

/** The two fixed `?about=` keys beside the public add-on slugs (D-UI-P15-20). */
const FIXED_ABOUT: Readonly<Record<string, string>> = Object.freeze({
  [SHOP_SOON.key]: SHOP_SOON.name,
  // The footer label for /independent-pros (MK_COPY.FOOTER), so no new string is invented.
  "independent-pro": "Independent pros",
});

/** Raw form values as strings (what the client keeps between submits). */
export type ContactValues = {
  name: string;
  email: string;
  business: string;
  topic: string;
  phone: string;
  about: string;
  message: string;
};

export const EMPTY_CONTACT_VALUES: ContactValues = Object.freeze({
  name: "",
  email: "",
  business: "",
  topic: "",
  phone: "",
  about: "",
  message: "",
});

export type ContactFieldErrors = Partial<Record<ContactField, string>>;

export type ContactState =
  | {
      status: "idle";
      /** One form-level message (rate limit, Turnstile, send failure). */
      error: string | null;
      fieldErrors: ContactFieldErrors;
      /** Every value as sent, so a failed submit (even without JS) keeps the text. */
      values: ContactValues;
    }
  | { status: "sent"; email: string; isCall: boolean };

export const INITIAL_CONTACT_STATE: ContactState = Object.freeze({
  status: "idle",
  error: null,
  fieldErrors: {},
  values: EMPTY_CONTACT_VALUES,
});

/** What createHubInquiry takes, minus the IP (shape mirrored so the client never imports @cds/db). */
export type ValidContact = {
  name: string;
  email: string;
  business: string;
  topic: ContactTopic;
  /** "" unless the topic is `call` (choice 2: the phone is dropped otherwise). */
  phone: string;
  about: string;
  message: string;
};

/** Shape of an add-on slug or a fixed about key; the page allow-lists it against the catalog. */
const ABOUT_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
/** Single-line fields lose control characters (line breaks included). */
const CONTROL_RE = /[\u0000-\u001f\u007f]+/g;

export function isContactTopic(v: unknown): v is ContactTopic {
  return (
    typeof v === "string" && (CONTACT_TOPICS as readonly string[]).includes(v)
  );
}

function line(v: unknown): string {
  return typeof v === "string" ? v.replace(CONTROL_RE, " ").trim() : "";
}

/** Trim every value (the server never trusts the client's trimming). */
export function trimContactValues(v: ContactValues): ContactValues {
  return {
    name: line(v.name),
    email: line(v.email).toLowerCase(),
    business: line(v.business),
    topic: line(v.topic),
    phone: line(v.phone),
    about: line(v.about).toLowerCase(),
    message: typeof v.message === "string" ? v.message.trim() : "",
  };
}

/**
 * Check one inquiry (choice 1). Name, email, topic and a 10-2,000 character message are
 * required. Business and phone are optional and cut to their caps (the inputs carry maxLength;
 * the UI-SPEC has no error line for them). The phone is kept only for the call topic; `about`
 * is kept only when it has the slug shape.
 */
export function validateContact(raw: ContactValues): {
  fieldErrors: ContactFieldErrors;
  contact: ValidContact | null;
} {
  const C = MK_COPY.CONTACT;
  const v = trimContactValues(raw);
  const e: ContactFieldErrors = {};

  if (v.name === "" || v.name.length > NAME_MAX) e.name = C.ERR_NAME;
  // 15 WR-A03: the repository's own validator (createHubInquiry runs isEmail too), so an
  // address the repository would refuse fails here, inline on Email, before the rate limit
  // and Turnstile are spent.
  if (v.email === "" || v.email.length > EMAIL_MAX || !isEmail(v.email))
    e.email = C.ERR_EMAIL;
  const topic = isContactTopic(v.topic) ? v.topic : null;
  if (!topic) e.topic = C.ERR_TOPIC;
  if (v.message.length < MESSAGE_MIN) e.message = C.ERR_MESSAGE_SHORT;
  else if (v.message.length > MESSAGE_MAX) e.message = C.ERR_MESSAGE_LONG;

  if (Object.keys(e).length > 0 || !topic) {
    return { fieldErrors: e, contact: null };
  }
  return {
    fieldErrors: {},
    contact: {
      name: v.name,
      email: v.email,
      business: v.business.slice(0, BUSINESS_MAX).trim(),
      topic,
      phone: topic === "call" ? v.phone.slice(0, PHONE_MAX).trim() : "",
      about:
        v.about.length <= ABOUT_MAX && ABOUT_RE.test(v.about) ? v.about : "",
      message: v.message,
    },
  };
}

/** Read the form's values from FormData. */
export function contactValuesFrom(fd: FormData): ContactValues {
  const s = (name: string, max: number) => {
    const x = fd.get(name);
    // Cut far above every cap so an oversized value still fails validation, never passes.
    return typeof x === "string" ? x.slice(0, max * 2 + 1) : "";
  };
  return {
    name: s("name", NAME_MAX),
    email: s("email", EMAIL_MAX),
    business: s("business", BUSINESS_MAX),
    topic: s("topic", 16),
    phone: s("phone", PHONE_MAX),
    about: s("about", ABOUT_MAX),
    message: s("message", MESSAGE_MAX),
  };
}

type SearchParams = Record<string, string | string[] | undefined>;

/** An entry the prefill can name (CatalogEntry's relevant fields). */
export type ContactAboutEntry = {
  slug: string;
  name: string;
  private?: boolean;
};

function first(v: string | string[] | undefined): string {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x.trim() : "";
}

/**
 * `?topic=` and `?about=` → the form's starting values (D-UI-P15-20, T-15-19-03). `topic` must be
 * one of the three topics. `about` must be a public add-on slug (in `publicSlugs`, found in `view`,
 * not private) or one of the two fixed keys (`shop`, `independent-pro`); the message is then
 * "I'd like to know more about <catalog name>." Anything else is ignored.
 */
export function contactPrefill(
  searchParams: SearchParams,
  publicSlugs: ReadonlySet<string>,
  view: readonly ContactAboutEntry[],
): { topic: string; about: string; message: string } {
  const t = first(searchParams.topic).toLowerCase();
  const topic = isContactTopic(t) ? t : "";

  const a = first(searchParams.about).toLowerCase();
  let name: string | null = null;
  if (a !== "" && a.length <= ABOUT_MAX) {
    if (Object.hasOwn(FIXED_ABOUT, a)) name = FIXED_ABOUT[a] ?? null;
    else if (publicSlugs.has(a)) {
      const entry = view.find((e) => e.slug === a);
      if (entry && !entry.private) name = entry.name;
    }
  }
  return name
    ? { topic, about: a, message: contactAboutPrefill(name) }
    : { topic, about: "", message: "" };
}
