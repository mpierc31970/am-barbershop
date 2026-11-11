"use client";
// Settings › Domain client islands (14-31 choice 3; 14-UI-SPEC "Settings › Domain",
// "Destructive and irreversible actions"; D-UI-P14-6). Small islands around the 14-30
// components so DomainPanel stays a server component: every one calls a POST server action
// from `actions/domain.ts` (never a GET mutation), shows its pending words, puts a refused
// answer in an InlineAlert that takes focus, and refreshes the server panel on success.
// The panel renders none of these for an Admin (read mode). No new tokens or sizes.
import { P14_COPY } from "@cds/core/dns";
import { Button, Dialog, FileDrop, InlineAlert, useToast } from "@cds/ui/hub";
import {
  DomainConnectForm,
  PrimaryHostChoice,
  SendStepsDialog,
  type PrimaryHost,
} from "@cds/ui/hub/domain";
import { RefreshCw, Send, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  acknowledgeFindingAction,
  checkNameserversAction,
  connectDomainAction,
  sendStepsAction,
  setPrimaryChoiceAction,
  uploadZoneFileAction,
  useDifferentDomainAction as differentDomainAction,
} from "../../../actions/domain";

/** Zone files: 256 KiB, the same cap as the server action (T-14-31-02). */
export const ZONE_FILE_MAX_BYTES = 256 * 1024;
const ZONE_ACCEPT = ".txt,.zone,.db,.bind,text/plain";
const ZONE_HINT = "Drop your zone file here, or";

/** An error line that takes focus when it appears (P3 rule: error alerts get focus). */
function FocusedError({ message }: { message: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  if (!message) return null;
  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <InlineAlert tone="error">{message}</InlineAlert>
    </div>
  );
}

/** Broken-state alerts (S7, S8, EXPIRY-7) take focus once on page load. */
export function FocusOnce({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} data-focus-once="" className="outline-none">
      {children}
    </div>
  );
}

/** S0: DomainConnectForm wired to connectDomainAction. */
export function ConnectIsland({
  previewHost,
  getDomainHref,
  askSupportHref,
}: {
  previewHost: string;
  getDomainHref?: string;
  askSupportHref?: string;
}) {
  const router = useRouter();
  return (
    <DomainConnectForm
      previewHost={previewHost}
      action={connectDomainAction}
      getDomainHref={getDomainHref}
      askSupportHref={askSupportHref}
      onStarted={() => router.refresh()}
    />
  );
}

/**
 * "I've changed them" (primary), "Check again", "I've switched them back": runs the waiting
 * step now (P14-P15). Not seen yet -> S4 with NS-NOT-YET; the gate passing -> GATE-PASS toast.
 */
