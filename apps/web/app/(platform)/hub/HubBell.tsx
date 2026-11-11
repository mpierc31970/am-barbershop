"use client";
// The hub's bell wired to the app (11-21; DASH-34, DASH-37; 11-UI-SPEC "Bell"; D-UI-P11-12).
// AlertBell + AlertsPanel from @cds/ui/hub/alerts, fed by /hub/api/alerts (session-checked,
// no-store). The count starts from the layout's server read, re-reads on every navigation and
// every 60s while the page is visible. Opening the drawer loads the rows (4 skeleton rows,
// ERR-LOAD + Try again). Opening a row marks it read, closes the drawer and navigates through
// the hub nav guard (a dirty builder asks first). Rendered inside HubShell's top bar.
import { isHubHref, DEFAULT_TIME_ZONE } from "@cds/core/today";
import {
  AlertBell,
  AlertsPanel,
  useBellRefresh,
  type AlertsPanelState,
  type BellRow,
} from "@cds/ui/hub/alerts";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  markAlertReadAction,
  markAllAlertsReadAction,
} from "../../actions/alerts";
import { syncAppBadge } from "./app-badge";
import { useNavGuard } from "./nav-guard";

export const BELL_ROWS_URL = "/hub/api/alerts";

export interface HubBellProps {
  initialCount: number;
  initialUrgent: number;
}

const LEVELS = new Set(["urgent", "normal", "summary"]);

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The API's rows, re-checked: hub links only, known levels. */
export function bellRowsOf(v: unknown): BellRow[] {
  if (!Array.isArray(v)) return [];
  const out: BellRow[] = [];
  for (const r of v) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    const id = str(o.id);
    const href = str(o.href);
    if (!id || !isHubHref(href)) continue;
    const level = str(o.level);
    out.push({
      id,
      type: str(o.type),
      level: LEVELS.has(level) ? (level as BellRow["level"]) : "normal",
      title: str(o.title),
      href,
      section: str(o.section),
      createdAt: str(o.createdAt),
      read: o.read === true,
      cleared: o.cleared === true,
    });
  }
  return out;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.trunc(v)
    : 0;
}

export function HubBell({ initialCount, initialUrgent }: HubBellProps) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const navGuard = useNavGuard();
  const bell = useBellRefresh({
    initial: { count: initialCount, urgent: initialUrgent },
    refreshKey: pathname,
  });
  const { set: setCounts } = bell;
  // Keep the home-screen app's badge in step with the bell.
  useEffect(() => syncAppBadge(bell.count), [bell.count]);
  const [open, setOpen] = useState(false);
  // The drawer mounts on first open (no closed dialog in every page's HTML), then stays.
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState<AlertsPanelState>("loading");
  const [rows, setRows] = useState<BellRow[]>([]);
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [hasMore, setHasMore] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(
    async (more = false): Promise<void> => {
      if (!more) setState("loading");
      try {
        const res = await fetch(
          more ? `${BELL_ROWS_URL}?more=1` : BELL_ROWS_URL,
          {
            cache: "no-store",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          },
        );
        if (!res.ok) throw new Error(`bell ${res.status}`);
        const body = (await res.json()) as Record<string, unknown>;
        setRows(bellRowsOf(body.rows));
        setTimeZone(str(body.timeZone) || DEFAULT_TIME_ZONE);
        setHasMore(body.hasMore === true);
        setCounts({ count: num(body.count), urgent: num(body.urgent) });
        setNow(Date.now());
        setState("ready");
      } catch {
        setState("error");
      }
    },
    [setCounts],
  );

  const openRow = async (row: BellRow): Promise<void> => {
    if (!row.read && !row.cleared) {
      // Mark read first, so the next page's count already leaves it out.
      const result = await markAlertReadAction(row.id).catch(() => null);
      if (result?.ok) {
        setRows((all) =>
          all.map((r) => (r.id === row.id ? { ...r, read: true } : r)),
        );
        setCounts({
          count: Math.max(0, bell.count - 1),
          urgent:
            row.level === "urgent" ? Math.max(0, bell.urgent - 1) : bell.urgent,
        });
        // Review 11 IN-E04: the decrement above uses the render-time count; a 60 s refresh
        // landing mid-action could make it stale. Re-read the true count right away.
        void bell.refresh();
      }
    }
    setOpen(false);
    if (!isHubHref(row.href)) return;
    const go = () => router.push(row.href);
    if (!navGuard.intercept(go)) go();
  };

  const markAll = async (): Promise<void> => {
    setMarkingAll(true);
    try {
      const result = await markAllAlertsReadAction();
      if (result.ok) {
        setRows((all) => all.map((r) => ({ ...r, read: true })));
        setCounts({ count: 0, urgent: 0 });
      }
    } catch {
      // The rows stay as they were; the next refresh shows the truth.
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <>
      <AlertBell
        count={bell.count}
        urgent={bell.urgent}
        announcement={bell.announcement}
        expanded={open}
        onOpen={() => {
          setOpened(true);
          setOpen(true);
          void load();
        }}
      />
      {opened ? (
        <AlertsPanel
          open={open}
          onClose={() => setOpen(false)}
          state={state}
          rows={rows}
          timeZone={timeZone}
          now={now}
          onOpenRow={(row) => void openRow(row)}
          onMarkAll={() => void markAll()}
          onRetry={() => void load()}
          {...(hasMore ? { onShowMore: () => void load(true) } : {})}
          markingAll={markingAll}
        />
      ) : null}
    </>
  );
}
