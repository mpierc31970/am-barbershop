"use client";
// Form settings pane (07-18; CONT-25, D231, D271, D132; 07-UI-SPEC "Form settings pane").
// HEALTH-TIP (info) at the top when a label or help text looks medical, with "Add an External
// form button" opening the instructions drawer (choice 9). Then Layout (one or two columns,
// drawn thumbs), Button text (stored as after_submit.button_text), After sending (a message or
// a page), Send a copy to (email routes, choice 7) with the Settings › Email link, and the
// Newsletter sign-up switch with its wording and helper (D271: ticks are stored unconfirmed,
// nothing is mailed). Hub primitives only; navigation through LinkComponent.
import {
  DEFAULT_AFTER_MESSAGE,
  DEFAULT_BUTTON_TEXT,
  DEFAULT_NEWSLETTER_WORDING,
  HEALTH_TIP_COPY,
  MAX_AFTER_MESSAGE,
  MAX_BUTTON_TEXT,
  MAX_NEWSLETTER_WORDING,
  medicalHint,
  type AfterSubmit,
  type FormNotifyRoute,
} from "@cds/core/forms";
import type { HubLinkComponent } from "../AddonCard";
import { Button } from "../Button";
import { LayoutThumb } from "../LayoutThumb";
import { RadioCardGroup } from "../RadioCardGroup";
import { Switch } from "../Switch";
import { InlineAlert } from "../feedback";
import { Select, TextArea, TextField } from "../fields";
import {
  NAME_HELPER,
  NEWSLETTER_HELPER,
  ROUTE_LINK,
  routeOptions,
  type EmailRouteView,
  type FormDraft,
} from "./form-logic";

export interface FormSettingsPaneProps {
  draft: FormDraft;
  errors: Readonly<Record<string, string>>;
  pages: readonly { id: string; title: string }[];
  routes: readonly EmailRouteView[] | null;
  idPrefix: string;
  onChange: (patch: Partial<FormDraft>) => void;
  onExternalFormHelp: () => void;
  LinkComponent: HubLinkComponent;
}

const LINK =
  "self-start text-sm font-semibold text-hub-accent underline underline-offset-2 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

export function FormSettingsPane({
  draft,
  errors,
  pages,
  routes,
  idPrefix,
  onChange,
  onExternalFormHelp,
  LinkComponent,
}: FormSettingsPaneProps) {
  const p = idPrefix;
  const after = draft.after_submit;
  const setAfter = (patch: Partial<AfterSubmit>) =>
    onChange({ after_submit: { ...after, ...patch } });
  const hint = medicalHint(draft.fields);
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl leading-tight font-semibold text-hub-ink">
        Form settings
      </h2>
      {hint.show ? (
        <InlineAlert
          tone="info"
          action={
            <Button size="sm" variant="secondary" onClick={onExternalFormHelp}>
              Add an External form button
            </Button>
          }
        >
          {HEALTH_TIP_COPY}
        </InlineAlert>
      ) : null}
      <TextField
        id={`${p}-name`}
        label="Form name"
        helper={NAME_HELPER}
        value={draft.name}
        maxLength={80}
        error={errors.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <RadioCardGroup
        name={`${p}-layout`}
        legend="Layout"
        value={draft.layout}
        onChange={(layout) => onChange({ layout })}
        options={[
          {
            value: "1",
            title: "One column",
            adornment: (
              <LayoutThumb layout="full" selected={draft.layout === "1"} />
            ),
          },
          {
            value: "2",
            title: "Two columns",
            description: "Side by side on wide screens",
            adornment: (
              <LayoutThumb layout="50-50" selected={draft.layout === "2"} />
            ),
          },
        ]}
      />
      <TextField
        id={`${p}-button`}
        label="Button text"
        value={after.button_text}
        placeholder={DEFAULT_BUTTON_TEXT}
        maxLength={MAX_BUTTON_TEXT}
        counter={{ value: after.button_text.length, max: MAX_BUTTON_TEXT }}
        error={errors.button_text}
        onChange={(e) => setAfter({ button_text: e.target.value })}
      />
      <div className="flex flex-col gap-3">
        <RadioCardGroup
          name={`${p}-after`}
          legend="After sending"
          value={after.kind}
          onChange={(kind) => setAfter({ kind })}
          options={[
            { value: "message", title: "Show a message" },
            { value: "page", title: "Go to a page" },
          ]}
        />
        {after.kind === "message" ? (
          <TextArea
            id={`${p}-after-message`}
            label="Message"
            rows={3}
            value={after.message}
            placeholder={DEFAULT_AFTER_MESSAGE}
            maxLength={MAX_AFTER_MESSAGE}
            error={errors.after_submit}
            onChange={(e) => setAfter({ message: e.target.value })}
          />
        ) : (
          <Select
            id={`${p}-after-page`}
            label="Page"
            value={after.page}
            error={errors.after_submit}
            onChange={(e) => setAfter({ page: e.target.value })}
            options={[
              { value: "", label: "Choose a page." },
              ...pages.map((pg) => ({ value: pg.id, label: pg.title })),
            ]}
          />
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Select
          id={`${p}-route`}
          label="Send a copy to"
          value={draft.notify_route}
          onChange={(e) =>
            onChange({ notify_route: e.target.value as FormNotifyRoute })
          }
          options={routeOptions(routes, draft.notify_route)}
        />
        <LinkComponent href={ROUTE_LINK.href} className={LINK}>
          {ROUTE_LINK.label}
        </LinkComponent>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-hub-ink">
          Newsletter sign-up
        </legend>
        <Switch
          id={`${p}-newsletter`}
          label="Add a newsletter checkbox"
          checked={draft.newsletter_checkbox}
          onChange={(v) =>
            onChange({
              newsletter_checkbox: v,
              newsletter_wording:
                v && draft.newsletter_wording.trim() === ""
                  ? DEFAULT_NEWSLETTER_WORDING
                  : draft.newsletter_wording,
            })
          }
        />
        {draft.newsletter_checkbox ? (
          <TextField
            id={`${p}-newsletter-wording`}
            label="Checkbox wording"
            value={draft.newsletter_wording}
            maxLength={MAX_NEWSLETTER_WORDING}
            error={errors.newsletter_wording}
            onChange={(e) => onChange({ newsletter_wording: e.target.value })}
          />
        ) : null}
        <p className="text-sm text-hub-ink-muted">{NEWSLETTER_HELPER}</p>
      </fieldset>
    </div>
  );
}
