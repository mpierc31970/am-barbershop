"use client";
// WindowForm (13-36 choices 1-2; STAFF-10, STAFF-11, D99-D102, D-UI-P13-6; 13-UI-SPEC
// "Service windows" lines 566-583, WINDOW-RANGE line 1056). The console's planned-work window:
//   1. Scope (ScopePicker; platform / add-on disabled with SUPER-ONLY unless `allowed`).
//   2. Target: Site (filterable select over the sites list), then that site's Page or Part
//      (Header, Footer, Menus or an add-on active there, fetched with `loadTargets`); Add-on
//      scope picks from the registry names.
//   3. When: quick times Now · +1 hour · +4 hours · Tonight 10 pm–2 am (business time, core
//      `applyWindowPreset`), then native datetime-local Starts / Ends read as Central.
//      WINDOW-RANGE: ends after starts, within 7 days.
//   4. Message: 160 characters, counter always visible.
//   5. Link to incident (optional, open incidents only).
//   6. Owners see: the P12 ServiceNoticeStrip in a framed hub-top mock, active or planned by
//      the start time, built from the same core copy the hub uses.
//   7. Footer: the STAFF-11 bypass line, primary Create window, ghost Discard window.
// `onCreate` is the caller's useStaffAction-wrapped action (step-up for wide scopes lives
// there); the form keeps every input on a refusal and shows its message.
import { P13_COPY } from "@cds/core/staff";
import {
  applyWindowPreset,
  formatNoticeEnd,
  formatNoticeWhen,
  fromBusinessLocalInput,
  noticeActiveText,
  noticePlannedText,
  noticeTarget,
  SITE_PARTS,
  toBusinessLocalInput,
  WINDOW_MESSAGE_MAX,
  WINDOW_PRESET_LABELS,
  WINDOW_PRESETS,
  WINDOW_UPCOMING_MS,
  windowRangeOk,
  type ServiceNotice,
  type WindowPreset,
  type WindowScope,
} from "@cds/core/support";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "../../hub/Button";
import { InlineAlert } from "../../hub/feedback";
import { Select, TextArea, TextField } from "../../hub/fields";
import { ServiceNoticeStrip } from "../../hub/support/notices";
import { rethrowControlFlow, type StaffActionResult } from "../dialogs";
import { WINDOWS_COPY as C } from "./copy";
import { ScopePicker, scopeAllowed } from "./ScopePicker";

export interface WindowSiteOption {
  id: string;
  name: string;
}

export interface WindowTargetsView {
  pages: { id: string; title: string }[];
  /** Active add-ons on that site (slug + display name). */
  addons: { slug: string; name: string }[];
}

export interface WindowFormInput {
  scope: WindowScope;
  orgId?: string;
  pageId?: string;
  component?: string;
  addon?: string;
  startsAt: string;
  endsAt: string;
  message: string;
  /** An open incident code ("I-3"). */
  incident?: string;
}

export interface WindowFormProps {
  allowed: { platform: boolean; addon: boolean };
  sites: readonly WindowSiteOption[];
  /** Every add-on in the registry (Add-on scope). */
  addons: readonly { slug: string; name: string }[];
  /** Open incidents ("I-3" + title). */
  incidents: readonly { code: string; title: string }[];
  loadTargets: (orgId: string) => Promise<StaffActionResult<WindowTargetsView>>;
  onCreate: (
    input: WindowFormInput,
  ) => Promise<StaffActionResult<{ message: string; code: string }>>;
  onCreated?: (data: { message: string; code: string }) => void;
  onDiscard?: () => void;
  timeZone: string;
  /** Injectable clock (tests); defaults to the browser's now. */
  now?: () => Date;
}

type Errors = Partial<Record<"scope" | "target" | "range" | "message", string>>;

const NEEDS_SITE: ReadonlySet<WindowScope> = new Set([
  "organization",
  "page",
  "component",
]);

