"use client";
// AlertPrefsTable (11-24; DASH-36, D313, D285; 11-UI-SPEC "Profile" § 2 Alerts, lines 378-388).
// The "Alerts" section of Your profile and alerts: ALERTS-INTRO, SENSITIVE-ON when the site has
// sensitive-practice mode on, then one switch per alert and channel.
// - ≥ 640px a <table>: Alert · Bell · Email · Phone, a row group per level (Urgent, Normal,
//   Summary) with its one-line rule. Bell switches are on and disabled ("Bell alerts are always
//   on"); Summary rows have no Phone switch ("—", sr "Not available").
// - < 640px each alert is a block: name + example, then three switch rows.
// - Only the types passed in are listed: the server filters them by the person's access
//   (eligibleFor), so billing rows are the Owner's and Viewers see Summary types only.
// Every switch autosaves (useAutosave; toggles made while one save runs are queued in order)
// and the section's AutosaveStatus sits beside the heading. Reset to defaults (ghost sm, no
// confirm) clears the person's choices; Toast "Alerts reset to the defaults." with Undo puts
// the previous choices back.
import {
  channelsFor,
  type AlertChannelPrefs,
  type AlertLevel,
  type AlertTypeSpec,
} from "@cds/core/alerts";
import { useId, useState } from "react";
import type { HubActionResult } from "../addon-types";
import { AutosaveStatus } from "../AutosaveStatus";
import { Button } from "../Button";
import { InlineAlert } from "../feedback";
import { Switch } from "../Switch";
import { useToast } from "../Toast";
import { useAutosave } from "../useAutosave";
import { PROFILE_COPY as C, sensitiveOnCopy } from "./copy";

export type AlertPrefsMap = AlertChannelPrefs;

/** The switchable channels (the bell is always on). */
export type PrefChannel = "email" | "push";

type Toggle = { type: string; channel: PrefChannel; on: boolean };

export interface AlertPrefsTableProps {
  /** Alert types this person's access covers, registry order (server-filtered). */
  types: readonly AlertTypeSpec[];
  /** The person's saved choices (member_prefs.alertChannels). */
  initial: AlertPrefsMap;
  /** The business name when sensitive-practice mode is on (shows SENSITIVE-ON). */
  sensitiveBusiness?: string | null;
  /** Impersonating staff: every switch is read-only. */
  disabled?: boolean;
  onToggle(
    type: string,
    channel: PrefChannel,
    on: boolean,
  ): Promise<HubActionResult<unknown>>;
  /** Clears every choice; returns the map it replaced (for Undo). */
  onReset(): Promise<HubActionResult<{ previous: AlertPrefsMap }>>;
  /** Undo: puts a previous map back. */
  onRestore(previous: AlertPrefsMap): Promise<HubActionResult<unknown>>;
}

const LEVELS: readonly AlertLevel[] = ["urgent", "normal", "summary"];

const CELL = "px-3 py-3 align-middle";

function apply(map: AlertPrefsMap, t: Toggle): AlertPrefsMap {
  return { ...map, [t.type]: { ...map[t.type], [t.channel]: t.on } };
}

