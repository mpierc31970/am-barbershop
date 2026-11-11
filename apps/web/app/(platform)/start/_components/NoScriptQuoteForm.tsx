// The /start configurator with JavaScript off (06-UI-SPEC "Configurator states" JS off;
// D-UI-P6-36). A server-rendered form with real radios and checkboxes that posts to
// updateQuoteFormAction and reloads /start, plus the receipt rendered on the server from
// the stored quote's totals. The page wraps this in <noscript>, so a browser with scripts
// never sees it; the client Configurator is the enhanced version of the same flow.
// Progressive like the client flow: path, then business type, then add-ons + extras.
import {
  businessTypesFor,
  findBusinessType,
  pickableAddons,
  pickSourceFrom,
  type Extra,
  type PathInfo,
  type PickableAddon,
} from "@cds/core/onboarding";
import type { CatalogRow } from "@cds/core/pricing";
import type { QuoteView } from "@cds/db";
import { Badge, buttonClasses, InlineAlert } from "@cds/ui/hub";
import { addonPreselectedLine } from "@cds/core/marketing";
import { updateQuoteFormAction } from "../../../actions/quote";
import { HostingFaq } from "./HostingFaq";
import { Receipt } from "./Receipt";
import { StartFrame } from "./StartFrame";
import {
  catalogRow,
  currentStep,
  OTHER_LABEL,
  OTHER_MAX,
  pathPriceLine,
  priceLabelFor,
  type StartPreselect,
} from "./start-logic";

export interface NoScriptQuoteFormProps {
  quote: QuoteView | null;
  catalog: CatalogRow[] | null;
  addons: PickableAddon[];
  /** 13-32: listed add-ons that can't be picked yet (disabled, "Coming soon"). */
  comingSoon?: readonly string[];
  paths: readonly PathInfo[];
  extras: readonly Extra[];
  /** The last submit failed (?e=quote): show ERR-QUOTE. */
  failed?: boolean;
  /** 15-21: a hub CTA's validated preselect; ignored when the quote already has a path. */
  preselect?: StartPreselect | null;
}

const ERR_QUOTE =
  "We couldn't save your latest choice. Check your connection; we'll try again with your next change.";

const CHOICE =
  "flex cursor-pointer items-start gap-3 rounded-lg border border-hub-border p-4 " +
  "has-checked:border-2 has-checked:border-hub-accent has-checked:bg-hub-accent-tint";
const INPUT = "mt-1 h-5 w-5 shrink-0 accent-hub-accent";
const LEGEND = "mt-12 mb-4 text-xl leading-tight font-semibold";