export function CheckButton({
  label,
  variant = "secondary",
  icon = "refresh",
  from,
}: {
  label: string;
  variant?: "primary" | "secondary";
  icon?: "refresh" | "undo" | "none";
  /** The state the button is shown in (findings -> GATE-PASS toast when it clears). */
  from: "findings" | "nameservers" | "switch_back";
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onClick() {
    if (pending) return;
    setPending(true);
    try {
      const res = await checkNameserversAction();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setError(null);
      if (from === "findings" && res.data.state !== "findings") {
        toast.show({ message: P14_COPY.GATE_PASS });
      }
      if (from === "nameservers" && res.data.notYet) {
        router.replace("/hub/settings?tab=domain&notice=ns-not-yet");
      }
      router.refresh();
    } catch {
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }
  const Icon = icon === "refresh" ? RefreshCw : icon === "undo" ? Undo2 : null;
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant={variant}
        loading={pending}
        loadingLabel={P14_COPY.BTN_CHECKING}
        icon={Icon ? <Icon aria-hidden size={16} /> : undefined}
        onClick={onClick}
        className="w-full sm:w-auto"
      >
        {label}
      </Button>
      <FocusedError message={error} />
    </div>
  );
}

/** G5 acknowledgement: a real checkbox in a 44px row; ticking saves and clears the finding. */
export function AckCheckbox({
  ackKey,
  label,
}: {
  ackKey: string;
  label: string;
}) {
  const router = useRouter();
  const id = useId();
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onChange(next: boolean) {
    if (!next || pending) return;
    setChecked(true);
    setPending(true);
    try {
      const res = await acknowledgeFindingAction(ackKey);
      if (!res.ok) {
        setChecked(false);
        setError(res.message);
        return;
      }
      setError(null);
      router.refresh();
    } catch {
      setChecked(false);
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-center gap-3 text-base"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={pending}
          onChange={(e) => void onChange(e.currentTarget.checked)}
          className="h-5 w-5 shrink-0 accent-hub-accent"
        />
        <span>{label}</span>
      </label>
      {pending ? (
        <p role="status" className="text-sm text-hub-ink-muted">
          Saving…
        </p>
      ) : null}
      <FocusedError message={error} />
    </div>
  );
}

/** S2 zone file: FileDrop (text only, 256 KiB) -> uploadZoneFileAction -> ZONE-ADDED toast. */
export function ZoneFileIsland() {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onText(_text: string, file: File) {
    if (pending) return;
    setPending(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await uploadZoneFileAction(form);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setError(null);
      toast.show({ message: res.data.message });
      router.refresh();
    } catch {
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <FocusedError message={error} />
      <FileDrop
        onText={(text, file) => void onText(text, file)}
        onError={setError}
        maxBytes={ZONE_FILE_MAX_BYTES}
        disabled={pending}
        accept={ZONE_ACCEPT}
        hint={ZONE_HINT}
        tooBigCopy={P14_COPY.ZONE_TOO_BIG}
        unreadableCopy={P14_COPY.ZONE_UNREADABLE}
      />
      {pending ? (
        <p role="status" className="text-sm text-hub-ink-muted">
          Reading your zone file…
        </p>
      ) : null}
    </div>
  );
}

/** S3 / S4 / S8 "Send these steps to someone" + SendStepsDialog. */
export function SendStepsIsland({
  domain,
  registrar,
}: {
  domain: string;
  registrar: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        icon={<Send aria-hidden size={16} />}
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto"
      >
        {P14_COPY.BTN_SEND_STEPS_SOMEONE}
      </Button>
      <SendStepsDialog
        open={open}
        onClose={() => setOpen(false)}
        domain={domain}
        registrar={registrar}
        action={(input) => sendStepsAction(input)}
        onSent={(message) => {
          setOpen(false);
          toast.show({ message });
        }}
      />
    </>
  );
}

/** S1 / S2 ghost "Use a different domain" + the confirm Dialog (destructive table copy). */
export function DifferentDomainIsland({
  domain,
  registrar,
}: {
  domain: string;
  registrar: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    if (pending) return;
    setPending(true);
    try {
      const res = await differentDomainAction();
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="w-full sm:w-auto"
      >
        {P14_COPY.BTN_USE_DIFFERENT_DOMAIN}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={P14_COPY.DIFFERENT_DOMAIN_H}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              autoFocus
              onClick={() => setOpen(false)}
            >
              {P14_COPY.BTN_KEEP_DOMAIN({ domain })}
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={pending}
              onClick={() => void confirm()}
            >
              {P14_COPY.BTN_USE_DIFFERENT_DOMAIN}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p>{P14_COPY.DIFFERENT_DOMAIN_B({ domain, registrar })}</p>
          <FocusedError message={error} />
        </div>
      </Dialog>
    </>
  );
}

/** S5: Your main address saves on change (before launch it only records the choice). */
export function PrimaryChoiceIsland({
  domain,
  value,
}: {
  domain: string;
  value: PrimaryHost;
}) {
  const [current, setCurrent] = useState<PrimaryHost>(value);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  async function onChange(next: PrimaryHost) {
    // WR-D05: one save at a time, so an earlier answer can never win a race.
    if (status === "saving" || next === current) return;
    const before = current;
    setCurrent(next);
    setStatus("saving");
    try {
      const res = await setPrimaryChoiceAction(next);
      if (!res.ok) {
        setCurrent(before);
        setStatus("idle");
        setError(res.message);
        return;
      }
      setError(null);
      setStatus("saved");
    } catch {
      setCurrent(before);
      setStatus("idle");
      setError(P14_COPY.ERR_GENERIC);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <PrimaryHostChoice
        domain={domain}
        value={current}
        onChange={(v) => void onChange(v)}
      />
      <p role="status" className="min-h-5 text-sm text-hub-ink-muted">
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
      </p>
      <FocusedError message={error} />
    </div>
  );
}

/** S6: ghost sm "Change main address" opens PrimaryHostChoice in a Dialog. */
export function ChangeMainIsland({
  domain,
  value,
  mainHost,
}: {
  domain: string;
  value: PrimaryHost;
  mainHost: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<PrimaryHost>(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (pending) return;
    if (choice === value) {
      setOpen(false);
      return;
    }
    setPending(true);
    try {
      const res = await setPrimaryChoiceAction(choice);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      toast.show({ message: "Saved" });
      router.refresh();
    } catch {
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setChoice(value);
          setError(null);
          setOpen(true);
        }}
      >
        {P14_COPY.BTN_CHANGE_MAIN}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={P14_COPY.CHANGE_MAIN_H}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              {P14_COPY.BTN_KEEP_DOMAIN({ domain: mainHost })}
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={pending}
              onClick={() => void save()}
            >
              {P14_COPY.BTN_SAVE_MAIN}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p>{P14_COPY.CHANGE_MAIN_B}</p>
          <PrimaryHostChoice
            domain={domain}
            value={choice}
            onChange={setChoice}
          />
          <FocusedError message={error} />
        </div>
      </Dialog>
    </>
  );
}
