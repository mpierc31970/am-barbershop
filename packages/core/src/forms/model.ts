// The form model: field types, limits, reserved payload names, exact copy and FormErrors
// (CONT-25, D231, D233, D271; 07-15).
//
// Pure and Edge-safe: no node:*, no @cds/db. Shared by the db forms engine (07-15), the forms
// builder (07-18) and the public form (07-19), so the copy and the rules are typed once.
import { InvalidInput } from "../errors";
import type { EmailPurpose } from "../email/types";

/** Every field type, in editor order. `file` is a Builder Pro type (BILL-14, D233). */
export const FORM_FIELD_TYPES = Object.freeze([
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
  "name",
  "address",
  "dropdown",
  "radio",
  "checkboxes",
  "yes_no",
  "date",
  "time",
  "agreement",
  "heading",
  "paragraph",
  "hidden",
  "file",
] as const);

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export type FormFieldGroup = {
  readonly label: string;
  readonly pro?: true;
  readonly types: readonly { type: FormFieldType; label: string }[];
};

/** The "Add field" menu (07-UI-SPEC Forms editor). */
export const FORM_FIELD_GROUPS: readonly FormFieldGroup[] = Object.freeze([
  {
    label: "Text",
    types: [
      { type: "short_text", label: "Short answer" },
      { type: "long_text", label: "Long answer" },
      { type: "email", label: "Email" },
      { type: "phone", label: "Phone" },
      { type: "number", label: "Number" },
      { type: "name", label: "Name" },
      { type: "address", label: "Address" },
    ],
  },
  {
    label: "Choices",
    types: [
      { type: "dropdown", label: "Dropdown" },
      { type: "radio", label: "Multiple choice" },
      { type: "checkboxes", label: "Checkboxes" },
      { type: "yes_no", label: "Yes or no" },
    ],
  },
  {
    label: "Date and time",
    types: [
      { type: "date", label: "Date" },
      { type: "time", label: "Time" },
    ],
  },
  {
    label: "Other",
    types: [
      { type: "agreement", label: "Agreement checkbox" },
      { type: "heading", label: "Heading" },
      { type: "paragraph", label: "Paragraph" },
      { type: "hidden", label: "Hidden value" },
    ],
  },
  {
    label: "File upload",
    pro: true,
    types: [{ type: "file", label: "File upload" }],
  },
]);

/** The type names shown in the field list ("Short answer", ...). */
export const FORM_FIELD_TYPE_LABELS: Readonly<Record<FormFieldType, string>> =
  Object.freeze(
    Object.fromEntries(
      FORM_FIELD_GROUPS.flatMap((g) => g.types.map((t) => [t.type, t.label])),
    ) as Record<FormFieldType, string>,
  );

/** Types a visitor answers. */
export const INPUT_TYPES: ReadonlySet<FormFieldType> = new Set<FormFieldType>([
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
  "name",
  "address",
  "dropdown",
  "radio",
  "checkboxes",
  "yes_no",
  "date",
  "time",
  "agreement",
]);
export const CHOICE_TYPES: ReadonlySet<FormFieldType> = new Set<FormFieldType>([
  "dropdown",
  "radio",
  "checkboxes",
]);
export const DISPLAY_TYPES: ReadonlySet<FormFieldType> = new Set<FormFieldType>(
  ["heading", "paragraph"],
);
export const PRO_TYPES: ReadonlySet<FormFieldType> = new Set<FormFieldType>([
  "file",
]);
/** Types with a placeholder (text-like inputs). */
export const PLACEHOLDER_TYPES: ReadonlySet<FormFieldType> =
  new Set<FormFieldType>([
    "short_text",
    "long_text",
    "email",
    "phone",
    "number",
    "name",
  ]);

export type FormLayout = "1" | "2";

export type FormField = {
  id: string;
  type: FormFieldType;
  label: string;
  placeholder: string;
  help: string;
  required: boolean;
  full_width: boolean;
  options: string[];
  /** Heading / paragraph text, or the agreement wording. */
  content: string;
  /** Hidden value (never sent to visitors). */
  value: string;
};

export type AfterSubmit = {
  kind: "message" | "page";
  message: string;
  page: string;
  button_text: string;
};

export type FormNotifyRoute = EmailPurpose;