export function AlertPrefsTable({
  types,
  initial,
  sensitiveBusiness,
  disabled = false,
  onToggle,
  onReset,
  onRestore,
}: AlertPrefsTableProps) {
  const uid = useId();
  const toast = useToast();
  const [prefs, setPrefs] = useState<AlertPrefsMap>(initial);
  const [resetting, setResetting] = useState(false);
  const save = useAutosave<Toggle[]>(
    async (list) => {
      for (const t of list) {
        const res = await onToggle(t.type, t.channel, t.on);
        if (!res.ok) return res;
      }
      return { ok: true, data: null };
    },
    { merge: (a, b) => [...a, ...b] },
  );

  // Review 11 WR-D04: while a reset or an Undo runs the switches are locked, and Reset waits
  // for queued toggles, so no toggle lands on the server after the reset it preceded.
  const locked = disabled || resetting;

  function toggle(type: string, channel: PrefChannel, on: boolean) {
    if (locked) return;
    setPrefs((m) => apply(m, { type, channel, on }));
    save.run([{ type, channel, on }]);
  }

  async function reset() {
    if (locked || save.busy) return;
    setResetting(true);
    const res = await onReset();
    setResetting(false);
    if (!res.ok) {
      toast.show({ message: res.message });
      return;
    }
    const previous = res.data.previous;
    setPrefs({});
    toast.show({
      message: C.resetDone,
      action: {
        label: C.undo,
        onClick: () => {
          // The old choices show only once they are saved again; a failed Undo keeps the
          // defaults on screen, which is what the server still holds.
          setResetting(true);
          void onRestore(previous)
            .then((r) => {
              if (r.ok) setPrefs(previous);
              else toast.show({ message: r.message });
            })
            .finally(() => setResetting(false));
        },
      },
    });
  }

  const groups = LEVELS.map((level) => ({
    level,
    rows: types.filter((t) => t.level === level),
  })).filter((g) => g.rows.length > 0);

  const headingId = `${uid}-alerts`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 font-hub text-hub-ink"
      data-profile-alerts=""
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2
          id="alerts"
          className="scroll-mt-20 text-xl leading-tight font-semibold"
        >
          <span id={headingId}>{C.alerts}</span>
        </h2>
        <AutosaveStatus state={save.status} onRetry={save.retry} />
      </div>
      <p className="text-base">{C.alertsIntro}</p>
      {sensitiveBusiness ? (
        <InlineAlert tone="info">
          {sensitiveOnCopy(sensitiveBusiness)}
        </InlineAlert>
      ) : null}
      {groups.length === 0 ? (
        <p className="text-base text-hub-ink-muted">{C.noAlerts}</p>
      ) : (
        <>
          <table className="hidden w-full border-collapse text-left sm:table">
            <thead>
              <tr className="border-b border-hub-border text-sm text-hub-ink-muted">
                <th scope="col" className={`${CELL} font-semibold`}>
                  {C.colAlert}
                </th>
                <th scope="col" className={`${CELL} w-20 font-semibold`}>
                  {C.colBell}
                </th>
                <th scope="col" className={`${CELL} w-20 font-semibold`}>
                  {C.colEmail}
                </th>
                <th scope="col" className={`${CELL} w-20 font-semibold`}>
                  {C.colPhone}
                </th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.level} data-level={g.level}>
                <tr className="bg-hub-surface-2">
                  <th scope="rowgroup" colSpan={4} className={`${CELL} py-2`}>
                    <span className="text-sm font-semibold">
                      {C.levels[g.level].label}
                    </span>
                    <span className="ml-2 text-sm text-hub-ink-muted">
                      {C.levels[g.level].help}
                    </span>
                  </th>
                </tr>
                {g.rows.map((spec) => {
                  const ch = channelsFor(spec, prefs);
                  const id = `${uid}-t-${spec.type}`;
                  return (
                    <tr
                      key={spec.type}
                      className="border-b border-hub-border"
                      data-alert-type={spec.type}
                    >
                      <th scope="row" className={`${CELL} font-normal`}>
                        <span className="block text-base">{spec.label}</span>
                        <span className="block text-sm text-hub-ink-muted">
                          {spec.example}
                        </span>
                      </th>
                      <td className={CELL}>
                        <Switch
                          id={`${id}-bell`}
                          label={`${spec.label}: ${C.bellAlwaysOn}`}
                          labelHidden
                          checked
                          disabled
                          onChange={() => {}}
                        />
                      </td>
                      <td className={CELL}>
                        <Switch
                          id={`${id}-email`}
                          label={`${spec.label} by email`}
                          labelHidden
                          checked={ch.email}
                          disabled={locked}
                          onChange={(on) => toggle(spec.type, "email", on)}
                        />
                      </td>
                      <td className={CELL}>
                        {spec.level === "summary" ? (
                          <span className="text-sm text-hub-ink-muted">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">{C.notAvailable}</span>
                          </span>
                        ) : (
                          <Switch
                            id={`${id}-push`}
                            label={`${spec.label} by phone`}
                            labelHidden
                            checked={ch.push}
                            disabled={locked}
                            onChange={(on) => toggle(spec.type, "push", on)}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
          <div className="flex flex-col gap-6 sm:hidden" data-alert-blocks="">
            {groups.map((g) => (
              <div key={g.level} className="flex flex-col gap-4">
                <p className="text-sm">
                  <span className="font-semibold">
                    {C.levels[g.level].label}
                  </span>
                  <span className="ml-2 text-hub-ink-muted">
                    {C.levels[g.level].help}
                  </span>
                </p>
                <ul className="flex flex-col gap-4">
                  {g.rows.map((spec) => {
                    const ch = channelsFor(spec, prefs);
                    const id = `${uid}-b-${spec.type}`;
                    return (
                      <li
                        key={spec.type}
                        className="flex flex-col gap-2 border-b border-hub-border pb-4"
                      >
                        <span className="text-base">{spec.label}</span>
                        <span className="text-sm text-hub-ink-muted">
                          {spec.example}
                        </span>
                        <Switch
                          id={`${id}-bell`}
                          label={C.colBell}
                          aria-label={`${spec.label}: ${C.bellAlwaysOn}`}
                          checked
                          disabled
                          onChange={() => {}}
                        />
                        <Switch
                          id={`${id}-email`}
                          label={C.colEmail}
                          aria-label={`${spec.label} by email`}
                          checked={ch.email}
                          disabled={locked}
                          onChange={(on) => toggle(spec.type, "email", on)}
                        />
                        {spec.level === "summary" ? (
                          <p className="text-sm text-hub-ink-muted">
                            {C.colPhone}: {C.notAvailable.toLowerCase()}
                          </p>
                        ) : (
                          <Switch
                            id={`${id}-push`}
                            label={C.colPhone}
                            aria-label={`${spec.label} by phone`}
                            checked={ch.push}
                            disabled={locked}
                            onChange={(on) => toggle(spec.type, "push", on)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <div>
            <Button
              variant="ghost"
              size="sm"
              disabled={locked || save.busy}
              onClick={() => void reset()}
            >
              {C.reset}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
