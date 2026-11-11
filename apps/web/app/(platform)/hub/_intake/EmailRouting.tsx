"use client";
// "Where should your email go?" (06-22; 06-UI-SPEC "Email routing" items 1-6, validation copy,
// Destructive actions; ONB-09, ONB-10, D112, D173, D-UI-P6-24; T-06-102, T-06-103). One
// component for setup step 3 and Settings › Email.
//   1. Heading + intro.
//   2. Everything goes to: the default row (Confirmed from Submit) + Change address, which
//      opens an inline edit (TextField + Save and send confirmation + Keep current). The old
//      address keeps working until the new one is confirmed.
//   3. Use a different address for… (a disclosure, open when any override exists): Website
//      inquiries (up to 5, Add another address), Newsletter (Sender name + reply-to), Billing
//      from CDS and Account and support (one each). Each is a checkbox revealing its fields.
//   4. How your emails look to customers: From / Replies go to, computed by senderFor with
//      the platform mail domain the server page passes in (the same rule the send path
//      uses, so the preview never shows a free-mail From). A free-mail reply-to adds the "get
//      an address at your own domain" line, which opens the how-to steps in the
//      TrainingDrawer (the P5 training convention).
//   5. Row states come from EmailRouteRow.
//   6. Addresses save only on Save and send confirmation (never on blur: saving sends an
//      email); the group checkboxes and the sender name save by themselves.
// Removing an address is immediate with an 8 s Undo toast; Undo adds it again, so it gets a
// fresh confirmation. The default row has no remove.
import { ERR_EMAIL, isEmail, isFreeMail, senderFor } from "@cds/core/email";
import {
  Button,
  EmailRouteRow,
  TextField,
  TrainingDrawer,
  useToast,
  type HubActionResult,
} from "@cds/ui/hub";
import { SendingDomainStatus } from "@cds/ui/hub/domain";
import { ChevronDown, Plus } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { EmailRouteView, EmailRoutingData } from "../../../../lib/intake";
import {
  addEmailRouteAction,
  changeDefaultRouteAction,
  removeEmailRouteAction,
  resendRouteConfirmationAction,
  restoreEmailRouteAction,
  setNewsletterSenderAction,
} from "../../../actions/email-routes";
import { saveSendingLocalPartAction } from "../../../actions/sending";
import { useStageAutosave } from "../setup/[stage]/StageFrame";
import { PRO_EMAIL_STEPS, PRO_EMAIL_TITLE } from "./professional-email-steps";

export type OverridePurpose =
  "inquiries" | "newsletter" | "billing" | "account";

export const OVERRIDE_PURPOSES: readonly OverridePurpose[] = [
  "inquiries",
  "newsletter",
  "billing",
  "account",
];

export const MAX_INQUIRIES = 5;

export const ROUTING_COPY = {
  heading: "Where should your email go?",
  intro:
    "One address for everything is the simplest. You can send some messages elsewhere.",
  everything: "Everything goes to",
  change: "Change address",
  newAddress: "New address",
  changeHelper:
    "Your current address keeps getting email until you confirm the new one.",
  pendingNote:
    "New address. Your current one keeps getting email until this one is confirmed.",
  save: "Save and send confirmation",
  keep: "Keep current",
  different: "Use a different address for…",
  groups: {
    inquiries: "Website inquiries",
    newsletter: "Newsletter",
    billing: "Billing from CDS",
    account: "Account and support",
  },
  groupHelpers: {
    inquiries: "Messages people send from your site.",
    newsletter: "Replies to your newsletter.",
    billing: "Invoices and receipts from CDS.",
    account: "Sign-in notices and messages from CDS support.",
  },
  address: "Email address",
  replyTo: "Reply-to address",
  addAnother: "Add another address",
  cancel: "Cancel",
  senderName: "Sender name",
  senderHelper: "The name people see in their inbox.",
  previewHeading: "How your emails look to customers",
  from: "From:",
  replies: "Replies go to:",
  sent: (a: string) => `We sent a confirmation to ${a}.`,
  removed: (a: string) => `${a} removed.`,
  undo: "Undo",
  duplicate: "This address is already on the list.",
  tooMany: `You can add up to ${MAX_INQUIRIES} addresses for website inquiries.`,
  proLink: "get an address at your own domain",
} as const;

