"use client";
// HandbackFlow (14-42 choice 3; LIFE-01, D282, DOM-05; 14-UI-SPEC "/hub/leaving checklist"
// step 1 a-e; T-14-42-03). The owner's half of the reverse gate (14-40), one domain at a time:
//   a · Download your DNS records: Download zone file + RecordGroupList (handback mode) grouped
//       Copy exactly · Points to CDS · CDS sending records (remove), email first.
//   b · Where should your DNS go?: Back to <registrar>'s DNS | Another DNS host (+ two
//       nameserver fields, font-mono).
//   c · Add your records there: RegistrarSteps (handback) + Check my new DNS → Found / Not found
//       per record; HANDBACK-AFTER when the destination can't answer before the switch. The
//       first check after a new choice saves the choice (chooseHandbackDestination runs the
//       check at once); later presses re-check.
//   d · Now change your nameservers to …: NameserverPair (destination) + RegistrarSteps
//       (nameservers) + I've changed them (shown when c passes or can't check first).
//   e · waiting (WAITING-BODY) · done (HANDBACK-DONE) · mismatch (HANDBACK-MISMATCH with CDS's
//       nameservers and the missing records).
// Read-only (Admins, staff viewing): every record and state shows, no buttons or fields.
// Rows are owner views (type, name, value, priority): no record sources (T-14-30-02).
import { P14_COPY, type RegistrarId } from "@cds/core/dns";
import { CircleCheck, Clock, Download } from "lucide-react";
import { useId, useState } from "react";
import type { HubActionResult } from "../addon-types";
import { Button } from "../Button";
import { InlineAlert } from "../feedback";
import { TextField } from "../fields";
import { RadioCardGroup } from "../RadioCardGroup";
import { NameserverPair } from "../domain/NameserverPair";
import {
  RecordGroupList,
  type DomainRecordRow,
  type RecordGroup,
} from "../domain/RecordGroupList";
import { RegistrarSteps } from "../domain/RegistrarSteps";
import { LEAVING_UI_COPY as C } from "./copy";

export type HandbackRecordView = {
  type: string;
  name: string;
  value: string;
  priority?: number;
};

export type HandbackStatusView =
  "open" | "checking" | "ready_to_switch" | "waiting" | "done" | "mismatch";

export type HandbackDestination = "registrar" | "other";

/** One domain's handback as the owner sees it (mapped from @cds/db HandbackZoneView). */
export type HandbackZoneUi = {
  domain: string;
  /** For RegistrarSteps ("other" when unknown). */
  registrarId: RegistrarId;
  /** Owner copy name ("GoDaddy", "your registrar"). */
  registrarName: string;
  groups: {
    copy_exactly: readonly HandbackRecordView[];
    points_to_cds: readonly HandbackRecordView[];
    remove: readonly HandbackRecordView[];
  };
  destination: HandbackDestination | null;
  destinationNameservers: readonly string[];
  cdsNameservers: readonly string[];
  results: readonly { record: HandbackRecordView; found: boolean }[];
  canCheckBefore: boolean;
  status: HandbackStatusView;
  /** HANDBACK-AFTER / -DONE / -MISMATCH from @cds/db, or null. */
  message: string | null;
};

export interface HandbackActions {
  downloadZoneFile(
    domain: string,
  ): Promise<HubActionResult<{ filename: string; text: string }>>;
  choose(
    domain: string,
    input: { kind: HandbackDestination; nameservers?: [string, string] },
  ): Promise<HubActionResult<HandbackZoneUi>>;
  check(domain: string): Promise<HubActionResult<HandbackZoneUi>>;
  confirm(domain: string): Promise<HubActionResult<HandbackZoneUi>>;
}

export interface HandbackFlowProps {
  zone: HandbackZoneUi;
  readOnly?: boolean;
  actions?: HandbackActions;
  /** Save a downloaded file (the app uses a Blob link; tests capture it). */
  saveFile?(filename: string, text: string): void;
  /**
   * WR-E02: after a choose, check or confirm changes the handback. The page refreshes so the
   * checklist below (steps 2 to 6 locked on DNS) and the banner follow the new state.
   */
  onChanged?(zone: HandbackZoneUi): void;
}

/** WR-E09: compare nameservers as DNS does: no case, no spaces, no trailing dot. */
export function normalizeNameserver(s: string): string {
  return s.trim().toLowerCase().replace(/\.$/, "");
}

function rowKey(r: HandbackRecordView, i: number): string {
  return `${i}:${r.type}:${r.name}:${r.priority ?? ""}:${r.value.slice(0, 40)}`;
}

function rows(
  list: readonly HandbackRecordView[],
  status?: (i: number) => DomainRecordRow["status"],
): DomainRecordRow[] {
  return list.map((r, i) => ({
    key: rowKey(r, i),
    type: r.type,
    name: r.name,
    value: r.value,
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
    ...(status ? { status: status(i) } : {}),
  }));
}