export function NoScriptQuoteForm({
  quote,
  catalog,
  addons,
  comingSoon = [],
  paths,
  extras,
  failed,
  preselect = null,
}: NoScriptQuoteFormProps) {
  // P15-P25: a stored path wins; otherwise the preselect sets the initial values.
  const pre = quote?.path ? null : preselect;
  const path = quote?.path || pre?.path || "";
  const preAddon = pre?.addon?.slug ?? null;
  const type = findBusinessType(quote?.businessType ?? "");
  const typeChosen =
    Boolean(type) &&
    (quote?.businessType !== "other" ||
      (quote?.businessTypeOther ?? "").trim() !== "");
  const stored = quote?.selections ?? {
    addons: [],
    extras: [],
    carePlan: false,
    cadence: "monthly" as const,
  };
  const selections =
    preAddon && !stored.addons.includes(preAddon)
      ? { ...stored, addons: [...stored.addons, preAddon] }
      : stored;
  // Until the add-on list shows, the preselected add-on rides along as hidden fields so
  // the first "Update my quote" saves it (only when nothing else is picked yet).
  const carryAddon =
    preAddon !== null &&
    stored.addons.length === 0 &&
    stored.extras.length === 0;
  const lists =
    path && type
      ? pickableAddons(pickSourceFrom(addons), path, type.id)
      : { recommended: [], rest: [] };
  const pickable = [...lists.recommended, ...lists.rest];
  const careRow = path ? catalogRow(catalog, "care_plan", "care", path) : null;

  return (
    <StartFrame
      step={currentStep({
        path,
        businessType: typeChosen ? (quote?.businessType ?? "") : "",
      })}
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,720px)_360px] lg:items-start lg:gap-12">
        <form action={updateQuoteFormAction} className="flex min-w-0 flex-col">
          {failed ? (
            <div className="mb-8">
              <InlineAlert tone="error">{ERR_QUOTE}</InlineAlert>
            </div>
          ) : null}
          <h1 className="text-[1.75rem] leading-tight font-semibold">
            Build your website
          </h1>
          <p className="mt-2 max-w-[56ch] text-base text-hub-ink-muted">
            Pick your path and the add-ons you want. Your price updates as you
            go, and you&apos;ll see the full cost before you commit.
          </p>

          <fieldset>
            <legend className={LEGEND}>Which sounds like you?</legend>
            <div className="grid gap-4 md:grid-cols-2">
              {paths
                .filter((p) => p.available)
                .map((p) => (
                  <label key={p.id} className={CHOICE}>
                    <input
                      type="radio"
                      name="path"
                      value={p.id}
                      defaultChecked={path === p.id}
                      className={INPUT}
                    />
                    <span className="flex flex-col gap-1">
                      <span className="text-xl font-semibold">{p.label}</span>
                      <span>{p.whoFor}</span>
                      <span className="text-sm text-hub-ink-muted">
                        {p.examples}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {pathPriceLine(catalog, p.id) ?? ""}
                      </span>
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>

          {path ? (
            <fieldset>
              <legend className={LEGEND}>What kind of business?</legend>
              <div className="flex flex-wrap gap-2">
                {businessTypesFor(path).map((t) => (
                  <label
                    key={t.id}
                    className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-hub-border-strong px-4 has-checked:border-2 has-checked:border-hub-accent has-checked:bg-hub-accent-tint"
                  >
                    <input
                      type="radio"
                      name="businessType"
                      value={t.id}
                      defaultChecked={quote?.businessType === t.id}
                      className="accent-hub-accent"
                    />
                    {t.label}
                  </label>
                ))}
              </div>
              <div className="mt-4 flex max-w-md flex-col gap-2">
                <label
                  htmlFor="start-nojs-other"
                  className="text-sm font-semibold"
                >
                  {OTHER_LABEL}
                </label>
                <input
                  id="start-nojs-other"
                  name="businessTypeOther"
                  maxLength={OTHER_MAX}
                  defaultValue={quote?.businessTypeOther ?? ""}
                  className="h-10 rounded border border-hub-border-strong px-3"
                />
              </div>
            </fieldset>
          ) : null}

          <div className="mt-8">
            <HostingFaq />
          </div>

          {carryAddon && preAddon && !(path && typeChosen) ? (
            <>
              <input type="hidden" name="hasSelections" value="1" />
              <input type="hidden" name="addons" value={preAddon} />
            </>
          ) : null}

          {path && typeChosen ? (
            <>
              <input type="hidden" name="hasSelections" value="1" />
              {pre?.addon ? (
                <div className="mt-8">
                  <InlineAlert tone="info">
                    {addonPreselectedLine(pre.addon.name)}
                  </InlineAlert>
                </div>
              ) : null}
              <fieldset>
                <legend className={LEGEND}>
                  Recommended for {type?.plural ?? "you"}
                </legend>
                <p className="mb-4 text-base text-hub-ink-muted">
                  Every site includes up to 10 pages you edit yourself, hosting
                  and support. Add-ons chosen now have no setup fee.
                </p>
                <ul className="flex flex-col">
                  {pickable.map((a) => {
                    const soon = comingSoon.includes(a.slug);
                    return (
                      <li key={a.slug}>
                        <label
                          className={
                            "flex items-start gap-3 border-b border-hub-border p-4 " +
                            (soon ? "cursor-not-allowed" : "cursor-pointer")
                          }
                        >
                          <input
                            type="checkbox"
                            name="addons"
                            value={a.slug}
                            disabled={soon}
                            defaultChecked={
                              !soon && selections.addons.includes(a.slug)
                            }
                            className={INPUT}
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{a.name}</span>
                              {soon ? (
                                <Badge tone="coming-soon">Coming soon</Badge>
                              ) : null}
                            </span>
                            <span className="text-hub-ink-muted">
                              {a.summary}
                            </span>
                          </span>
                          <span className="font-semibold tabular-nums">
                            {priceLabelFor(
                              catalogRow(catalog, "addon", a.slug, path),
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
              <fieldset>
                <legend className={LEGEND}>Want help with any of these?</legend>
                <ul className="flex flex-col">
                  {extras.map((x) => (
                    <li key={x.key}>
                      <label className="flex cursor-pointer items-start gap-3 border-b border-hub-border p-4">
                        <input
                          type="checkbox"
                          name="extras"
                          value={x.key}
                          defaultChecked={selections.extras.includes(x.key)}
                          className={INPUT}
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="font-semibold">{x.label}</span>
                          <span className="text-hub-ink-muted">
                            {x.description}
                          </span>
                        </span>
                        <span className="font-semibold tabular-nums">
                          {priceLabelFor(
                            catalogRow(catalog, "extra", x.key, path),
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
              <fieldset>
                <legend className={LEGEND}>Care Plan and billing</legend>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    name="carePlan"
                    defaultChecked={selections.carePlan}
                    className={INPUT}
                  />
                  <span>
                    Add the Care Plan · {priceLabelFor(careRow)}
                    <span className="block text-sm text-hub-ink-muted">
                      We make changes for you, beyond how-to help.
                    </span>
                  </span>
                </label>
                <div className="mt-4 flex flex-wrap gap-4">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="cadence"
                      value="monthly"
                      defaultChecked={selections.cadence !== "yearly"}
                      className="accent-hub-ink"
                    />
                    Monthly
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="cadence"
                      value="yearly"
                      defaultChecked={selections.cadence === "yearly"}
                      className="accent-hub-ink"
                    />
                    Yearly, 2 months free
                  </label>
                </div>
              </fieldset>
            </>
          ) : null}

          <div className="mt-8">
            <button type="submit" className={buttonClasses("secondary")}>
              Update my quote
            </button>
          </div>
        </form>
        <div className="mt-12 lg:sticky lg:top-8 lg:mt-0">
          <Receipt
            catalog={catalog}
            path={path}
            typeChosen={typeChosen}
            selections={selections}
            serverTotals={quote?.totals ?? null}
            addonNames={Object.fromEntries(addons.map((a) => [a.slug, a.name]))}
            extras={extras}
            paths={paths}
            savedEmail={quote?.email || null}
            interactive={false}
            idPrefix="receipt-nojs"
          />
        </div>
      </div>
    </StartFrame>
  );
}
