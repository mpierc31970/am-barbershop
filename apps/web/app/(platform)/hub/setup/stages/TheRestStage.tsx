"use client";
// Step 7 · Domain & the rest (06-18; 06-UI-SPEC "7 · Domain & the rest"; ONB-01,
// D-UI-P6-25). Three field groups, each field saving itself (blur for text, change for
// radios and selects) through saveAnswersAction / saveProfileAction("the-rest", …):
//   - Your web address: I have a domain (Domain with live clean-up of https:// and www.,
//     Where did you buy it?) · I need a domain (Ideas for your address) · decide later,
//     the default. Connecting it happens before launch (P14).
//   - Integrations: Google Analytics ID (G-XXXXXXXXXX, checked here before it is sent) and
//     Do you have a Google Business Profile? Yes / No / Not sure.
//   - Legal details: legal business name, privacy contact email, state / country.
// Every field is optional (each helper ends with what happens if it stays empty). An Editor
// sees every field disabled (the frame shows the read-only line).
import type { DomainChoice, GbpAnswer, IntakeAnswers } from "@cds/core/intake";
import {
  Badge,
  RadioCardGroup,
  Select,
  TextField,
  type RadioCardOption,
} from "@cds/ui/hub";
import { useRef, useState, type ReactNode } from "react";
import {
  saveAnswersAction,
  saveProfileAction,
} from "../../../../actions/intake";
import { useStageAutosave, useStageInvalid } from "../[stage]/StageFrame";
import type { StageFormProps } from "../[stage]/stage-forms";

export const DOMAIN_OPTIONS: readonly RadioCardOption<DomainChoice>[] = [
  { value: "have", title: "I have a domain" },
  { value: "need", title: "I need a domain" },
  {
    value: "later",
    title: "Decide later",
    description: "Your site works on its preview address until you choose.",
  },
];

const REGISTRAR_OPTIONS = [
  { value: "", label: "Choose one" },
  { value: "hostinger", label: "Hostinger" },
  { value: "godaddy", label: "GoDaddy" },
  { value: "namecheap", label: "Namecheap" },
  { value: "squarespace", label: "Squarespace (was Google Domains)" },
  { value: "cloudflare", label: "Cloudflare" },
  { value: "other", label: "Other" },
  { value: "not_sure", label: "Not sure" },
] as const;

const GBP_OPTIONS: readonly RadioCardOption<Exclude<GbpAnswer, "">>[] = [
  { value: "yes", title: "Yes" },
  { value: "no", title: "No" },
  { value: "not_sure", title: "Not sure" },
];

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
  "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota",
  "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const; // prettier-ignore

const COUNTRIES = ["Canada", "Mexico", "United Kingdom", "Australia"] as const;

export const GA4_ERROR =
  "A Google Analytics ID looks like G-XXXXXXXXXX. Check it and try again.";

/** Live clean-up while typing: "https://www.RiveraBakery.com" -> "riverabakery.com". */
export function liveDomain(raw: string): string {
  return raw
    .trimStart()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "");
}

export function ga4Error(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  return v === "" || /^G-[A-Z0-9]{4,12}$/.test(v) ? null : GA4_ERROR;
}

function regionOptions(current: string, addressState: string) {
  const first = addressState
    ? `Use the state from your address (${addressState})`
    : "Choose one";
  const names: string[] = [...US_STATES, ...COUNTRIES];
  if (current && !names.includes(current)) names.unshift(current);
  return [
    { value: "", label: first },
    ...names.map((n) => ({ value: n, label: n })),
  ];
}

const OPTIONAL = <Badge tone="optional">Optional</Badge>;