const PROVIDERS: Readonly<Record<string, string>> = {
  "gmail.com": "Gmail",
  "googlemail.com": "Gmail",
  "outlook.com": "Outlook",
  "hotmail.com": "Outlook",
  "live.com": "Outlook",
  "msn.com": "Outlook",
  "yahoo.com": "Yahoo Mail",
  "ymail.com": "Yahoo Mail",
  "rocketmail.com": "Yahoo Mail",
  "icloud.com": "iCloud Mail",
  "me.com": "iCloud Mail",
  "mac.com": "iCloud Mail",
  "aol.com": "AOL Mail",
};

/** "Gmail" for maria@gmail.com; "a personal address" for other free-mail providers. */
export function providerName(address: string): string {
  const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
  return Object.hasOwn(PROVIDERS, domain)
    ? PROVIDERS[domain]!
    : "a personal address";
}

/** The From / Reply-To preview: the send path's own senderFor (D173); null if unusable. */
export function previewSender(input: {
  name: string;
  slug: string;
  replyTo: string;
  mailDomain: string;
  /** P14 (14-25): the verified own domain and local part, when there is one. */
  ownDomain?: string | null;
  localPart?: string;
  sendingDomainVerified?: boolean;
}) {
  try {
    return senderFor(
      {
        kind: "org",
        name: input.name,
        slug: input.slug,
        replyTo: input.replyTo,
        ownDomain: input.ownDomain ?? null,
        sendingDomainVerified: input.sendingDomainVerified === true,
        ...(input.localPart !== undefined
          ? { localPart: input.localPart }
          : {}),
      },
      { mailDomain: input.mailDomain, supportEmail: null },
    );
  } catch {
    return null;
  }
}

/** No own-domain sending data (older callers): the "Once your domain is connected" row. */
const NO_SENDING: NonNullable<EmailRoutingData["sending"]> = {
  state: "none",
  domain: "",
  localPart: "hello",
  canEdit: false,
};

const CHECKBOX =
  "mt-0.5 h-5 w-5 shrink-0 accent-hub-accent disabled:cursor-not-allowed pointer-coarse:h-6 pointer-coarse:w-6";
