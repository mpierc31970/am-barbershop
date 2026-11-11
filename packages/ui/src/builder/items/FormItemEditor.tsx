"use client";
// Form item editor (07-08, finished by 07-18; CONT-25, D119, D275; 07-UI-SPEC "Column items",
// DELETED-REF). Picks one of the site's forms (the `forms` prop when given, else the
// FormOptionsProvider context from the builder or pop-up editor, 07-18 choice 3). A deleted
// form stays chosen and shows DELETED-REF with Choose another. Below, "New form from a
// template" + Create and use makes a form in place and selects it at once (choice 4), with a
// toast linking to its editor in a new tab. With no forms an info notice links to Website ›
// Forms in a new tab. Old callers with neither prop nor provider keep the 07-08 behaviour
// apart from the new copy.
import { FORM_TEMPLATES } from "@cds/core/forms";
import { useId, useState } from "react";
import { Button } from "../../hub/Button";
import { useToast } from "../../hub/Toast";
import { InlineAlert } from "../../hub/feedback";
import { Select } from "../../hub/fields";
import {
  DELETED_REF_COPY,
  ITEM_CREATED_TOAST,
  ITEM_NO_FORMS_COPY,
} from "../../hub/forms/form-logic";
import { useFormOptions, type FormOptionsContextValue } from "./form-options";
import type { FormItemEditorProps } from "./types";

export const NO_FORMS_COPY = ITEM_NO_FORMS_COPY;
const NEW_FORM_HREF = "/hub/website?tab=forms&form=new";
const LINK_CLASS =
  "font-semibold text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

function editHref(id: string): string {
  return `/hub/website?tab=forms&form=${encodeURIComponent(id)}`;
}

const TEMPLATE_OPTIONS = FORM_TEMPLATES.map((t) => ({
  value: t.id,
  label: t.label,
}));

function TemplateCreator({
  options,
  fid,
  onCreated,
}: {
  options: FormOptionsContextValue;
  fid: (name: string) => string;
  onCreated: (id: string) => void;
}) {
  const [template, setTemplate] = useState("contact");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function create() {
    if (pending) return;
    setPending(true);
    setError(null);
    const res = await options.createForm(template);
    setPending(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onCreated(res.option.id);
    toast.show({
      message: ITEM_CREATED_TOAST,
      action: {
        label: "Edit this form",
        onClick: () => {
          window.open(editHref(res.option.id), "_blank", "noopener");
        },
      },
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-hub-border p-3">
      <Select
        id={fid("new_form_template")}
        label="New form from a template"
        value={template}
        options={TEMPLATE_OPTIONS}
        onChange={(e) => setTemplate(e.target.value)}
      />
      <Button
        variant="secondary"
        loading={pending}
        loadingLabel="Creating…"
        onClick={() => void create()}
        className="self-start"
      >
        Create and use
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-hub-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormItemEditor({
  draft,
  patch,
  errors,
  fid,
  forms,
}: FormItemEditorProps) {
  const ctx = useFormOptions();
  const list = forms ?? ctx?.forms ?? [];
  const deletedId = useId();
  const creator = ctx ? (
    <TemplateCreator
      options={ctx}
      fid={fid}
      onCreated={(id) => patch({ form_id: id })}
    />
  ) : null;

  if (list.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div id={fid("form_id")} tabIndex={-1} className="flex flex-col gap-2">
          <InlineAlert
            tone="info"
            action={
              <a
                href={NEW_FORM_HREF}
                target="_blank"
                rel="noopener"
                className={LINK_CLASS}
              >
                build it in Forms
              </a>
            }
          >
            {NO_FORMS_COPY}
          </InlineAlert>
          {errors.form_id ? (
            <p className="text-sm text-hub-danger">{errors.form_id}</p>
          ) : null}
        </div>
        {creator}
      </div>
    );
  }
  const chosen = list.find((f) => f.id === draft.form_id);
  return (
    <div className="flex flex-col gap-3">
      <Select
        id={fid("form_id")}
        label="Form"
        value={draft.form_id}
        error={errors.form_id}
        onChange={(e) => patch({ form_id: e.target.value })}
        options={[
          { value: "", label: "Choose a form" },
          ...list.map((f) => ({
            value: f.id,
            label: f.deleted ? `${f.name} (deleted)` : f.name,
          })),
        ]}
      />
      {chosen?.deleted ? (
        <div id={deletedId}>
          <InlineAlert
            tone="info"
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => document.getElementById(fid("form_id"))?.focus()}
              >
                Choose another
              </Button>
            }
          >
            {DELETED_REF_COPY}
          </InlineAlert>
        </div>
      ) : null}
      {chosen ? (
        <a
          href={editHref(chosen.id)}
          target="_blank"
          rel="noopener"
          className={`self-start text-sm ${LINK_CLASS}`}
        >
          Edit this form
        </a>
      ) : null}
      {creator}
    </div>
  );
}
