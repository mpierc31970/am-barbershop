// MonitorPanel (13-46 choice 3; STAFF-16, STAFF-15, D174, D175; 13-UI-SPEC "Settings" Monitor;
// T-13-46-02). What the monitor app will read: the endpoint path, whether MONITOR_TOKEN is
// configured (a boolean only: the value never reaches this component), the current overall
// status and each status-document section as OK or Degraded (a section is null when its feeder
// failed), the brief path and "built later". Server-safe (no hooks).
import { Badge, type BadgeTone } from "../../hub/Badge";
import { SETTINGS_COPY } from "./copy";

const C = SETTINGS_COPY.monitor;

export type MonitorOverall = "ok" | "degraded" | "down";

export interface MonitorSectionView {
  name: string;
  ok: boolean;
}

export interface MonitorPanelView {
  endpoint: string;
  tokenConfigured: boolean;
  /** Null when the status document could not be built. */
  overall: MonitorOverall | null;
  sections: readonly MonitorSectionView[];
  briefPath: string;
  /** Where the brief can be read (the repository file view). */
  briefHref: string;
}

const OVERALL_TONE: Record<MonitorOverall, BadgeTone> = {
  ok: "h-ok",
  degraded: "h-warn",
  down: "h-critical",
};

export function MonitorPanel({ view }: { view: MonitorPanelView }) {
  return (
    <section className="flex flex-col gap-6">
      <p className="text-base text-hub-ink">{C.intro(view.endpoint)}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <dt className="text-hub-ink-muted">{C.endpoint}</dt>
        <dd>
          <code className="text-sm">{view.endpoint}</code>
        </dd>
        <dt className="text-hub-ink-muted">{C.token}</dt>
        <dd data-token-configured={view.tokenConfigured ? "yes" : "no"}>
          {view.tokenConfigured ? C.yes : C.no}
        </dd>
        <dt className="text-hub-ink-muted">{C.overall}</dt>
        <dd>
          {view.overall ? (
            <Badge tone={OVERALL_TONE[view.overall]}>
              {C.overallWords[view.overall]}
            </Badge>
          ) : (
            C.unavailable
          )}
        </dd>
      </dl>
      {view.sections.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-hub-ink">{C.sections}</h2>
          <ul
            aria-label={C.sectionsCaption}
            className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2 text-sm"
          >
            {view.sections.map((s) => (
              <li
                key={s.name}
                data-section={s.name}
                className="flex items-center justify-between gap-2 rounded border border-hub-border px-3 py-2"
              >
                <code className="text-sm">{s.name}</code>
                <Badge tone={s.ok ? "h-ok" : "h-warn"}>
                  {s.ok ? C.sectionOk : C.sectionDegraded}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-sm">
        <a
          href={view.briefHref}
          className="rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
          target="_blank"
          rel="noopener noreferrer"
        >
          {C.brief(view.briefPath)}
        </a>
      </p>
      <p className="text-sm text-hub-ink-muted">{C.later}</p>
    </section>
  );
}