/** Browser download of a text file (no-op where Blob URLs are missing). */
export function saveTextFile(filename: string, text: string): void {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function")
    return;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const H3 = "text-base font-semibold";

export function HandbackFlow({
  zone: initial,
  readOnly = false,
  actions,
  saveFile = saveTextFile,
  onChanged,
}: HandbackFlowProps) {
  const id = useId();
  const [zone, setZone] = useState(initial);
  const [kind, setKind] = useState<HandbackDestination | null>(
    initial.destination ?? null,
  );
  const [ns1, setNs1] = useState(
    initial.destination === "other"
      ? (initial.destinationNameservers[0] ?? "")
      : "",
  );
  const [ns2, setNs2] = useState(
    initial.destination === "other"
      ? (initial.destinationNameservers[1] ?? "")
      : "",
  );
  const [pending, setPending] = useState<
    null | "download" | "check" | "confirm"
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [nsErrors, setNsErrors] = useState<[string | null, string | null]>([
    null,
    null,
  ]);
  const canAct = !readOnly && Boolean(actions);
  const domain = zone.domain;

  async function run(
    which: "download" | "check" | "confirm",
    fn: () => Promise<void>,
  ): Promise<void> {
    if (pending) return;
    setPending(which);
    setError(null);
    try {
      await fn();
    } catch {
      setError(C.tryAgain);
    } finally {
      setPending(null);
    }
  }

  const onDownload = () =>
    run("download", async () => {
      const res = await actions!.downloadZoneFile(domain);
      if (!res.ok) {
        setError(res.message || C.downloadFailed);
        return;
      }
      saveFile(res.data.filename, res.data.text);
    });

  const onCheck = () =>
    run("check", async () => {
      if (!kind) {
        setError("Choose where your DNS goes first.");
        return;
      }
      const nameservers: [string, string] = [ns1.trim(), ns2.trim()];
      if (kind === "other") {
        const [a, b] = nameservers.map(normalizeNameserver);
        const errs: [string | null, string | null] = [
          a ? null : C.nsEmpty,
          !b ? C.nsEmpty : a === b ? C.nsSame : null,
        ];
        setNsErrors(errs);
        if (errs[0] || errs[1]) return;
      } else {
        setNsErrors([null, null]);
      }
      const same = (i: 0 | 1) =>
        normalizeNameserver(nameservers[i]) ===
        normalizeNameserver(zone.destinationNameservers[i] ?? "");
      const changed =
        kind !== zone.destination ||
        (kind === "other" && (!same(0) || !same(1)));
      const res = changed
        ? await actions!.choose(
            domain,
            kind === "other" ? { kind, nameservers } : { kind },
          )
        : await actions!.check(domain);
      if (!res.ok) {
        setError(res.code === "rate_limited" ? C.rateLimited : res.message);
        return;
      }
      setZone(res.data);
      onChanged?.(res.data);
    });

  const onConfirm = () =>
    run("confirm", async () => {
      const res = await actions!.confirm(domain);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setZone(res.data);
      onChanged?.(res.data);
    });

  const errorBox = error ? (
    <InlineAlert tone="error">{error}</InlineAlert>
  ) : null;

  // e · done
  if (zone.status === "done") {
    return (
      <div
        data-handback={domain}
        data-handback-status="done"
        className="flex items-start gap-2 text-base"
      >
        <CircleCheck
          aria-hidden
          size={20}
          strokeWidth={2}
          className="mt-0.5 shrink-0 text-hub-success"
        />
        <p>
          <span className="sr-only">{C.doneTitle}: </span>
          {P14_COPY.HANDBACK_DONE}
        </p>
      </div>
    );
  }

  const handbackGroups: RecordGroup[] = [
    { key: "copy_exactly", records: rows(zone.groups.copy_exactly) },
    { key: "points_to_cds", records: rows(zone.groups.points_to_cds) },
    { key: "cds_sending", records: rows(zone.groups.remove) },
  ];
  const resultGroups: RecordGroup[] = [
    {
      key: "copy_exactly",
      records: rows(
        zone.results.map((r) => r.record),
        (i) => (zone.results[i]?.found ? "found" : "not_found"),
      ),
    },
  ];
  const missing = zone.results.filter((r) => !r.found).map((r) => r.record);
  const whose =
    zone.destination === "registrar"
      ? C.whoseRegistrar(zone.registrarName)
      : C.whoseOther;
  const showSwitch = zone.status === "ready_to_switch";
  const after =
    zone.status === "ready_to_switch" && !zone.canCheckBefore
      ? zone.message
      : null;

  // e · waiting
  if (zone.status === "waiting") {
    return (
      <div
        data-handback={domain}
        data-handback-status="waiting"
        className="flex flex-col gap-4"
      >
        <div className="flex items-start gap-2 text-base" role="status">
          <Clock
            aria-hidden
            size={20}
            strokeWidth={2}
            className="mt-0.5 shrink-0 text-hub-ink-muted"
          />
          <p>
            <span className="font-semibold">{C.waitingTitle}. </span>
            {P14_COPY.WAITING_BODY}
          </p>
        </div>
        {canAct ? (
          <div>
            <Button
              size="sm"
              loading={pending === "check"}
              loadingLabel={P14_COPY.BTN_CHECKING}
              onClick={() => void onCheck()}
            >
              {P14_COPY.BTN_CHECK_NEW_DNS}
            </Button>
          </div>
        ) : null}
        {errorBox}
      </div>
    );
  }

  return (
    <div
      data-handback={domain}
      data-handback-status={zone.status}
      className="flex flex-col gap-8"
    >
      {zone.status === "mismatch" ? (
        <div className="flex flex-col gap-4" data-handback-mismatch="">
          <InlineAlert tone="error">
            {zone.message ?? P14_COPY.HANDBACK_MISMATCH({ count: 1 })}
          </InlineAlert>
          <NameserverPair label={C.cdsNs} values={zone.cdsNameservers} />
          {missing.length > 0 ? (
            <RecordGroupList
              mode="handback"
              domain={domain}
              readOnly
              groups={[
                {
                  key: "copy_exactly",
                  records: rows(missing, () => "not_found"),
                },
              ]}
            />
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby={`${id}-a`} className="flex flex-col gap-4">
        <h3 id={`${id}-a`} className={H3}>
          {C.stepA}
        </h3>
        {canAct ? (
          <div>
            <Button
              size="sm"
              icon={<Download aria-hidden size={16} strokeWidth={2} />}
              loading={pending === "download"}
              onClick={() => void onDownload()}
            >
              {P14_COPY.BTN_DOWNLOAD_ZONE_FILE}
            </Button>
          </div>
        ) : null}
        <p className="text-sm text-hub-ink-muted">{C.emailFirst}</p>
        <RecordGroupList
          mode="handback"
          domain={domain}
          readOnly
          groups={handbackGroups}
        />
      </section>

      <section aria-labelledby={`${id}-b`} className="flex flex-col gap-4">
        <h3 id={`${id}-b`} className={H3}>
          {C.stepB}
        </h3>
        {canAct ? (
          <RadioCardGroup<HandbackDestination>
            name={`${id}-dest`}
            legend={C.stepB}
            hideLegend
            value={kind}
            onChange={setKind}
            options={[
              {
                value: "registrar",
                title: C.backToRegistrar(zone.registrarName),
                description: C.backToRegistrarBody(zone.registrarName),
              },
              {
                value: "other",
                title: C.anotherHost,
                description: C.anotherHostBody,
                body:
                  kind === "other" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField
                        id={`${id}-ns1`}
                        label={C.newNs(1)}
                        value={ns1}
                        error={nsErrors[0] ?? undefined}
                        className="font-mono"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => setNs1(e.currentTarget.value)}
                      />
                      <TextField
                        id={`${id}-ns2`}
                        label={C.newNs(2)}
                        value={ns2}
                        error={nsErrors[1] ?? undefined}
                        className="font-mono"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => setNs2(e.currentTarget.value)}
                      />
                    </div>
                  ) : undefined,
              },
            ]}
          />
        ) : (
          <p className="text-base">
            {zone.destination === "registrar"
              ? C.backToRegistrar(zone.registrarName)
              : zone.destination === "other"
                ? C.anotherHost
                : "Not chosen yet."}
          </p>
        )}
      </section>

      <section aria-labelledby={`${id}-c`} className="flex flex-col gap-4">
        <h3 id={`${id}-c`} className={H3}>
          {C.stepC}
        </h3>
        {(canAct ? kind : zone.destination) === "other" ? (
          <p className="text-base">{C.otherHostSteps}</p>
        ) : (
          <RegistrarSteps kind="handback" registrar={zone.registrarId} />
        )}
        {canAct ? (
          <div>
            <Button
              loading={pending === "check"}
              loadingLabel={P14_COPY.BTN_CHECKING}
              onClick={() => void onCheck()}
            >
              {P14_COPY.BTN_CHECK_NEW_DNS}
            </Button>
          </div>
        ) : null}
        {after ? (
          <p className="text-sm text-hub-ink-muted" data-handback-after="">
            {after}
          </p>
        ) : null}
        {zone.results.length > 0 && zone.status !== "mismatch" ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <p className="text-sm font-semibold">{C.checkResults}</p>
            <RecordGroupList
              mode="handback"
              domain={domain}
              readOnly
              groups={resultGroups}
            />
          </div>
        ) : null}
        {errorBox}
      </section>

      {showSwitch ? (
        <section
          aria-labelledby={`${id}-d`}
          className="flex flex-col gap-4"
          data-handback-switch=""
        >
          <h3 id={`${id}-d`} className={H3}>
            {C.stepD(whose)}
          </h3>
          <NameserverPair
            label={C.destinationNs}
            values={zone.destinationNameservers}
          />
          <RegistrarSteps kind="nameservers" registrar={zone.registrarId} />
          {canAct ? (
            <div>
              <Button
                variant="primary"
                loading={pending === "confirm"}
                loadingLabel={P14_COPY.BTN_CHECKING}
                onClick={() => void onConfirm()}
              >
                {P14_COPY.BTN_IVE_CHANGED}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