export type FormDefinition = {
  name: string;
  layout: FormLayout;
  fields: FormField[];
  after_submit: AfterSubmit;
  notify_route: FormNotifyRoute;
  newsletter_checkbox: boolean;
  newsletter_wording: string;
  /** Forms Pro settings (BILL-14, D233). Kept when Builder Pro lapses; ignored while inactive. */
  pro?: FormProSettings;
};

// ---- Forms Pro (BILL-14, D233; 10-34) ----
export const PRO_RULE_OPS = Object.freeze([
  "is",
  "is_not",
  "contains",
  "answered",
  "not_answered",
] as const);
export type ProRuleOp = (typeof PRO_RULE_OPS)[number];

/** Show or hide `target` when an earlier field matches (10-34 choice 1). */
export type ProRule = {
  target: string;
  action: "show" | "hide";
  when: { field: string; op: ProRuleOp; value: string };
};

/** One page of a multi-step form (10-34 choice 2). */
export type ProStep = { id: string; title: string; fields: string[] };

export type ProAutoReply = { enabled: boolean; subject: string; body: string };

/** Send to a different email route when `field` is `value` (10-34 choice 4). */
export type ProRoute = { field: string; value: string; route: EmailPurpose };

export type FormProSettings = {
  rules: ProRule[];
  steps: ProStep[];
  auto_reply: ProAutoReply;
  routing: ProRoute[];
  save_resume: boolean;
};

/** What visitors get of the Pro settings: never auto-reply or routing (T-10-34-03). */
export type PublicFormPro = {
  rules: ProRule[];
  steps: ProStep[];
  save_resume: boolean;
};

export const MAX_PRO_RULES = 50;
export const MAX_PRO_STEPS = 10;
export const MAX_STEP_TITLE = 60;
export const MAX_RULE_VALUE = 120;
export const MAX_AUTO_REPLY_SUBJECT = 120;
export const MAX_AUTO_REPLY_BODY = 2000;
export const MAX_PRO_ROUTES = 10;
/** Save-and-finish-later drafts expire after 30 days (10-37). */
export const FORM_DRAFT_TTL_DAYS = 30;

export const PRO_SETTINGS_COPY =
  "Part of Builder Pro. Show or hide rules, steps, auto-replies, answer routing and save and finish later come with Builder Pro.";
export const RULE_FIELD_COPY =
  "A rule can only use a field that comes before the field it shows or hides.";
export const RULE_TARGET_COPY =
  "A rule points at a field that isn't on this form.";
export const RULE_VALUE_COPY = "Add the answer this rule looks for.";
export const RULES_LIMIT_COPY = `Keep rules to ${MAX_PRO_RULES} or fewer.`;
export const STEPS_LIMIT_COPY = `Forms hold up to ${MAX_PRO_STEPS} steps.`;
export const STEP_FIELDS_COPY = "Put every field in exactly one step.";
export const STEP_TITLE_COPY = "Add a title for each step.";
export const AUTO_REPLY_EMAIL_COPY =
  "Add an Email field so the auto-reply has somewhere to go.";
export const AUTO_REPLY_TEXT_COPY =
  "Add a subject and a message for the auto-reply.";
export const ROUTE_UNKNOWN_COPY = "Choose where these messages go.";
export const ROUTE_FIELD_COPY =
  "Routing points at a field that isn't on this form.";
export const ROUTES_LIMIT_COPY = `Keep routing to ${MAX_PRO_ROUTES} answers or fewer.`;

export type AddressAnswer = {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal_code: string;
};

export const ADDRESS_PARTS = Object.freeze([
  "line1",
  "line2",
  "city",
  "region",
  "postal_code",
] as const);

/**
 * A Forms Pro file upload's answer (BILL-14, D234; 10-38 choice 3). The stored object key is
 * never part of it: the hub downloads by `file_id` through an org-scoped route.
 */
export type FileAnswer = {
  file_id: string;
  name: string;
  size: number;
  type: string;
};

export type FormAnswer =
  string | string[] | boolean | AddressAnswer | FileAnswer;

/** True for a stored file answer (`file_id`, `name`, `size`, `type`). */
export function isFileAnswer(v: unknown): v is FileAnswer {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.file_id === "string" &&
    typeof o.name === "string" &&
    typeof o.size === "number" &&
    typeof o.type === "string"
  );
}

