"use client";
// Service drawer (06-20; 06-UI-SPEC "Team, Services › Services"; ONB-01, D37). Right Drawer,
// 480px: Name (required), Description (600, counter), Price (Fixed price / Starting at /
// Free / Ask for a price), Amount (shown and required for Fixed and Starting at), Duration,
// Show on site. Save service (disabled until something changed), Discard changes, and a leave
// guard on a dirty close. The amount is sent as typed ("$45", "45.00"): the action turns it
// into cents with the spreadsheet's price rule and validateService owns the price rules, so
// the client check here is a courtesy.
import type { PriceDisplay } from "@cds/core/intake";
import {
  Badge,
  Button,
  Dialog,
  Drawer,
  IconButton,
  InlineAlert,
  RadioCardGroup,
  Select,
  Switch,
  TextArea,
  TextField,
} from "@cds/ui/hub";
import { X } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { ServiceView } from "../../../../lib/intake";
import { saveServiceAction } from "../../../actions/core-lists";
import { parseMoney } from "./list-helpers";

export const SERVICE_DRAWER = {
  newTitle: "Add a service",
  editTitle: (name: string) => `Edit ${name}`,
  close: "Close",
  name: "Name",
  nameEmpty: "Add a name.",
  description: "Description",
  price: "Price",
  amount: "Amount",
  amountHelper: "In dollars, like 45 or 45.00.",
  amountEmpty: "Add a price, like 45 or 45.00.",
  duration: "Duration",
  showOnSite: "Show on site",
  save: "Save service",
  saving: "Saving…",
  discard: "Discard changes",
  failed:
    "Your changes weren't saved. Try again; if it keeps failing, copy your text somewhere safe first.",
  guardTitle: "Save changes to this service?",
  guardBody: "You have changes that aren't saved yet.",
  guardSave: "Save and close",
  guardKeep: "Keep editing",
} as const;

export const PRICE_OPTIONS: readonly { value: PriceDisplay; title: string }[] =
  [
    { value: "fixed", title: "Fixed price" },
    { value: "from", title: "Starting at" },
    { value: "free", title: "Free" },
    { value: "ask", title: "Ask for a price" },
  ];

export const DURATION_OPTIONS = [
  { value: "", label: "No set length" },
  ...[15, 30, 45, 60, 75, 90, 120].map((n) => ({
    value: String(n),
    label: `${n} minutes`,
  })),
  { value: "varies", label: "Longer or varies" },
] as const;

/**
 * The duration list, plus a stored length that isn't one of the presets (a CSV import of 20
 * or 50 minutes) in its place by length, so the select shows what is saved (C-WR-08).
 */
export function durationOptions(
  current: string,
): readonly { value: string; label: string }[] {
  if (current === "" || DURATION_OPTIONS.some((o) => o.value === current)) {
    return DURATION_OPTIONS;
  }
  const n = Number(current);
  const extra = { value: current, label: `${n} minutes` };
  const at = DURATION_OPTIONS.findIndex(
    (o) => o.value === "varies" || (o.value !== "" && Number(o.value) > n),
  );
  return [
    ...DURATION_OPTIONS.slice(0, at),
    extra,
    ...DURATION_OPTIONS.slice(at),
  ];
}

const DESCRIPTION_MAX = 600;

type Form = {
  name: string;
  description: string;
  price_display: PriceDisplay;
  amount: string;
  duration: string;
  is_published: boolean;
};

function amountOf(cents: number | null): string {
  if (!cents) return "";
  const frac = cents % 100;
  return frac === 0
    ? String(cents / 100)
    : `${Math.floor(cents / 100)}.${String(frac).padStart(2, "0")}`;
}

function formOf(s: ServiceView | null): Form {
  return {
    name: s?.name ?? "",
    description: s?.description ?? "",
    price_display: s?.price_display ?? "fixed",
    amount: amountOf(s?.price_cents ?? null),
    duration: s?.duration_minutes ? String(s.duration_minutes) : "",
    is_published: s ? s.is_published : true,
  };
}

export const needsAmount = (p: PriceDisplay) => p === "fixed" || p === "from";

export interface ServiceDrawerProps {
  /** null while adding. */
  service: ServiceView | null;
  /** `held` = the publish scan held it, so it was saved hidden (13-52, D270). */
  onSaved: (service: ServiceView, held: boolean) => void;
  onClose: () => void;
}

