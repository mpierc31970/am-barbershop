"use client";
// AddRecordDialog (14-32 choice 1; 14-UI-SPEC "AddRecordDialog"; D-UI-P14-19, D119). Dialog
// "Add a record": Type RadioCardGroup TXT / CNAME, Name (font-mono, "Full name: …" preview),
// Value (TextArea for TXT, TextField for CNAME), primary Add record (pending Adding…),
// secondary Don't add. Empty name / value are refused here (REC-NAME-INVALID,
// REC-VALUE-EMPTY) without calling the action; every other refusal (REC-EXISTS,
// REC-PROTECTED, REC-SPF, ERR-SAVE) comes back from the server action and is shown inline
// under its field (or above the form), with the values kept. Values render as text nodes only
// (T-14-32-02). The server re-runs the 14-28 policy regardless of the UI (T-14-32-01).
import { P14_COPY } from "@cds/core/dns";
import { useId, useState, type FormEvent } from "react";
import { rethrowControlFlow } from "../action-errors";
import type { HubActionResult } from "../addon-types";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { InlineAlert } from "../feedback";
import { TextArea, TextField } from "../fields";
import { RadioCardGroup } from "../RadioCardGroup";
import { RECORDS_UI_COPY as C } from "./records-copy";

export type OwnerRecordType = "TXT" | "CNAME";

export interface AddRecordInput {
  type: OwnerRecordType;
  name: string;
  value: string;
}

export interface AddRecordDialogProps {
  open: boolean;
  onClose(): void;
  domain: string;
  action(input: AddRecordInput): Promise<HubActionResult<unknown>>;
  /** After an add: the toast words (REC-ADDED). */
  onAdded?(message: string): void;
}

/** "em123" -> "em123.riverabakery.com"; "@" -> the domain; "" -> "". */
export function fullRecordName(name: string, domain: string): string {
  const n = name.trim().replace(/\.+$/, "").toLowerCase();
  if (n === "") return "";
  if (n === "@") return domain;
  if (n === domain || n.endsWith(`.${domain}`)) return n;
  return `${n}.${domain}`;
}

export function AddRecordDialog({
  open,
  onClose,
  domain,
  action,
  onAdded,
}: AddRecordDialogProps) {
  const id = useId();
  const formId = `${id}-form`;
  const [type, setType] = useState<OwnerRecordType>("TXT");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [valueError, setValueError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setType("TXT");
    setName("");
    setValue("");
    setNameError(null);
    setValueError(null);
    setFormError(null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const n = name.trim();
    const v = value.trim();
    const nErr = n === "" ? P14_COPY.REC_NAME_INVALID : null;
    const vErr = v === "" ? P14_COPY.REC_VALUE_EMPTY : null;
    setNameError(nErr);
    setValueError(vErr);
    setFormError(null);
    if (nErr || vErr) return;
    setPending(true);
    try {
      const res = await action({ type, name: n, value: v });
      if (res.ok) {
        onAdded?.(P14_COPY.REC_ADDED({ type }));
        reset();
        onClose();
      } else if (res.field === "name") {
        setNameError(res.message);
      } else if (res.field === "value") {
        setValueError(res.message);
      } else {
        setFormError(res.message);
      }
    } catch (err) {
      rethrowControlFlow(err);
      setFormError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }

  const full = fullRecordName(name, domain);
  const valueProps = {
    id: `${id}-value`,
    name: "value",
    label: C.valueLabel,
    helper: C.valueHelp,
    error: valueError ?? undefined,
    value,
    autoComplete: "off",
    spellCheck: false,
    className: "font-mono",
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={C.addTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {P14_COPY.BTN_DONT_ADD}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={pending}
            loadingLabel={C.adding}
          >
            {P14_COPY.BTN_ADD_RECORD}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={onSubmit}
        data-add-record=""
        className="flex flex-col gap-4"
      >
        <p className="text-base">{C.addBody}</p>
        {formError ? <InlineAlert tone="error">{formError}</InlineAlert> : null}
        <RadioCardGroup<OwnerRecordType>
          name={`${id}-type`}
          legend={C.typeLegend}
          value={type}
          onChange={setType}
          options={[
            { value: "TXT", title: "TXT", description: C.txtDescription },
            { value: "CNAME", title: "CNAME", description: C.cnameDescription },
          ]}
        />
        <div className="flex flex-col gap-1">
          <TextField
            id={`${id}-name`}
            name="name"
            label={C.nameLabel}
            helper={C.nameHelp(domain)}
            error={nameError ?? undefined}
            value={name}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            onChange={(e) => setName(e.currentTarget.value)}
          />
          {full ? (
            <p
              data-full-name=""
              className="font-mono text-sm [overflow-wrap:anywhere] text-hub-ink-muted"
            >
              {C.fullName(full)}
            </p>
          ) : null}
        </div>
        {type === "TXT" ? (
          <TextArea
            {...valueProps}
            rows={3}
            onChange={(e) => setValue(e.currentTarget.value)}
          />
        ) : (
          <TextField
            {...valueProps}
            onChange={(e) => setValue(e.currentTarget.value)}
          />
        )}
      </form>
    </Dialog>
  );
}