export function WindowForm({
  allowed,
  sites,
  addons,
  incidents,
  loadTargets,
  onCreate,
  onCreated,
  onDiscard,
  timeZone,
  now = () => new Date(),
}: WindowFormProps) {
  const base = useId();
  const [scope, setScope] = useState<WindowScope | null>("page");
  const [siteFilter, setSiteFilter] = useState("");
  const [orgId, setOrgId] = useState("");
  const [targets, setTargets] = useState<WindowTargetsView | null>(null);
  const [targetsState, setTargetsState] = useState<
    "idle" | "loading" | "failed"
  >("idle");
  const [pageId, setPageId] = useState("");
  const [component, setComponent] = useState("");
  const [addon, setAddon] = useState("");
  const [startsAt, setStartsAt] = useState(() =>
    toBusinessLocalInput(now(), timeZone),
  );
  const [endsAt, setEndsAt] = useState(() =>
    toBusinessLocalInput(new Date(now().getTime() + 3_600_000), timeZone),
  );
  const [message, setMessage] = useState("");
  const [incident, setIncident] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // A site change reloads its pages and active add-ons.
  useEffect(() => {
    if (!orgId) {
      setTargets(null);
      setTargetsState("idle");
      return;
    }
    let live = true;
    setTargetsState("loading");
    setPageId("");
    setComponent("");
    void loadTargets(orgId).then(
      (res) => {
        if (!live) return;
        if (res.ok) {
          setTargets(res.data);
          setTargetsState("idle");
        } else {
          setTargets(null);
          setTargetsState("failed");
        }
      },
      () => {
        if (live) setTargetsState("failed");
      },
    );
    return () => {
      live = false;
    };
  }, [orgId, loadTargets]);

  const shownSites = useMemo(() => {
    const q = siteFilter.trim().toLowerCase();
    const list = q
      ? sites.filter((s) => s.name.toLowerCase().includes(q) || s.id === q)
      : sites;
    // Keep the chosen site in the list even when the filter hides it.
    const chosen = sites.find((s) => s.id === orgId);
    return chosen && !list.includes(chosen) ? [chosen, ...list] : list;
  }, [siteFilter, sites, orgId]);

  const start = fromBusinessLocalInput(startsAt, timeZone);
  const end = fromBusinessLocalInput(endsAt, timeZone);

  function applyPreset(p: WindowPreset) {
    const r = applyWindowPreset(p, { start, end }, now(), timeZone);
    setStartsAt(toBusinessLocalInput(r.start, timeZone));
    setEndsAt(toBusinessLocalInput(r.end, timeZone));
    setErrors((e) => ({ ...e, range: undefined }));
  }

  const parts = [
    ...SITE_PARTS.map((p) => ({ value: p.key, label: p.label })),
    ...(targets?.addons ?? []).map((a) => ({ value: a.slug, label: a.name })),
  ];
  const messageLength = message.trim().length;

  // ------------------------------------------------------------------ preview
  const pageTitle = targets?.pages.find((p) => p.id === pageId)?.title;
  const componentLabel = parts.find((p) => p.value === component)?.label;
  const addonName = addons.find((a) => a.slug === addon)?.name;
  const preview: ServiceNotice | null = (() => {
    if (!scope || !start || !end) return null;
    const at = now();
    const rule = {
      scope,
      page: pageId,
      component,
      addon,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
    };
    const target = noticeTarget(rule, {
      ...(pageTitle ? { pageTitle } : {}),
      ...(componentLabel ? { componentLabel } : {}),
      ...(addonName ? { addonName } : {}),
    });
    const active = start.getTime() <= at.getTime();
    const text = active
      ? noticeActiveText(target, formatNoticeEnd(end, at, timeZone), message)
      : noticePlannedText(
          target,
          formatNoticeWhen(start, end, timeZone),
          message,
        );
    return {
      id: "preview",
      code: "W-preview",
      phase: active ? "active" : "upcoming",
      text,
      message,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      incident: null,
      dismissible: false,
    };
  })();
  const later =
    preview?.phase === "upcoming" &&
    start !== null &&
    start.getTime() - now().getTime() > WINDOW_UPCOMING_MS;
  const where =
    scope === "page" && pageTitle
      ? C.previewWhere.page(pageTitle)
      : scope === "component" && componentLabel
        ? C.previewWhere.component(componentLabel)
        : C.previewWhere.everywhere;

  // ------------------------------------------------------------------ submit
  function validate(): Errors {
    const e: Errors = {};
    if (!scope || !scopeAllowed(scope, allowed)) e.scope = P13_COPY.SUPER_ONLY;
    if (scope && NEEDS_SITE.has(scope) && !orgId) e.target = C.targetNeeded;
    if (scope === "page" && !pageId) e.target = C.targetNeeded;
    if (scope === "component" && !component) e.target = C.targetNeeded;
    if (scope === "addon" && !addon) e.target = C.targetNeeded;
    if (!windowRangeOk(start, end, now())) e.range = P13_COPY.WINDOW_RANGE;
    if (messageLength === 0) e.message = C.messageNeeded;
    else if (messageLength > WINDOW_MESSAGE_MAX) {
      e.message = C.messageTooLong(WINDOW_MESSAGE_MAX);
    }
    return e;
  }

  async function submit() {
    const e = validate();
    setErrors(e);
    setRefusal(null);
    if (Object.values(e).some(Boolean) || !scope || !start || !end) return;
    const input: WindowFormInput = {
      scope,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      message: message.trim(),
      ...(NEEDS_SITE.has(scope) ? { orgId } : {}),
      ...(scope === "page" ? { pageId } : {}),
      ...(scope === "component" ? { component } : {}),
      ...(scope === "addon" ? { addon } : {}),
      ...(incident ? { incident } : {}),
    };
    setPending(true);
    try {
      const res = await onCreate(input);
      if (res.ok) onCreated?.(res.data);
      else if (res.code !== "step_up_needed" && res.code !== "session_ended") {
        if (res.field === "range") setErrors({ range: res.message });
        else if (res.field === "message") setErrors({ message: res.message });
        else setRefusal(res.message);
      }
    } catch (err) {
      rethrowControlFlow(err);
      setRefusal(P13_COPY.ERR_SEND);
    } finally {
      setPending(false);
    }
  }

  const id = (s: string) => `${base}-${s}`;
  return (
    <form
      aria-label={C.formTitle}
      noValidate
      className="flex max-w-[720px] flex-col gap-8 font-hub text-hub-ink"
      onSubmit={(ev) => {
        ev.preventDefault();
        void submit();
      }}
    >
      <ScopePicker
        name={id("scope")}
        value={scope}
        allowed={allowed}
        onChange={(s) => {
          setScope(s);
          setErrors((e) => ({ ...e, scope: undefined, target: undefined }));
        }}
        errorId={errors.scope ? id("scope-error") : undefined}
      />
      {errors.scope ? (
        <p id={id("scope-error")} className="-mt-6 text-sm text-hub-danger">
          {errors.scope}
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold">{C.target}</legend>
        {scope && NEEDS_SITE.has(scope) ? (
          <>
            <TextField
              id={id("site-filter")}
              label={C.siteSearch}
              type="search"
              value={siteFilter}
              onChange={(ev) => setSiteFilter(ev.target.value)}
            />
            <Select
              id={id("site")}
              label={C.site}
              value={orgId}
              onChange={(ev) => setOrgId(ev.target.value)}
              options={[
                { value: "", label: C.sitePlaceholder },
                ...shownSites.map((s) => ({ value: s.id, label: s.name })),
              ]}
              error={errors.target && !orgId ? errors.target : undefined}
            />
            {targetsState === "loading" ? (
              <p className="text-sm text-hub-ink-muted" role="status">
                {C.loadingTargets}
              </p>
            ) : null}
            {targetsState === "failed" ? (
              <InlineAlert tone="error">{C.targetsFailed}</InlineAlert>
            ) : null}
            {scope === "page" && orgId && targets ? (
              targets.pages.length === 0 ? (
                <p className="text-sm text-hub-ink-muted">{C.noPages}</p>
              ) : (
                <Select
                  id={id("page")}
                  label={C.page}
                  value={pageId}
                  onChange={(ev) => setPageId(ev.target.value)}
                  options={[
                    { value: "", label: C.pagePlaceholder },
                    ...targets.pages.map((p) => ({
                      value: p.id,
                      label: p.title || p.id,
                    })),
                  ]}
                  error={errors.target && !pageId ? errors.target : undefined}
                />
              )
            ) : null}
            {scope === "component" && orgId && targets ? (
              <Select
                id={id("part")}
                label={C.part}
                value={component}
                onChange={(ev) => setComponent(ev.target.value)}
                options={[{ value: "", label: C.partPlaceholder }, ...parts]}
                error={errors.target && !component ? errors.target : undefined}
              />
            ) : null}
          </>
        ) : null}
        {scope === "addon" ? (
          <Select
            id={id("addon")}
            label={C.addon}
            value={addon}
            onChange={(ev) => setAddon(ev.target.value)}
            options={[
              { value: "", label: C.addonPlaceholder },
              ...addons.map((a) => ({ value: a.slug, label: a.name })),
            ]}
            error={errors.target && !addon ? errors.target : undefined}
          />
        ) : null}
        {scope === "platform" ? (
          <p className="text-sm text-hub-ink-muted">{C.everySite}</p>
        ) : null}
      </fieldset>

      <fieldset
        className="flex flex-col gap-4"
        aria-describedby={errors.range ? id("range-error") : id("tz")}
      >
        <legend className="mb-2 text-sm font-semibold">{C.when}</legend>
        <div
          role="group"
          aria-label={C.presets}
          className="flex flex-wrap gap-2"
        >
          {WINDOW_PRESETS.map((p) => (
            <Button
              key={p}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => applyPreset(p)}
            >
              {WINDOW_PRESET_LABELS[p]}
            </Button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id={id("starts")}
            label={C.starts}
            type="datetime-local"
            value={startsAt}
            onChange={(ev) => setStartsAt(ev.target.value)}
          />
          <TextField
            id={id("ends")}
            label={C.ends}
            type="datetime-local"
            value={endsAt}
            onChange={(ev) => setEndsAt(ev.target.value)}
          />
        </div>
        <p id={id("tz")} className="text-sm font-semibold text-hub-ink-muted">
          {C.timesNote}
        </p>
        {errors.range ? (
          <p id={id("range-error")} className="text-sm text-hub-danger">
            {errors.range}
          </p>
        ) : null}
      </fieldset>

      <TextArea
        id={id("message")}
        label={C.message}
        helper={C.messageHelp}
        rows={3}
        value={message}
        onChange={(ev) => {
          setMessage(ev.target.value);
          setErrors((e) => ({ ...e, message: undefined }));
        }}
        counter={{ value: messageLength, max: WINDOW_MESSAGE_MAX }}
        error={errors.message}
      />

      <Select
        id={id("incident")}
        label={C.incident}
        value={incident}
        onChange={(ev) => setIncident(ev.target.value)}
        options={[
          { value: "", label: C.incidentNone },
          ...incidents.map((i) => ({
            value: i.code,
            label: `${i.code} · ${i.title}`,
          })),
        ]}
      />

      <section aria-labelledby={id("preview")} className="flex flex-col gap-2">
        <h2 id={id("preview")} className="text-sm font-semibold">
          {C.preview}
        </h2>
        <p className="text-sm text-hub-ink-muted">{C.previewOn(where)}</p>
        <div
          data-window-preview
          className="max-w-[640px] overflow-hidden rounded border border-hub-border bg-hub-surface"
        >
          <div
            aria-hidden
            className="h-10 border-b border-hub-border bg-hub-surface-2"
          />
          {preview ? (
            <ServiceNoticeStrip notices={[preview]} timeZone={timeZone} />
          ) : null}
          <div aria-hidden className="h-16" />
        </div>
        {later ? (
          <p className="text-sm text-hub-ink-muted">{C.previewLater}</p>
        ) : null}
      </section>

      {refusal ? <InlineAlert tone="error">{refusal}</InlineAlert> : null}

      <div className="flex flex-col gap-4 border-t border-hub-border pt-4">
        <p className="text-sm text-hub-ink-muted">{C.footer}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            loading={pending}
            loadingLabel={C.creating}
          >
            {C.create}
          </Button>
          {onDiscard ? (
            <Button type="button" variant="ghost" onClick={onDiscard}>
              {C.discard}
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}

/** For panels: a window's state words (Active / Scheduled / Ended). */
export function windowStateOf(w: {
  phase: string;
  clearedAt: string;
}): "active" | "scheduled" | "ended" {
  if (w.clearedAt || w.phase === "ended") return "ended";
  return w.phase === "active" ? "active" : "scheduled";
}

/** Neutral state badge (D-UI-P13-11: ink on surface-2 for every state, never a colour). */
export function WindowStateBadge({
  state,
}: {
  state: "active" | "scheduled" | "ended";
}) {
  return (
    <span className="inline-flex items-center rounded bg-hub-surface-2 px-2 py-1 font-hub text-sm leading-none font-semibold whitespace-nowrap text-hub-ink">
      {C.states[state]}
    </span>
  );
}