/** "340 KB", "1.2 MB" (binary units, one decimal under 10). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const n = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  return `${n} ${units[i]}`;
}

/**
 * Accepted form upload types (D234; 10-38 choice 1): the extension AND the file's magic bytes
 * must both match one row. `mime` is what the file is stored and served as, never the
 * browser's claim.
 */
export const FORM_UPLOAD_TYPES = Object.freeze([
  Object.freeze({ ext: "pdf", exts: ["pdf"], mime: "application/pdf" }),
  Object.freeze({ ext: "jpg", exts: ["jpg", "jpeg"], mime: "image/jpeg" }),
  Object.freeze({ ext: "png", exts: ["png"], mime: "image/png" }),
  Object.freeze({ ext: "heic", exts: ["heic", "heif"], mime: "image/heic" }),
  Object.freeze({ ext: "doc", exts: ["doc"], mime: "application/msword" }),
  Object.freeze({
    ext: "docx",
    exts: ["docx"],
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }),
] as const);

export type FormUploadExt = (typeof FORM_UPLOAD_TYPES)[number]["ext"];

/** The file input's `accept` list (10-40 island). */
export const FORM_UPLOAD_ACCEPT = FORM_UPLOAD_TYPES.flatMap((t) =>
  t.exts.map((e) => `.${e}`),
).join(",");

/** One upload's size limit (10-38; the island checks it before sending, the server is the authority). */
export const FORM_UPLOAD_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** 10-UI-SPEC "Forms Pro > Public form" File upload copy (never re-type it elsewhere). */
export const FILE_UPLOAD_COPY = Object.freeze({
  helper: "PDF, JPG, PNG, HEIC or Word, up to 10 MB",
  type: "Choose a PDF, JPG, PNG, HEIC or Word file.",
  size: "This file is over 10 MB. Choose a smaller one.",
  infected: "This file didn't pass our safety check. Choose another file.",
  paused:
    "File uploads are paused on this form right now. Send your message without the file, or try again later.",
  choose: "Choose file",
  remove: "Remove",
  download: "Download",
});

/** 10-UI-SPEC "Forms Pro > Public form" steps and save-and-finish-later copy (10-40). */
export const FORM_PRO_COPY = Object.freeze({
  progress: "Form progress",
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  announce: (n: number, total: number, title: string) =>
    title.trim() === ""
      ? `Step ${n} of ${total}`
      : `Step ${n} of ${total}: ${title.trim()}`,
  back: "Back",
  next: "Next",
  saveLater: "Save and finish later",
  saveEmail: "Email for your link",
  saveSend: "Send link",
  saveCancel: "Cancel",
  saved: "We emailed you a link to finish this form. It works for 30 days.",
  resumed:
    "Welcome back. Your answers are filled in; check them and send when ready.",
  expired: "This link has expired. Start the form again.",
});

/** Owner alerts in Website > Forms (10-38 choice 4; D234 warn at 80 %, hide at 100 %). */
export const FORM_UPLOAD_USAGE_COPY = Object.freeze({
  warn: (used: string) =>
    `Form uploads have used ${used} of 1 GB. Delete old messages with files to free space.`,
  full: "Form uploads are full, so upload fields are hidden until you delete messages with files. Your forms still work.",
});

export type ValidatedSubmission = {
  data: Record<string, FormAnswer>;
  labels: Record<string, string>;
  email: string | null;
  name: string | null;
  phone: string | null;
  newsletter: boolean;
};

/** What a visitor's browser receives (hidden fields removed, after-send reduced). */
export type PublicForm = {
  id: string;
  name: string;
  layout: FormLayout;
  fields: FormField[];
  after_submit: Pick<AfterSubmit, "kind" | "message" | "button_text">;
  newsletter_checkbox: boolean;
  newsletter_wording: string;
  /** Rules, steps and the save flag, only while Builder Pro is active (null or absent: free form). */
  pro?: PublicFormPro | null;
};