export function ServiceDrawer({
  service,
  onSaved,
  onClose,
}: ServiceDrawerProps) {
  const uid = useId();
  const initial = useRef(formOf(service)).current;
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<{ name?: string; amount?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [guard, setGuard] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const id = (k: string) => `${uid}-${k}`;
  const title = service
    ? SERVICE_DRAWER.editTitle(service.name)
    : SERVICE_DRAWER.newTitle;

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === "name" || k === "amount") {
      setErrors((e) => ({ ...e, [k]: undefined }));
    }
  }

  async function save(): Promise<void> {
    const name = form.name.trim();
    const next: { name?: string; amount?: string } = {};
    if (name === "") next.name = SERVICE_DRAWER.nameEmpty;
    const priced = needsAmount(form.price_display);
    if (priced && parseMoney(form.amount) === null) {
      next.amount = SERVICE_DRAWER.amountEmpty;
    }
    if (next.name || next.amount) {
      setErrors(next);
      document.getElementById(id(next.name ? "name" : "amount"))?.focus();
      return;
    }
    const minutes = Number(form.duration);
    setSaving(true);
    setFailure(null);
    const res = await saveServiceAction(
      {
        name,
        description: form.description.trim(),
        price_display: form.price_display,
        price: priced ? form.amount.trim() : "",
        duration_minutes:
          form.duration === "" || form.duration === "varies" ? null : minutes,
        is_published: form.is_published,
      },
      service?.id,
    ).catch(() => null);
    setSaving(false);
    if (!res) {
      setFailure(SERVICE_DRAWER.failed);
      return;
    }
    if (!res.ok) {
      setFailure(res.message || SERVICE_DRAWER.failed);
      return;
    }
    const d = res.data;
    onSaved(
      {
        id: d.id,
        name: d.name,
        description: d.description,
        price_display: d.price_display,
        price_cents: d.price_cents,
        duration_minutes: d.duration_minutes,
        is_published: d.is_published,
      },
      d.held === true,
    );
  }

  function requestClose() {
    if (saving) return;
    if (dirty) setGuard(true);
    else onClose();
  }

  return (
    <>
      <Drawer open onClose={requestClose} label={title} side="right">
        <div className="flex min-h-full flex-col font-hub text-hub-ink">
          <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
            <h2 className="text-xl leading-tight font-semibold">{title}</h2>
            <IconButton
              label={SERVICE_DRAWER.close}
              tooltipAlign="end"
              onClick={requestClose}
              icon={<X aria-hidden size={20} strokeWidth={2} />}
            />
          </div>
          <div className="flex flex-1 flex-col gap-6 px-6 py-6">
            <TextField
              id={id("name")}
              label={SERVICE_DRAWER.name}
              required
              maxLength={80}
              value={form.name}
              error={errors.name}
              onChange={(e) => set("name", e.target.value)}
            />
            <TextArea
              id={id("description")}
              label={SERVICE_DRAWER.description}
              labelExtra={<Badge tone="optional">Optional</Badge>}
              rows={4}
              value={form.description}
              counter={{
                value: form.description.length,
                max: DESCRIPTION_MAX,
              }}
              error={
                form.description.trim().length > DESCRIPTION_MAX
                  ? `The description is longer than ${DESCRIPTION_MAX} characters.`
                  : undefined
              }
              onChange={(e) => set("description", e.target.value)}
            />
            <RadioCardGroup<PriceDisplay>
              name={id("price")}
              legend={SERVICE_DRAWER.price}
              options={PRICE_OPTIONS}
              value={form.price_display}
              onChange={(v) => set("price_display", v)}
            />
            {needsAmount(form.price_display) ? (
              <TextField
                id={id("amount")}
                label={SERVICE_DRAWER.amount}
                required
                inputMode="decimal"
                helper={SERVICE_DRAWER.amountHelper}
                value={form.amount}
                error={errors.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            ) : null}
            <Select
              id={id("duration")}
              label={SERVICE_DRAWER.duration}
              labelExtra={<Badge tone="optional">Optional</Badge>}
              options={durationOptions(form.duration)}
              value={form.duration}
              onChange={(e) => set("duration", e.target.value)}
            />
            <Switch
              id={id("shown")}
              label={SERVICE_DRAWER.showOnSite}
              checked={form.is_published}
              onChange={(v) => set("is_published", v)}
            />
          </div>
          <div className="sticky bottom-0 flex flex-col gap-3 border-t border-hub-border bg-hub-surface px-6 py-4">
            {failure ? <InlineAlert tone="error">{failure}</InlineAlert> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={!dirty}
                loading={saving}
                loadingLabel={SERVICE_DRAWER.saving}
                onClick={() => void save()}
              >
                {SERVICE_DRAWER.save}
              </Button>
              {dirty ? (
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setForm(initial);
                    setErrors({});
                    setFailure(null);
                  }}
                >
                  {SERVICE_DRAWER.discard}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Drawer>
      <Dialog
        open={guard}
        onClose={() => setGuard(false)}
        title={SERVICE_DRAWER.guardTitle}
        footer={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setGuard(false);
                void save();
              }}
            >
              {SERVICE_DRAWER.guardSave}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setGuard(false);
                onClose();
              }}
            >
              {SERVICE_DRAWER.discard}
            </Button>
            <Button variant="ghost" autoFocus onClick={() => setGuard(false)}>
              {SERVICE_DRAWER.guardKeep}
            </Button>
          </>
        }
      >
        <p>{SERVICE_DRAWER.guardBody}</p>
      </Dialog>
    </>
  );
}
