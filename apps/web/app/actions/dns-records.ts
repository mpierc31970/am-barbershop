"use server";
// Settings › Domain › DNS records and email setup actions (14-32 choice 3; DOM-03, ONB-10;
// 14-UI-SPEC "DNS records", "Email setup"; D119, D173, D-UI-P14-19, D-UI-P14-26; T-14-32-01,
// T-14-32-02). Public POST endpoints (Next server actions): every argument is untrusted and
// narrowed here first. The org comes only from the session (runAction); the only id taken is a
// record id, which the 14-28 function looks up inside the session org's own zone (else
// NotFound, P14-P34). The owner functions re-run the record policy and class checks, need
// `domain:write` and `dnsOpen()`, so the server refuses protected records whatever the UI shows.
// Refusals come back as UI codes with their P14_COPY message and the field they belong to:
//   OwnerRecordRefused -> "REC-<REASON>" (name or value field), SpfMergeError -> "EMAIL-SPF",
//   EmailSetupWriteFailed -> "EMAIL-WRITE-FAILED", a bad pasted value -> its field.
// "Ask to change" and "Ask CDS to set it up" file a P12 change ticket (fileTicket) for the
// whole site (there is no `part:domain` site part); the body is plain text holding the owner's
// own record (T-14-32-02).
import {
  EMAIL_PRESETS,
  EMAIL_PRESET_IDS,
  P14_COPY,
  SpfMergeError,
  isRType,
  type EmailPresetId,
} from "@cds/core/dns";
import {
  EmailSetupWriteFailed,
  OwnerRecordRefused,
  fileTicket,
  ownerAddRecord,
  ownerApplyEmailSetup,
  ownerEmailSetupPreview,
  ownerRemoveRecord,
} from "@cds/db";
import {
  RECORDS_UI_COPY,
  type EmailSetupPreviewView,
} from "@cds/ui/hub/domain";
import { revalidatePath } from "next/cache";
import { emailPreviewView } from "../(platform)/hub/settings/records-view";
import { runAction, type ActionResult } from "../../lib/action";

const NAME_MAX = 253 + 16;
const VALUE_MAX = 4096;
const ID_MAX = 100;

const COPY = {
  forbidden: P14_COPY.DOM_ADMIN_READ,
  impersonation: P14_COPY.DOM_ADMIN_READ,
};

const BAD_INPUT = "That didn't look right. Reload the page and try again.";

// Not exported: a "use server" module exports async functions only.
const DNS_RECORDS_ACTION_COPY = Object.freeze({
  spf: "Your domain's SPF record needs a hand from Support. Choose Another provider, then Ask Support to set it up.",
  changeSubject: "Change a DNS record",
  changeIntro: "Please change this DNS record on my domain:",
  emailSubject: "Set up email for my domain",
  emailBody:
    "Please add the email records for my email provider. I'll reply with the values my provider gave me.",
});

function bad(message: string, field?: string): ActionResult<never> {
  return {
    ok: false,
    code: "invalid_input",
    message,
    ...(field ? { field } : {}),
  };
}

function own(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null) return undefined;
  return Object.hasOwn(input, key)
    ? (input as Record<string, unknown>)[key]
    : undefined;
}

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  return raw.length > max ? null : raw;
}

function revalidate(): void {
  try {
    revalidatePath("/hub/settings");
  } catch (err) {
    console.error(
      "[dns-records] revalidate failed",
      err instanceof Error ? err.name : "unknown",
    );
  }
}

type Refusal = { refused: { code: string; message: string; field?: string } };

/** The field a record refusal belongs to. */
function recordField(reason: string): "name" | "value" {
  return reason === "value_empty" || reason === "spf" ? "value" : "name";
}

/** Values the server says don't match their preset pattern (14-06 InvalidInput names the field). */
function presetField(err: unknown): "verification" | "dkim" | null {
  if (!(err instanceof Error)) return null;
  const m = /Email preset value is not valid: (verification|dkim)$/.exec(
    err.message,
  );
  return m ? (m[1] as "verification" | "dkim") : null;
}

function presetFieldCopy(
  preset: EmailPresetId,
  field: "verification" | "dkim",
): string {
  return field === "verification"
    ? P14_COPY.EMAIL_VALUE_FORMAT(presetVerification(preset))
    : RECORDS_UI_COPY.dkimFormat(presetName(preset), "v=DKIM1");
}

function presetName(preset: EmailPresetId): string {
  return EMAIL_PRESETS[preset].name;
}

function presetVerification(preset: EmailPresetId): {
  service: string;
  prefix: string;
} {
  const p = EMAIL_PRESETS[preset];
  return { service: p.name, prefix: p.verificationPrefix ?? "" };
}

async function guarded<T>(
  fn: () => Promise<T>,
  preset?: EmailPresetId,
): Promise<{ value: T } | Refusal> {
  try {
    return { value: await fn() };
  } catch (err) {
    if (err instanceof OwnerRecordRefused) {
      return {
        refused: {
          code: `REC-${err.reason.toUpperCase().replace(/_/g, "-")}`,
          message: err.message,
          field: recordField(err.reason),
        },
      };
    }
    if (err instanceof SpfMergeError) {
      return {
        refused: { code: "EMAIL-SPF", message: DNS_RECORDS_ACTION_COPY.spf },
      };
    }
    if (err instanceof EmailSetupWriteFailed) {
      return {
        refused: {
          code: "EMAIL-WRITE-FAILED",
          message: P14_COPY.EMAIL_WRITE_FAILED,
        },
      };
    }
    const field = preset ? presetField(err) : null;
    if (preset && field) {
      return {
        refused: {
          code: "EMAIL-VALUE-FORMAT",
          message: presetFieldCopy(preset, field),
          field,
        },
      };
    }
    throw err;
  }
}