// ---- Limits (07-15 choice 14) ----
export const MAX_FORMS_PER_ORG = 100;
export const MAX_FORM_FIELDS = 40;
export const MAX_FIELD_OPTIONS = 30;
export const MAX_FORM_NAME = 80;
export const MAX_LABEL = 120;
export const MAX_PLACEHOLDER = 120;
export const MAX_HELP = 300;
export const MAX_OPTION = 120;
export const MAX_CONTENT = 1000;
export const MAX_HIDDEN_VALUE = 200;
export const MAX_AFTER_MESSAGE = 1000;
export const MAX_BUTTON_TEXT = 40;
export const MAX_NEWSLETTER_WORDING = 500;
export const MAX_ADDRESS_PART = 200;
export const MAX_ANSWER_BYTES = 10 * 1024;
export const MAX_ANSWER_CHARS = 10_000;
export const MAX_PAYLOAD_BYTES = 64 * 1024;
export const MIN_FILL_MS = 3000;
export const MAX_FUTURE_MS = 60_000;

/** Field ids (the newId() UUIDs). Reserved names below never match it. */
export const FORM_FIELD_ID = /^[a-z0-9-]{1,40}$/;

// ---- Reserved payload names (07-15 choice 3) ----
export const FORM_HONEYPOT_NAME = "website_url";
export const FORM_STARTED_NAME = "_started";
export const FORM_NEWSLETTER_NAME = "_newsletter";

// ---- Copy (07-UI-SPEC copy table; never re-type it elsewhere) ----
export const BLOCKED_FIELD_COPY =
  "Forms can't ask for card numbers, passwords or Social Security numbers. Change or remove this field.";
export const HEALTH_TIP_COPY =
  "Forms aren't for health records. Use an External form button to your HIPAA service (IntakeQ, Jane, SimplePractice).";
export const FORM_RATE_COPY =
  "You've sent several messages in a short time. Wait 10 minutes, then try again.";
export const FORM_ERROR_COPY =
  "Your message didn't send. Try again in a minute, or call or email us instead.";
export const DEFAULT_AFTER_MESSAGE = "Thanks. We'll get back to you soon.";
export const DEFAULT_NEWSLETTER_WORDING =
  "Send me news and offers by email. I can unsubscribe any time.";
export const DEFAULT_BUTTON_TEXT = "Send message";
export const FILE_FIELD_PRO_COPY =
  "Part of Builder Pro. Let visitors attach files with Builder Pro.";
export const FORM_LIMIT_COPY = `You can have up to ${MAX_FORMS_PER_ORG} forms.`;
export const FORM_MALFORMED_COPY = "This form is malformed.";

export const NAME_REQUIRED_COPY = "Add a name for this form.";
export const LABEL_REQUIRED_COPY = "Add a label.";
export const OPTIONS_REQUIRED_COPY = "Add at least one option.";
export const OPTIONS_DUPLICATE_COPY = "Each option needs different wording.";
export const OPTIONS_LIMIT_COPY = `Keep choices to ${MAX_FIELD_OPTIONS} options or fewer.`;
export const CONTENT_REQUIRED_COPY = "Add the text to show.";
export const TYPE_REQUIRED_COPY = "Choose a field type.";
export const PAGE_REQUIRED_COPY = "Choose a page.";
export const FIELDS_LIMIT_COPY = `Forms hold up to ${MAX_FORM_FIELDS} fields.`;
export const FIELD_ID_DUPLICATE_COPY = "Each field needs its own id.";

export const EMAIL_ANSWER_COPY =
  "Enter an email address, like name@example.com.";
export const PHONE_ANSWER_COPY = "Enter a phone number, like 512 555 0142.";
export const NUMBER_ANSWER_COPY = "Enter a number.";
export const DATE_ANSWER_COPY = "Enter a date.";
export const TIME_ANSWER_COPY = "Enter a time.";
export const CHOICE_ANSWER_COPY = "Choose one of the options.";
export const TOO_LONG_ANSWER_COPY =
  "This answer is too long. Keep it under 10,000 characters.";

export function capCopy(max: number): string {
  return `Keep this under ${max} characters.`;
}

export function requiredCopy(label: string): string {
  return `Fill in ${label}.`;
}

/** FORM-ERRORS: "1 field needs attention" / "2 fields need attention". */
export function formErrorsSummary(n: number): string {
  return n === 1 ? "1 field needs attention" : `${n} fields need attention`;
}

/** Field-keyed validation errors (keys: field ids, `name`, `fields`, `after_submit`, ...). */
export class FormErrors extends InvalidInput {
  override readonly code: string = "form_errors";
  readonly errors: Readonly<Record<string, string>>;
  constructor(errors: Record<string, string>) {
    super(formErrorsSummary(Object.keys(errors).length));
    this.errors = Object.freeze({ ...errors });
  }
}
