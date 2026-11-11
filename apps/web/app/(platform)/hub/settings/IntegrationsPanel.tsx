// Settings › Integrations (14-32 choice 4; CONT-16, D190, D312; 14-UI-SPEC "Integrations";
// D-UI-P14-1, D-UI-P14-25). Server component, read-only for Owner and Admin (`domain:read`).
// Before launch: NotLiveYet with INTEG-PRELAUNCH. Live: one heading Search engines and
// analytics, the CDS-sets-these-up line, and a read list of Google Analytics, Google Search
// Console, Bing Webmaster Tools and Instant updates (IndexNow). "Not connected" is ink-muted,
// never an error (T-14-32-03: no stand-in markers, no ids beyond the GA4 id).
import { NotLiveYet } from "@cds/ui/hub/shell";
import { Search } from "lucide-react";
import {
  INTEGRATIONS_COPY as C,
  type IntegrationsView,
} from "./integrations-view";

export function IntegrationsPanel({ view }: { view: IntegrationsView }) {
  if (!view.live) {
    return (
      <div data-integrations="prelaunch">
        <NotLiveYet what={view.prelaunch} />
      </div>
    );
  }
  return (
    <section
      aria-labelledby="integrations-h"
      data-integrations="live"
      className="flex max-w-[720px] flex-col gap-4 font-hub text-hub-ink"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="integrations-h"
          className="flex items-center gap-2 text-xl leading-tight font-semibold"
        >
          <Search aria-hidden size={20} strokeWidth={2} />
          {C.heading}
        </h2>
        <p className="text-sm text-hub-ink-muted">{C.intro}</p>
      </div>
      <dl className="flex flex-col divide-y divide-hub-border rounded border border-hub-border">
        {view.rows.map((r) => (
          <div
            key={r.key}
            data-integration={r.key}
            className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <dt className="text-sm font-semibold text-hub-ink-muted sm:w-56 sm:shrink-0">
              {r.label}
            </dt>
            <dd
              className={`min-w-0 text-base break-words tabular-nums ${
                r.muted ? "text-hub-ink-muted" : "text-hub-ink"
              }`}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