async function run<T>(
  fn: (ctx: Parameters<typeof ownerAddRecord>[0]) => Promise<T>,
  opts: { preset?: EmailPresetId; revalidate?: boolean } = {},
): Promise<ActionResult<T>> {
  const res = await runAction(
    (s) => guarded(() => fn(s.ctx), opts.preset),
    COPY,
  );
  if (!res.ok) return res;
  if ("refused" in res.data) {
    const r = res.data.refused;
    return {
      ok: false,
      code: r.code,
      message: r.message,
      ...(r.field ? { field: r.field } : {}),
    };
  }
  if (opts.revalidate !== false) revalidate();
  return { ok: true, data: res.data.value };
}

/** Add a record (TXT or CNAME only; D-UI-P14-19). */
export async function addRecordAction(
  input: unknown,
): Promise<ActionResult<{ type: "TXT" | "CNAME" }>> {
  const type = own(input, "type");
  if (type !== "TXT" && type !== "CNAME") return bad(BAD_INPUT);
  const name = text(own(input, "name"), NAME_MAX);
  if (name === null || name.trim() === "") {
    return bad(P14_COPY.REC_NAME_INVALID, "name");
  }
  const value = text(own(input, "value"), VALUE_MAX);
  if (value === null || value.trim() === "") {
    return bad(P14_COPY.REC_VALUE_EMPTY, "value");
  }
  return run(async (ctx) => {
    await ownerAddRecord(ctx, { type, name: name.trim(), value });
    return { type };
  });
}

/** Remove one of the owner's own records by the DNS host's id (scoped to the org's zone). */
export async function removeRecordAction(
  recordId: unknown,
): Promise<ActionResult<null>> {
  const id = text(recordId, ID_MAX);
  if (id === null || id === "") return bad(BAD_INPUT);
  return run(async (ctx) => {
    await ownerRemoveRecord(ctx, id);
    return null;
  });
}

function narrowPreset(raw: unknown): EmailPresetId | null {
  return typeof raw === "string" &&
    (EMAIL_PRESET_IDS as readonly string[]).includes(raw)
    ? (raw as EmailPresetId)
    : null;
}

function narrowValues(
  raw: unknown,
): { verification?: string; dkim?: string } | null {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null) return null;
  const out: { verification?: string; dkim?: string } = {};
  for (const key of ["verification", "dkim"] as const) {
    const v = own(raw, key);
    if (v === undefined) continue;
    const t = text(v, VALUE_MAX);
    if (t === null) return null;
    out[key] = t;
  }
  return out;
}

/** Step 2 -> 3: what the preset would write (no writes; Admin may preview). */
export async function emailSetupPreviewAction(
  input: unknown,
): Promise<ActionResult<EmailSetupPreviewView>> {
  const preset = narrowPreset(own(input, "preset"));
  const values = narrowValues(own(input, "values"));
  if (!preset || !values) return bad(BAD_INPUT);
  return run(
    async (ctx) =>
      emailPreviewView(await ownerEmailSetupPreview(ctx, preset, values)),
    { preset, revalidate: false },
  );
}

/** Step 3: write the preset. `replaceConfirmed` must be exactly true to replace another provider. */
export async function applyEmailSetupAction(
  input: unknown,
): Promise<ActionResult<{ provider: string }>> {
  const preset = narrowPreset(own(input, "preset"));
  const values = narrowValues(own(input, "values"));
  if (!preset || !values) return bad(BAD_INPUT);
  const replaceConfirmed = own(input, "replaceConfirmed") === true;
  return run(
    async (ctx) => {
      const out = await ownerApplyEmailSetup(ctx, preset, values, {
        replaceConfirmed,
      });
      return { provider: out.provider };
    },
    { preset },
  );
}

/** The plain-text body of an Ask to change ticket (the owner's own record). */
function changeTicketBody(record: {
  type: string;
  name: string;
  value: string;
}): string {
  return [
    DNS_RECORDS_ACTION_COPY.changeIntro,
    "",
    `Type: ${record.type}`,
    `Name: ${record.name}`,
    `Value: ${record.value}`,
  ].join("\n");
}

/** "Ask to change" on a Yours record: files a change ticket for the whole site. */
export async function askToChangeAction(
  record: unknown,
): Promise<ActionResult<{ number: number }>> {
  const type = own(record, "type");
  const name = text(own(record, "name"), NAME_MAX);
  const value = text(own(record, "value"), VALUE_MAX);
  if (typeof type !== "string" || !isRType(type) || !name || value === null) {
    return bad(BAD_INPUT);
  }
  const body = changeTicketBody({ type, name, value });
  return run(
    async (ctx) => {
      const out = await fileTicket(ctx, {
        type: "change",
        subject: DNS_RECORDS_ACTION_COPY.changeSubject,
        body,
      });
      return { number: out.number };
    },
    { revalidate: false },
  );
}

/** "Ask CDS to set it up" (Another provider): files a change ticket for the email records. */
export async function askEmailSetupAction(): Promise<
  ActionResult<{ number: number }>
> {
  return run(
    async (ctx) => {
      const out = await fileTicket(ctx, {
        type: "change",
        subject: DNS_RECORDS_ACTION_COPY.emailSubject,
        body: DNS_RECORDS_ACTION_COPY.emailBody,
      });
      return { number: out.number };
    },
    { revalidate: false },
  );
}