function Group({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2
          id={id}
          className="text-xl leading-tight font-semibold text-hub-ink"
        >
          {title}
        </h2>
        {intro ? <p className="text-sm text-hub-ink-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

type Patch = Record<string, unknown>;
const merge = (a: Patch, b: Patch): Patch => ({ ...a, ...b });

/**
 * One autosaved field: saves { [key]: value } through the step's action, skips a value
 * that was already sent (unless the last send failed), and exposes the refusal copy.
 */
function useField(
  kind: "answers" | "profile",
  key: keyof IntakeAnswers | string,
  initial: unknown,
) {
  const auto = useStageAutosave<Patch>(
    `${kind}.${key}`,
    (v) =>
      kind === "answers"
        ? saveAnswersAction("the-rest", v)
        : saveProfileAction("the-rest", v),
    { merge },
  );
  const last = useRef(JSON.stringify(initial));
  return {
    save(value: unknown) {
      const k = JSON.stringify(value);
      if (
        k === last.current &&
        auto.status !== "invalid" &&
        auto.status !== "error"
      ) {
        return;
      }
      last.current = k;
      auto.run({ [key]: value });
    },
    error: auto.status === "invalid" ? auto.failure?.message : undefined,
  };
}

export function TheRestStage({ data, readOnly }: StageFormProps) {
  const a = data.answers;
  const p = data.profile;
  const [choice, setChoice] = useState<DomainChoice>(a.domain_choice);
  const [domain, setDomain] = useState(a.domain);
  const [registrar, setRegistrar] = useState(a.registrar);
  const [ideas, setIdeas] = useState(a.domain_ideas);
  const [ga4, setGa4] = useState(p.ga4_id);
  const [ga4Local, setGa4Local] = useState<string | null>(null);
  const [gbp, setGbp] = useState<GbpAnswer>(a.gbp);
  const [legalName, setLegalName] = useState(p.legal_name);
  const [privacy, setPrivacy] = useState(p.privacy_contact);
  const [region, setRegion] = useState(p.legal_region);

  const saveChoice = useField("answers", "domain_choice", a.domain_choice);
  const saveDomain = useField("answers", "domain", a.domain);
  const saveRegistrar = useField("answers", "registrar", a.registrar);
  const saveIdeas = useField("answers", "domain_ideas", a.domain_ideas);
  const saveGbp = useField("answers", "gbp", a.gbp);
  const saveGa4 = useField("profile", "ga4_id", p.ga4_id);
  const saveLegalName = useField("profile", "legal_name", p.legal_name);
  const savePrivacy = useField("profile", "privacy_contact", p.privacy_contact);
  const saveRegion = useField("profile", "legal_region", p.legal_region);
  useStageInvalid("local.ga4_id", ga4Local !== null);

  return (
    <>
      <Group id="group-domain" title="Your web address">
        <div id="field-domain_choice" tabIndex={-1} className="outline-none">
          <RadioCardGroup
            name="domain_choice"
            legend="Your web address"
            hideLegend
            options={DOMAIN_OPTIONS.map((o) => ({ ...o, disabled: readOnly }))}
            value={choice}
            onChange={(v) => {
              setChoice(v);
              saveChoice.save(v);
            }}
          />
        </div>
        {saveChoice.error ? (
          <p className="text-sm text-hub-danger">{saveChoice.error}</p>
        ) : null}
        {choice === "have" ? (
          <div className="flex flex-col gap-4">
            <TextField
              id="field-domain"
              label="Domain"
              placeholder="riverabakery.com"
              helper="Like riverabakery.com. You don't need the https:// or www."
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={domain}
              disabled={readOnly}
              error={saveDomain.error}
              onChange={(e) => setDomain(liveDomain(e.target.value))}
              onBlur={() => {
                saveDomain.save(domain.trim());
              }}
            />
            <Select
              id="field-registrar"
              label="Where did you buy it?"
              options={REGISTRAR_OPTIONS}
              value={registrar}
              disabled={readOnly}
              error={saveRegistrar.error}
              onChange={(e) => {
                setRegistrar(e.target.value);
                saveRegistrar.save(e.target.value);
              }}
            />
          </div>
        ) : null}
        {choice === "need" ? (
          <TextField
            id="field-domain_ideas"
            label="Ideas for your address"
            labelExtra={OPTIONAL}
            helper="Support will suggest a few that are free to register."
            maxLength={300}
            value={ideas}
            disabled={readOnly}
            error={saveIdeas.error}
            onChange={(e) => setIdeas(e.target.value)}
            onBlur={() => saveIdeas.save(ideas.trim())}
          />
        ) : null}
        <p className="text-sm text-hub-ink-muted">
          We&apos;ll connect it for you before launch.
        </p>
      </Group>

      <Group id="group-integrations" title="Integrations">
        <TextField
          id="field-ga4_id"
          label="Google Analytics ID"
          labelExtra={OPTIONAL}
          placeholder="G-XXXXXXXXXX"
          helper="Only if you already use Google Analytics."
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          value={ga4}
          disabled={readOnly}
          error={ga4Local ?? saveGa4.error}
          onChange={(e) => {
            setGa4(e.target.value);
            if (ga4Local) setGa4Local(ga4Error(e.target.value));
          }}
          onBlur={() => {
            const v = ga4.trim().toUpperCase();
            const err = ga4Error(v);
            setGa4Local(err);
            if (err) return;
            setGa4(v);
            saveGa4.save(v);
          }}
        />
        <div
          id="field-gbp"
          tabIndex={-1}
          className="flex flex-col gap-2 outline-none"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-hub-ink">
            <span aria-hidden>Do you have a Google Business Profile?</span>
            {OPTIONAL}
          </p>
          <RadioCardGroup
            name="gbp"
            legend="Do you have a Google Business Profile?"
            hideLegend
            options={GBP_OPTIONS.map((o) => ({ ...o, disabled: readOnly }))}
            value={gbp === "" ? null : gbp}
            onChange={(v) => {
              setGbp(v);
              saveGbp.save(v);
            }}
          />
          {saveGbp.error ? (
            <p className="text-sm text-hub-danger">{saveGbp.error}</p>
          ) : null}
        </div>
      </Group>

      <Group
        id="group-legal"
        title="Legal details"
        intro="For your privacy and terms pages."
      >
        <TextField
          id="field-legal_name"
          label="Legal business name"
          labelExtra={OPTIONAL}
          helper="If it differs from your business name, like 'Rivera Bakery LLC'. Leave empty and we'll use your business name."
          autoComplete="organization"
          maxLength={120}
          value={legalName}
          disabled={readOnly}
          error={saveLegalName.error}
          onChange={(e) => setLegalName(e.target.value)}
          onBlur={() => saveLegalName.save(legalName.trim())}
        />
        <TextField
          id="field-privacy_contact"
          label="Privacy contact email"
          labelExtra={OPTIONAL}
          type="email"
          autoComplete="email"
          helper={
            p.public_email
              ? `Leave empty and we'll use your public email, ${p.public_email}.`
              : "Leave empty and we'll use your public email."
          }
          value={privacy}
          disabled={readOnly}
          error={savePrivacy.error}
          onChange={(e) => setPrivacy(e.target.value)}
          onBlur={() => savePrivacy.save(privacy.trim())}
        />
        <Select
          id="field-legal_region"
          label="State / country"
          labelExtra={OPTIONAL}
          options={regionOptions(region, p.address.state)}
          value={region}
          disabled={readOnly}
          error={saveRegion.error}
          onChange={(e) => {
            setRegion(e.target.value);
            saveRegion.save(e.target.value);
          }}
        />
      </Group>
    </>
  );
}
