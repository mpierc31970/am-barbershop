// The capture form and pages. Plain neutral HTML (no tenant branding beyond the business name
// from routing). Every echoed value goes through escapeHtml. Copy says "request", never
// "booking": intent only, no availability promise (D291).
import type { FailsafeRequestInput } from "./store.ts";

export const LIMITS = {
  name: 120,
  email: 254,
  phone: 40,
  preferred: 500,
  message: 2000,
} as const;

export type FormValues = {
  name: string;
  email: string;
  phone: string;
  preferred: string;
  message: string;
};

export type FormErrors = Partial<Record<keyof FormValues, string>>;

export function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export type Parsed =
  | { kind: "bot" }
  | { kind: "invalid"; values: FormValues; errors: FormErrors }
  | { kind: "ok"; values: FormValues };

/** Parse an urlencoded body. A filled honeypot (`website`) is a bot. */
export function parseForm(body: string): Parsed {
  const p = new URLSearchParams(body);
  if ((p.get("website") ?? "").trim() !== "") return { kind: "bot" };
  const values: FormValues = {
    name: (p.get("name") ?? "").trim(),
    email: (p.get("email") ?? "").trim(),
    phone: (p.get("phone") ?? "").trim(),
    preferred: (p.get("preferred") ?? "").trim(),
    message: (p.get("message") ?? "").trim(),
  };
  const errors: FormErrors = {};
  if (values.name === "") errors.name = "Please enter your name.";
  if (values.email === "") errors.email = "Please enter your email.";
  else if (!EMAIL_RE.test(values.email)) {
    errors.email = "Please enter a valid email.";
  }
  for (const k of Object.keys(LIMITS) as (keyof FormValues)[]) {
    if (!errors[k] && values[k].length > LIMITS[k]) {
      errors[k] = `Please keep this under ${LIMITS[k]} characters.`;
    }
  }
  if (Object.keys(errors).length > 0) {
    return {
      kind: "invalid",
      // Never echo more than the limit back into the page.
      values: Object.fromEntries(
        Object.entries(values).map(([k, v]) => [
          k,
          v.slice(0, LIMITS[k as keyof FormValues]),
        ]),
      ) as FormValues,
      errors,
    };
  }
  return { kind: "ok", values };
}

export function toInput(
  orgSlug: string,
  addon: string,
  v: FormValues,
): FailsafeRequestInput {
  return { orgSlug, addon, ...v };
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:#f6f6f4;color:#1c1c1a;line-height:1.5}
main{max-width:34rem;margin:0 auto;padding:2rem 1.25rem}
h1{font-size:1.5rem;margin:0 0 .5rem}
p{margin:0 0 1rem}
label{display:block;font-weight:600;margin:1rem 0 .25rem}
input,textarea{width:100%;box-sizing:border-box;font:inherit;padding:.6rem;border:1px solid #8a8a85;border-radius:6px;background:#fff}
textarea{min-height:6rem}
.hint{font-weight:400;color:#55554f}
.err{color:#a3271a;margin:.25rem 0 0}
.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
button{margin-top:1.5rem;font:inherit;font-weight:600;padding:.7rem 1.4rem;border:0;border-radius:6px;background:#1c1c1a;color:#fff;cursor:pointer}
</style>
</head>
<body><main>
${body}
</main></body>
</html>
`;
}

function field(
  name: keyof FormValues,
  label: string,
  v: FormValues,
  e: FormErrors,
  opts: { type?: string; area?: boolean; optional?: boolean } = {},
): string {
  const id = `f-${name}`;
  const err = e[name];
  const describedBy = err
    ? ` aria-describedby="${id}-err" aria-invalid="true"`
    : "";
  const hint = opts.optional ? ` <span class="hint">(optional)</span>` : "";
  const control = opts.area
    ? `<textarea id="${id}" name="${name}" maxlength="${LIMITS[name]}"${describedBy}>${escapeHtml(v[name])}</textarea>`
    : `<input id="${id}" name="${name}" type="${opts.type ?? "text"}" maxlength="${LIMITS[name]}" value="${escapeHtml(v[name])}"${opts.optional ? "" : " required"}${describedBy}>`;
  return `<label for="${id}">${label}${hint}</label>
${control}${err ? `\n<p class="err" id="${id}-err">${escapeHtml(err)}</p>` : ""}`;
}

const EMPTY: FormValues = {
  name: "",
  email: "",
  phone: "",
  preferred: "",
  message: "",
};

export function renderForm(args: {
  businessName: string;
  action: string;
  values?: FormValues;
  errors?: FormErrors;
}): string {
  const v = args.values ?? EMPTY;
  const e = args.errors ?? {};
  const biz = escapeHtml(args.businessName);
  return page(
    `Send a request to ${args.businessName}`,
    `<h1>Send a request to ${biz}</h1>
<p>Online booking is briefly unavailable. Leave your details and ${biz} will get in touch to confirm a time. This is a request, not a confirmed booking.</p>
<form method="post" action="${escapeHtml(args.action)}" novalidate>
${field("name", "Your name", v, e)}
${field("email", "Email", v, e, { type: "email" })}
${field("phone", "Phone", v, e, { type: "tel", optional: true })}
${field("preferred", "Preferred days and times", v, e, { area: true, optional: true })}
${field("message", "Anything else", v, e, { area: true, optional: true })}
<div class="hp" aria-hidden="true"><label for="f-website">Website</label><input id="f-website" name="website" tabindex="-1" autocomplete="off"></div>
<button type="submit">Send request</button>
</form>`,
  );
}

export function renderReceived(businessName: string): string {
  const biz = escapeHtml(businessName);
  return page(
    "Request received",
    `<h1>Request received</h1>
<p>Thank you. ${biz} has your request and will get in touch to confirm. Nothing is booked or paid yet.</p>`,
  );
}

export function renderMessage(title: string, text: string): string {
  return page(
    title,
    `<h1>${escapeHtml(title)}</h1>\n<p>${escapeHtml(text)}</p>`,
  );
}