const LINK =
  "font-semibold text-hub-accent underline underline-offset-2 hover:text-hub-accent-hover";

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** One address entry: TextField + Save and send confirmation (+ an optional ghost). */
function AddressForm({
  id,
  label,
  helper,
  onSubmit,
  secondary,
  autoFocus = false,
}: {
  id: string;
  label: string;
  helper?: ReactNode;
  /** Returns the field error, or null when saved. */
  onSubmit: (address: string) => Promise<string | null>;
  secondary?: { label: string; onClick: () => void };
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v = value.trim();
    if (!isEmail(v)) {
      setError(ERR_EMAIL);
      return;
    }
    setBusy(true);
    const err = await onSubmit(v).catch(() => ERR_EMAIL);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setValue("");
    setError(null);
  }

  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-3"
      data-address-form={id}
    >
      <TextField
        id={id}
        label={label}
        type="email"
        autoComplete="email"
        inputMode="email"
        helper={helper}
        error={error ?? undefined}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" loading={busy}>
          {ROUTING_COPY.save}
        </Button>
        {secondary ? (
          <Button type="button" variant="ghost" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export interface EmailRoutingProps {
  data: EmailRoutingData;
  businessName: string;
  readOnly: boolean;
  /** After any saved change (setup marks the step saved). */
  onChanged?: () => void;
}

export function EmailRouting({
  data,
  businessName,
  readOnly,
  onChanged,
}: EmailRoutingProps) {
  const toast = useToast();
  const uid = useId();
  const [routes, setRoutes] = useState<EmailRouteView[]>(data.routes);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(() =>
    data.routes.some((r) => r.purpose !== "default"),
  );
  const [on, setOn] = useState<Record<OverridePurpose, boolean>>(() => ({
    inquiries: data.routes.some((r) => r.purpose === "inquiries"),
    newsletter: data.routes.some((r) => r.purpose === "newsletter"),
    billing: data.routes.some((r) => r.purpose === "billing"),
    account: data.routes.some((r) => r.purpose === "account"),
  }));
  const [drawer, setDrawer] = useState(false);

  const current = routes.find(
    (r) => r.purpose === "default" && !r.pendingDefault,
  );
  const pending = routes.find(
    (r) => r.purpose === "default" && r.pendingDefault,
  );
  const of = (p: OverridePurpose) => routes.filter((r) => r.purpose === p);
  const newsletter = of("newsletter")[0];

  const [sender, setSender] = useState(
    () => newsletter?.senderName || businessName,
  );
  const senderSave = useStageAutosave<string>("email.sender", (name) =>
    setNewsletterSenderAction(name),
  );
  // The last sender name sent ("" = the business name). `routes` is not updated by a
  // sender save, so comparing against it skipped a change back to the first value (C-WR-03).
  const senderSent = useRef(newsletter?.senderName ?? "");
  // 14-25: the saved own-domain local part (the From preview follows a save).
  const [sendingLocal, setSendingLocal] = useState(
    data.sending?.localPart ?? "hello",
  );

  function changed() {
    onChanged?.();
  }

  function failMessage(res: HubActionResult<unknown>): string {
    return res.ok ? "" : res.message;
  }

  // ------------------------------------------------------------------ saves

  async function saveDefault(address: string): Promise<string | null> {
    if (current && same(current.address, address)) {
      return ROUTING_COPY.duplicate;
    }
    const res = await changeDefaultRouteAction(address);
    if (!res.ok) return failMessage(res);
    setRoutes((list) => [
      ...list.filter((r) => !(r.purpose === "default" && r.pendingDefault)),
      res.data,
    ]);
    setEditing(null);
    toast.show({ message: ROUTING_COPY.sent(res.data.address) });
    changed();
    return null;
  }

  async function saveOverride(
    p: OverridePurpose,
    address: string,
    replacing?: EmailRouteView,
  ): Promise<string | null> {
    const group = of(p).filter((r) => r.id !== replacing?.id);
    if (group.some((r) => same(r.address, address))) {
      return ROUTING_COPY.duplicate;
    }
    if (p === "inquiries" && !replacing && group.length >= MAX_INQUIRIES) {
      return ROUTING_COPY.tooMany;
    }
    // Inquiries keep a list: a changed row is swapped for the new one in one batch at the
    // chokepoint, so it works at the cap and never half-applies (C-WR-04). The one-address
    // groups replace there too: a working (confirmed) address stays until the new one is
    // confirmed, a waiting or bouncing one goes now (A-WR-05).
    const res =
      replacing && p === "inquiries"
        ? await addEmailRouteAction(p, address, replacing.id)
        : await addEmailRouteAction(p, address);
    if (!res.ok) return failMessage(res);
    setRoutes((list) => {
      const rest =
        p === "inquiries"
          ? list.filter((r) => r.id !== replacing?.id)
          : list.filter((r) => r.purpose !== p || r.status === "confirmed");
      return [...rest, res.data];
    });
    setEditing(null);
    setAdding(false);
    toast.show({ message: ROUTING_COPY.sent(res.data.address) });
    changed();
    return null;
  }

  async function resend(r: EmailRouteView): Promise<boolean> {
    const res = await resendRouteConfirmationAction(r.id);
    if (res.ok) {
      toast.show({ message: ROUTING_COPY.sent(r.address) });
      return true;
    }
    toast.show({ message: res.message });
    return res.code === "rate_limited";
  }

  async function restore(removed: EmailRouteView[]) {
    for (const r of removed) {
      const res = await restoreEmailRouteAction({
        purpose: r.purpose,
        address: r.address,
      });
      if (!res.ok) {
        toast.show({ message: res.message });
        continue;
      }
      setRoutes((list) => [...list, res.data]);
      setOn((o) => ({ ...o, [r.purpose]: true }));
      toast.show({ message: ROUTING_COPY.sent(res.data.address) });
    }
    changed();
  }

  async function remove(targets: EmailRouteView[], message: string) {
    if (targets.length === 0) return;
    const ids = new Set(targets.map((t) => t.id));
    setRoutes((list) => list.filter((r) => !ids.has(r.id)));
    const gone: EmailRouteView[] = [];
    for (const t of targets) {
      const res = await removeEmailRouteAction(t.id);
      if (res.ok) {
        gone.push(t);
      } else {
        setRoutes((list) => [...list, t]);
        toast.show({ message: res.message });
      }
    }
    if (gone.length === 0) return;
    changed();
    toast.show({
      message,
      action: { label: ROUTING_COPY.undo, onClick: () => void restore(gone) },
    });
  }

  async function cancelPending() {
    if (!pending) return;
    setRoutes((list) => list.filter((r) => r.id !== pending.id));
    const res = await removeEmailRouteAction(pending.id);
    if (!res.ok) {
      setRoutes((list) => [...list, pending]);
      toast.show({ message: res.message });
      return;
    }
    changed();
  }

  function toggle(p: OverridePurpose, next: boolean) {
    setOn((o) => ({ ...o, [p]: next }));
    if (next) return;
    const rows = of(p);
    if (rows.length === 0) return;
    void remove(
      rows,
      rows.length === 1
        ? ROUTING_COPY.removed(rows[0]!.address)
        : `${rows.length} addresses removed.`,
    );
  }

  // ------------------------------------------------------------------ rows

  function overrideRow(p: OverridePurpose, r: EmailRouteView) {
    return (
      <li key={r.id} className="flex flex-col gap-3">
        <EmailRouteRow
          address={r.address}
          status={r.status}
          readOnly={readOnly}
          onResend={() => resend(r)}
          onChange={() => setEditing(r.id)}
          onRemove={() => void remove([r], ROUTING_COPY.removed(r.address))}
        />
        {editing === r.id && !readOnly ? (
          <AddressForm
            id={`${uid}-edit-${r.id}`}
            label={ROUTING_COPY.newAddress}
            autoFocus
            onSubmit={(a) => saveOverride(p, a, r)}
            secondary={{
              label: ROUTING_COPY.keep,
              onClick: () => setEditing(null),
            }}
          />
        ) : null}
      </li>
    );
  }

  function group(p: OverridePurpose) {
    const rows = of(p);
    const boxId = `${uid}-on-${p}`;
    const label =
      p === "newsletter" ? ROUTING_COPY.replyTo : ROUTING_COPY.address;
    const showForm =
      !readOnly &&
      on[p] &&
      (rows.length === 0 || (p === "inquiries" && adding));
    return (
      <fieldset key={p} className="flex flex-col gap-3" data-group={p}>
        <legend className="sr-only">{ROUTING_COPY.groups[p]}</legend>
        <label htmlFor={boxId} className="flex items-start gap-3">
          <input
            id={boxId}
            type="checkbox"
            className={CHECKBOX}
            checked={on[p]}
            disabled={readOnly}
            onChange={(e) => toggle(p, e.target.checked)}
          />
          <span className="flex flex-col">
            <span className="text-base font-semibold text-hub-ink">
              {ROUTING_COPY.groups[p]}
            </span>
            <span className="text-sm text-hub-ink-muted">
              {ROUTING_COPY.groupHelpers[p]}
            </span>
          </span>
        </label>
        {on[p] ? (
          <div className="ml-8 flex flex-col gap-4">
            {p === "newsletter" && newsletter ? (
              <TextField
                id={`${uid}-sender`}
                label={ROUTING_COPY.senderName}
                helper={ROUTING_COPY.senderHelper}
                maxLength={120}
                value={sender}
                disabled={readOnly}
                error={
                  senderSave.status === "invalid"
                    ? senderSave.failure?.message
                    : undefined
                }
                onChange={(e) => setSender(e.target.value)}
                onBlur={() => {
                  const name = sender.trim();
                  const value = name === businessName ? "" : name;
                  if (
                    value === senderSent.current &&
                    senderSave.status !== "error" &&
                    senderSave.status !== "invalid"
                  ) {
                    return;
                  }
                  senderSent.current = value;
                  senderSave.run(value);
                }}
              />
            ) : null}
            {rows.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {rows.map((r) => overrideRow(p, r))}
              </ul>
            ) : null}
            {showForm ? (
              <AddressForm
                id={`${uid}-add-${p}`}
                label={label}
                autoFocus={p === "inquiries" && adding}
                onSubmit={(a) => saveOverride(p, a)}
                secondary={
                  p === "inquiries" && adding && rows.length > 0
                    ? {
                        label: ROUTING_COPY.cancel,
                        onClick: () => setAdding(false),
                      }
                    : undefined
                }
              />
            ) : null}
            {p === "inquiries" &&
            !readOnly &&
            rows.length > 0 &&
            !adding &&
            rows.length < MAX_INQUIRIES ? (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Plus aria-hidden size={16} strokeWidth={2} />}
                  onClick={() => setAdding(true)}
                >
                  {ROUTING_COPY.addAnother}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </fieldset>
    );
  }

  // ------------------------------------------------------------------ preview

  const replyTo =
    current && current.status !== "bouncing" ? current.address : "";
  const sending = data.sending ?? NO_SENDING;
  const preview = previewSender({
    name: businessName,
    slug: data.slug,
    replyTo,
    mailDomain: data.mailDomain,
    // P14 (14-25): the From line shows the verified own-domain address.
    ownDomain: sending.domain || null,
    localPart: sendingLocal,
    sendingDomainVerified: sending.state === "verified",
  });
  const regionId = `${uid}-overrides`;
  const headingId = `${uid}-heading`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h2
          id={headingId}
          className="text-xl leading-tight font-semibold text-hub-ink"
        >
          {ROUTING_COPY.heading}
        </h2>
        <p className="max-w-[68ch] text-base text-hub-ink-muted">
          {ROUTING_COPY.intro}
        </p>
      </div>

      <div className="flex flex-col gap-3" data-group="default">
        <h3 className="text-sm font-semibold text-hub-ink">
          {ROUTING_COPY.everything}
        </h3>
        {current ? (
          <EmailRouteRow
            address={current.address}
            status={current.status}
            readOnly={readOnly}
            onResend={() => resend(current)}
            onChange={() => setEditing("default")}
            actions={
              current.status !== "bouncing" && editing !== "default" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing("default")}
                >
                  {ROUTING_COPY.change}
                </Button>
              ) : null
            }
          />
        ) : null}
        {pending ? (
          <EmailRouteRow
            address={pending.address}
            status={pending.status}
            note={ROUTING_COPY.pendingNote}
            readOnly={readOnly}
            onResend={() => resend(pending)}
            onChange={() => setEditing("default")}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void cancelPending()}
              >
                {ROUTING_COPY.keep}
              </Button>
            }
          />
        ) : null}
        {(editing === "default" || !current) && !readOnly ? (
          <AddressForm
            id={`${uid}-default`}
            label={ROUTING_COPY.newAddress}
            helper={current ? ROUTING_COPY.changeHelper : undefined}
            autoFocus={editing === "default"}
            onSubmit={saveDefault}
            secondary={
              current
                ? {
                    label: ROUTING_COPY.keep,
                    onClick: () => setEditing(null),
                  }
                : undefined
            }
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 items-center gap-2 self-start rounded text-base font-semibold text-hub-ink"
        >
          <ChevronDown
            aria-hidden
            size={20}
            strokeWidth={2}
            className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
          {ROUTING_COPY.different}
        </button>
        <div id={regionId} hidden={!open} className="flex flex-col gap-6">
          {OVERRIDE_PURPOSES.map((p) => group(p))}
        </div>
      </div>

      {preview ? (
        <div
          className="flex flex-col gap-1 rounded-lg bg-hub-surface-2 p-4 text-sm text-hub-ink"
          data-preview
        >
          <h3 className="font-semibold">{ROUTING_COPY.previewHeading}</h3>
          <p className="break-all">
            {ROUTING_COPY.from} <strong>{preview.fromName}</strong> &lt;
            {preview.fromAddress}&gt;
          </p>
          {preview.replyTo ? (
            <p className="break-all">
              {ROUTING_COPY.replies} <strong>{preview.replyTo}</strong>
            </p>
          ) : null}
          {preview.replyTo && isFreeMail(preview.replyTo) ? (
            <p className="mt-1 text-hub-ink-muted" data-free-mail>
              Using {providerName(preview.replyTo)} is fine: replies come
              straight to you. For a more professional look,{" "}
              <button
                type="button"
                className={LINK}
                onClick={() => setDrawer(true)}
              >
                {ROUTING_COPY.proLink}
              </button>
              .
            </p>
          ) : null}
          <div className="mt-2" data-sending-row>
            <SendingDomainStatus
              state={sending.state}
              domain={sending.domain}
              localPart={sending.localPart}
              replyTo={preview.replyTo ?? ""}
              {...(sending.canEdit && !readOnly
                ? { save: saveSendingLocalPartAction }
                : {})}
              onSaved={(message, local) => {
                setSendingLocal(local);
                toast.show({ message });
                changed();
              }}
            />
          </div>
        </div>
      ) : null}

      <TrainingDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title={PRO_EMAIL_TITLE}
        steps={PRO_EMAIL_STEPS}
      />
    </section>
  );
}
