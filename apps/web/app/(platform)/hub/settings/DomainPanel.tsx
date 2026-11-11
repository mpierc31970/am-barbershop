// Settings › Domain panel (14-31 choice 3; DOM-02, DOM-03, DOM-04, DOM-05; 14-UI-SPEC "Settings ›
// Domain" S-closed..S8, "Interaction states", "Destructive", "Responsive"; D54, D56, D58, D119,
// D288, D-UI-P14-2, D-UI-P14-6, D-UI-P14-9, D-UI-P14-28). Server component. Every state renders
// in one order: the DomainStatusLine, the Admin read line, the expiry overlay, then the ONE
// active section (one <h2> with Globe 20), then the collapsed history (<details>). Past steps
// never stay expanded. Owner actions are the client islands in DomainControls (POST server
// actions); an Admin (`canAct` false) sees no button at all. S1 / S4 refresh through the
// DomainStatusPoller, mounted first so it survives a refresh. S6 sends a domain move to CDS
// Support (DOM-MOVE-HELP), never self-service. Owners never see record sources or failure words.
// The "?" help links render only when the how-to exists in the help map (P13-P12 pattern).
import { JARGON, P14_COPY } from "@cds/core/dns";
import type { TrackerStep, TrackerStepId } from "@cds/core/today";
import {
  ownerDomainView,
  type OwnerDnsRecordsView,
  type OwnerDomainView,
} from "@cds/db";
import { EmptyState, InlineAlert, Skeleton, buttonClasses } from "@cds/ui/hub";
import {
  DomainStatusLine,
  GateFinding,
  NameserverPair,
  RecordGroupList,
  RegistrarHint,
  RegistrarSteps,
  type DomainRecordRow,
  type RecordGroup,
} from "@cds/ui/hub/domain";
import { BuildTracker } from "@cds/ui/hub/today";
import { Globe, ShieldCheck, Undo2 } from "lucide-react";
import Link from "next/link";
import { cache, type JSX, type ReactNode } from "react";
import { helpHref } from "../../../../lib/help-index";
import type { HubSession } from "../../../../lib/session";
import { settingsTabHelpId } from "../sections";
import {
  AckCheckbox,
  ChangeMainIsland,
  CheckButton,
  ConnectIsland,
  DifferentDomainIsland,
  FocusOnce,
  PrimaryChoiceIsland,
  SendStepsIsland,
  ZoneFileIsland,
} from "./DomainControls";
import { DnsRecordsView } from "./DnsRecordsView";
import { CheckNowButton, DomainStatusPoller } from "./DomainStatusPoller";
import { EmailSetupView } from "./EmailSetupView";
import {
  domainMark,
  formatDomainDate,
  type DomainViewModel,
  type SentenceRun,
} from "./domain-view";

type Ctx = HubSession["ctx"];

/** One ownerDomainView read per request (the tab count and the panel share it). */
export const readDomainView = cache((ctx: Ctx): Promise<OwnerDomainView> =>
  ownerDomainView(ctx),
);

export const DOMAIN_PANEL_COPY = Object.freeze({
  readingH: "Reading your records",
  beforeYouSwitch: "Before you switch",
  whatWellCopy: "What we'll copy",
  zoneSummary: "Add your zone file (most complete)",
  zoneOptional: "Optional. It makes sure nothing is missed.",
  changeNsH: "Change your nameservers",
  waitingH: "Waiting for your nameservers",
  lastChecked: (ago: string) => `Last checked ${ago}`,
  connectedH: "Your domain",
  registeredAt: "Registered at",
  renews: (date: string) => ` · renews ${date}`,
  dns: "DNS",
  dnsConnected: "With us. Your email records were copied exactly.",
  dnsLive: "With us",
  secure: "Secure connection",
  secureLater: "Set up on launch day",
  secureOn: "On · renews automatically",
  launchStepsH: "Launch steps",
  liveH: "Your live site",
  mainAddress: "Main address",
  alsoWorks: "Also works",
  alsoWorksText: (other: string) =>
    `${other} sends visitors to your main address`,
  previewAddress: "Preview address",
  previewText: (host: string) =>
    `${host} sends visitors here. Your preview links still show unpublished changes.`,
  switchBackH: "Switch your nameservers back",
  oldNameservers: "Your old nameservers",
  stepsBack: (registrar: string) => `Steps to switch back at ${registrar}`,
  lostH: "Your domain needs attention",
  howConnecting: "How connecting works",
  howToRenew: "How to renew",
  howToKeepForwarding: "How to keep forwarding",
  ackEmail: "I understand my email forwarding stops",
  ackWeb: "I understand my web forwarding stops",
  show: "Show",
  hardBlock: "This step can't be skipped.",
  justNow: "just now",
  minutesAgo: (n: number) => `${n} ${n === 1 ? "minute" : "minutes"} ago`,
  hoursAgo: (n: number) => `${n} ${n === 1 ? "hour" : "hours"} ago`,
});

const C = DOMAIN_PANEL_COPY;
const SUPPORT_QUESTION_HREF = "/hub/support/tickets/new?type=question";
const SUPPORT_CHANGE_HREF = "/hub/support/tickets/new?type=change";
const LINK =
  "rounded text-hub-accent underline underline-offset-2 pointer-coarse:inline-flex " +
  "pointer-coarse:min-h-11 pointer-coarse:items-center";

/** The Connect your domain how-to, once the help map knows it (14-46); else null. */
export function domainHowToHref(): string | null {
  const id = settingsTabHelpId("domain");
  return id === "settings" ? null : helpHref(id);
}

/** "2 minutes ago" from an ISO time; "" when unknown. */
export function agoText(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.floor(Math.max(0, now.getTime() - t) / 60_000);
  if (min < 1) return C.justNow;
  if (min < 60) return C.minutesAgo(min);
  return C.hoursAgo(Math.floor(min / 60));
}

function Sentence({ runs }: { runs: readonly SentenceRun[] }) {
  return (
    <>
      {runs.map((r, i) =>
        r.strong ? (
          <strong key={i} className="font-semibold">
            {r.text}
          </strong>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

function SectionHeading({
  id,
  title,
  explainer,
}: {
  id: string;
  title: string;
  explainer?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2
        id={id}
        className="flex items-center gap-2 text-xl leading-tight font-semibold text-hub-ink"
      >
        <Globe aria-hidden size={20} strokeWidth={2} />
        {title}
      </h2>
      {explainer ? (
        <p className="max-w-[68ch] text-sm text-hub-ink-muted">{explainer}</p>
      ) : null}
    </div>
  );
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      data-domain-section={id}
      className="flex flex-col gap-6"
    >
      {children}
    </section>
  );
}

/** Buttons row: one column under 640px (primary first), a row from 640px. */
function Actions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      {children}
    </div>
  );
}

function ReadList({ rows }: { rows: { term: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-col divide-y divide-hub-border rounded border border-hub-border">
      {rows.map((r) => (
        <div
          key={r.term}
          className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4"
        >
          <dt className="text-sm font-semibold text-hub-ink-muted sm:w-40 sm:shrink-0">
            {r.term}
          </dt>
          <dd className="min-w-0 text-base break-words text-hub-ink">
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function recordGroups(view: OwnerDomainView): RecordGroup[] {
  const by = new Map<string, DomainRecordRow[]>();
  view.records.forEach((r, i) => {
    const list = by.get(r.group) ?? [];
    list.push({
      key: `${r.group}-${i}`,
      type: r.type,
      name: r.name,
      value: r.value,
      ...(r.priority !== undefined ? { priority: r.priority } : {}),
      status: r.status,
    });
    by.set(r.group, list);
  });
  return [...by.entries()].map(([key, records]) => ({
    key: key as RecordGroup["key"],
    records,
  }));
}

function registeredLine(view: OwnerDomainView, registrar: string): string {
  const date = formatDomainDate(view.expiresAt, true);
  return date ? `${registrar}${C.renews(date)}` : registrar;
}

function summarySentence(view: OwnerDomainView): string {
  const count = view.records.length;
  if (view.email.count > 0 && view.email.provider) {
    return P14_COPY.EMAIL_FOUND({ provider: view.email.provider, count });
  }
  if (view.email.count > 0) return P14_COPY.EMAIL_FOUND_UNKNOWN({ count });
  return P14_COPY.EMAIL_NONE({ count });
}

function HowToLink({
  href,
  label,
  hash,
}: {
  href: string | null;
  label: string;
  hash?: string;
}) {
  if (!href) return null;
  return (
    <Link href={hash ? `${href}#${hash}` : href} className={LINK}>
      {label}
    </Link>
  );
}

// ---------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------

function ClosedSection({ howTo }: { howTo: string | null }) {
  return (
    <EmptyState
      icon={Globe}
      heading={P14_COPY.EMPTY_H}
      body={P14_COPY.DOM_CLOSED}
      action={
        howTo ? <HowToLink href={howTo} label={C.howConnecting} /> : undefined
      }
    />
  );
}

function ConnectSection({
  view,
  model,
  howTo,
}: {
  view: OwnerDomainView;
  model: DomainViewModel;
  howTo: string | null;
}) {
  if (model.readOnly) {
    return (
      <Section id="domain-connect">
        <SectionHeading
          id="domain-connect"
          title={P14_COPY.EMPTY_H}
          explainer={JARGON.domain}
        />
        <p className="max-w-[68ch] text-base">{P14_COPY.DOM_WHY_NOW}</p>
        <p className="text-sm text-hub-ink-muted">{P14_COPY.DOM_OWN}</p>
      </Section>
    );
  }
  return (
    <div data-domain-section="domain-connect" className="flex flex-col gap-4">
      <ConnectIsland
        previewHost={view.previewHost ?? ""}
        getDomainHref={howTo ? `${howTo}#get-a-domain` : undefined}
        askSupportHref={SUPPORT_QUESTION_HREF}
      />
    </div>
  );
}

function CheckingSection({
  view,
  model,
}: {
  view: OwnerDomainView;
  model: DomainViewModel;
}) {
  const domain = view.domain ?? "";
  return (
    <Section id="domain-checking">
      {view.registrar ? (
        <RegistrarHint
          registrar={model.registrar}
          renews={formatDomainDate(view.expiresAt, true) || null}
        />
      ) : null}
      <SectionHeading id="domain-checking" title={C.readingH} />
      <p className="max-w-[68ch] text-base">
        {P14_COPY.CHECKING_BODY({ domain })}
      </p>
      <Skeleton rows={4} />
      {model.secondary.includes("different_domain") ? (
        <Actions>
          <DifferentDomainIsland domain={domain} registrar={model.registrar} />
        </Actions>
      ) : null}
    </Section>
  );
}

function FindingFix({
  finding,
  model,
  howTo,
}: {
  finding: OwnerDomainView["findings"][number];
  model: DomainViewModel;
  howTo: string | null;
}) {
  const canAct = !model.readOnly;
  switch (finding.kind) {
    case "dnssec":
      return (
        <div className="flex flex-col gap-4">
          <RegistrarSteps kind="dnssec" registrar={model.registrarId} />
          {canAct ? (
            <Actions>
              <CheckButton label={P14_COPY.BTN_CHECK_AGAIN} from="findings" />
            </Actions>
          ) : null}
        </div>
      );
    case "spf":
      return canAct ? (
        <Actions>
          <CheckButton label={P14_COPY.BTN_CHECK_AGAIN} from="findings" />
          <Link
            href={SUPPORT_QUESTION_HREF}
            className={buttonClasses("ghost", "md")}
          >
            {P14_COPY.BTN_ASK_SUPPORT}
          </Link>
        </Actions>
      ) : null;
    case "email_forwarding":
    case "web_forwarding":
    case "parking":
      return canAct && finding.ackKey ? (
        <div className="flex flex-col gap-1">
          <AckCheckbox
            ackKey={finding.ackKey}
            label={finding.kind === "email_forwarding" ? C.ackEmail : C.ackWeb}
          />
          {finding.kind === "email_forwarding" ? (
            <HowToLink
              href={howTo}
              hash="keep-forwarding"
              label={C.howToKeepForwarding}
            />
          ) : null}
        </div>
      ) : null;
    default:
      return null;
  }
}

function FindingsSection({
  view,
  model,
  howTo,
}: {
  view: OwnerDomainView;
  model: DomainViewModel;
  howTo: string | null;
}) {
  const domain = view.domain ?? "";
  const g2 = view.findings.some((f) => f.kind === "mail_incomplete");
  return (
    <Section id="domain-findings">
      <SectionHeading id="domain-findings" title={C.whatWellCopy} />
      <RegistrarHint
        registrar={view.registrar ? model.registrar : null}
        renews={formatDomainDate(view.expiresAt, true) || null}
      />
      <div className="flex flex-col gap-1">
        <p className="max-w-[68ch] text-base">{summarySentence(view)}</p>
        <p className="max-w-[68ch] text-sm text-hub-ink-muted">
          {P14_COPY.COPY_SAFE({ registrar: model.registrar })}
        </p>
      </div>
      {view.findings.length > 0 ? (
        <div className="flex flex-col gap-4" data-domain-findings="">
          <h3 className="text-lg leading-tight font-semibold">
            {C.beforeYouSwitch}
          </h3>
          {view.findings.map((f, i) => (
            <GateFinding
              key={`${f.kind}-${i}`}
              finding={{
                kind: f.kind,
                ...(f.count !== undefined ? { count: f.count } : {}),
                ...(f.provider ? { provider: f.provider } : {}),
                hardBlock: f.hardBlock,
              }}
              registrar={f.registrar || model.registrar}
            >
              <FindingFix finding={f} model={model} howTo={howTo} />
            </GateFinding>
          ))}
        </div>
      ) : null}
      <RecordGroupList
        mode="check"
        groups={recordGroups(view)}
        domain={domain}
      />
      {!model.readOnly ? (
        <details
          open={g2}
          className="flex flex-col gap-4 rounded border border-hub-border p-4"
        >
          <summary className="cursor-pointer text-base font-semibold pointer-coarse:min-h-11">
            {C.zoneSummary}
            <span className="block text-sm font-normal text-hub-ink-muted">
              {C.zoneOptional}
            </span>
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            <RegistrarSteps kind="zone_export" registrar={model.registrarId} />
            <ZoneFileIsland />
          </div>
        </details>
      ) : null}
      {model.secondary.includes("different_domain") ? (
        <Actions>
          <DifferentDomainIsland domain={domain} registrar={model.registrar} />
        </Actions>
      ) : null}
    </Section>
  );
}

function NameserverSteps({
  view,
  model,
}: {
  view: OwnerDomainView;
  model: DomainViewModel;
}) {
  return (
    <div className="flex flex-col gap-4">
      <NameserverPair values={view.nameservers} />
      <p className="max-w-[68ch] text-base">
        <Sentence
          runs={boldRegistrar(
            P14_COPY.NS_REPLACE({ registrar: model.registrar }),
            view.registrar ? model.registrar : null,
          )}
        />
      </p>
      <RegistrarSteps kind="nameservers" registrar={model.registrarId} />
      <p className="max-w-[68ch] text-sm text-hub-ink-muted">
        {P14_COPY.NS_SAFE}
      </p>
    </div>
  );
}

function boldRegistrar(text: string, registrar: string | null): SentenceRun[] {
  if (!registrar) return [{ text }];
  const at = text.indexOf(registrar);
  if (at < 0) return [{ text }];
  return [
    { text: text.slice(0, at) },
    { text: registrar, strong: true },
    { text: text.slice(at + registrar.length) },
  ].filter((r) => r.text.length > 0) as SentenceRun[];
}

function NameserversSection({
  view,
  model,
}: {
  view: OwnerDomainView;
  model: DomainViewModel;
}) {
  const domain = view.domain ?? "";
  return (
    <Section id="domain-nameservers">
      <SectionHeading
        id="domain-nameservers"
        title={C.changeNsH}
        explainer={JARGON.nameservers}
      />
      <NameserverSteps view={view} model={model} />
      {!model.readOnly ? (
        <Actions>
          <CheckButton
            label={P14_COPY.BTN_IVE_CHANGED}
            variant="primary"
            icon="none"
            from="nameservers"
          />
          <SendStepsIsland domain={domain} registrar={model.registrar} />
        </Actions>
      ) : null}
    </Section>
  );
}

function WaitingSection({
  view,
  model,
  notice,
}: {
  view: OwnerDomainView;
  model: DomainViewModel;
  notice: "ns-not-yet" | null;
}) {
  const domain = view.domain ?? "";
  const ago = agoText(view.lastCheckedAt);
  return (
    <Section id="domain-waiting">
      {notice === "ns-not-yet" ? (
        <InlineAlert tone="info">{P14_COPY.NS_NOT_YET}</InlineAlert>
      ) : null}
      <SectionHeading id="domain-waiting" title={C.waitingH} />
      <p className="max-w-[68ch] text-base">{P14_COPY.WAITING_BODY}</p>
      {view.nsSlow ? (
        <InlineAlert
          tone="warning"
          action={
            model.secondary.includes("send_steps") ? (
              <SendStepsIsland domain={domain} registrar={model.registrar} />
            ) : undefined
          }
        >
          {P14_COPY.NS_SLOW({ registrar: model.registrar })}
        </InlineAlert>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {ago ? (
          <span className="text-sm text-hub-ink-muted tabular-nums">
            {C.lastChecked(ago)}
          </span>
        ) : null}
        {model.secondary.includes("check_now") ? <CheckNowButton /> : null}
      </div>
      <details className="rounded border border-hub-border p-4">
        <summary className="cursor-pointer text-base font-semibold pointer-coarse:min-h-11">
          {P14_COPY.BTN_SHOW_NAMESERVERS}
        </summary>
        <div className="mt-4">
          <NameserverSteps view={view} model={model} />
        </div>
      </details>
    </Section>
  );
}

function ConnectedSection({
  view,
  model,
}: {
  view: OwnerDomainView;
  model: DomainViewModel;
}) {
  const domain = view.domain ?? "";
  return (
    <Section id="domain-connected">
      <SectionHeading id="domain-connected" title={C.connectedH} />
      {model.readOnly ? (
        <p className="text-base">
          {C.mainAddress}:{" "}
          <span className="font-mono">{model.mainHost ?? domain}</span>
        </p>
      ) : (
        <PrimaryChoiceIsland domain={domain} value={view.primaryChoice} />
      )}
      <ReadList
        rows={[
          {
            term: C.registeredAt,
            value: registeredLine(view, model.registrar),
          },
          { term: C.dns, value: C.dnsConnected },
          { term: C.secure, value: C.secureLater },
        ]}
      />
      <SubViewLinks model={model} />
    </Section>
  );
}

function SubViewLinks({ model }: { model: DomainViewModel }) {
  const links: { href: string; label: string }[] = [];
  if (model.secondary.includes("dns_records")) {
    links.push({
      href: "/hub/settings?tab=domain&view=records",
      label: P14_COPY.BTN_DNS_RECORDS,
    });
  }
  if (model.secondary.includes("set_up_email")) {
    links.push({
      href: "/hub/settings?tab=domain&view=email",
      label: P14_COPY.BTN_SET_UP_EMAIL,
    });
  }
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={LINK}>
          {l.label}
        </Link>
      ))}
    </div>
  );
}

const STEP_STATE = { done: "done", now: "current", todo: "upcoming" } as const;

function FinishingSection({ view }: { view: OwnerDomainView }) {
  // BuildTracker's ids are the build steps; the launch steps reuse its look (14-30 choice 2),
  // so the ids here are positional keys only.
  const steps: TrackerStep[] = view.steps.map((s, i) => ({
    id: `launch-${i}` as unknown as TrackerStepId,
    label: s.label,
    state: STEP_STATE[s.status],
    ...(s.at ? { at: s.at } : {}),
    defaultLine: "",
  }));
  return (
    <div data-domain-section="domain-finishing">
      <BuildTracker
        steps={steps}
        timeZone="UTC"
        heading={C.launchStepsH}
        orientation="vertical"
      />
    </div>
  );
}

function LiveSection({
  view,
  model,
}: {
  view: OwnerDomainView;
  model: DomainViewModel;
}) {
  const domain = view.domain ?? "";
  const main = model.mainHost ?? domain;
  const other = main === domain ? `www.${domain}` : domain;
  return (
    <Section id="domain-live">
      <SectionHeading id="domain-live" title={C.liveH} />
      <ReadList
        rows={[
          {
            term: C.mainAddress,
            value: (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono">{main}</span>
                {model.secondary.includes("change_main") ? (
                  <ChangeMainIsland
                    domain={domain}
                    value={view.primaryChoice}
                    mainHost={main}
                  />
                ) : null}
              </span>
            ),
          },
          { term: C.alsoWorks, value: C.alsoWorksText(other) },
          {
            term: C.secure,
            value: (
              <span className="inline-flex items-center gap-2">
                <ShieldCheck aria-hidden size={16} />
                {C.secureOn}
              </span>
            ),
          },
          {
            term: C.dns,
            value: (
              <span className="flex flex-wrap items-center gap-x-3">
                {C.dnsLive}
                {model.secondary.includes("dns_records") ? (
                  <Link
                    href="/hub/settings?tab=domain&view=records"
                    className={LINK}
                  >
                    {P14_COPY.BTN_DNS_RECORDS}
                  </Link>
                ) : null}
              </span>
            ),
          },
          {
            term: C.registeredAt,
            value: registeredLine(view, model.registrar),
          },
          ...(view.previewHost
            ? [
                {
                  term: C.previewAddress,
                  value: C.previewText(view.previewHost),
                },
              ]
            : []),
        ]}
      />
      <p className="max-w-[68ch] text-sm text-hub-ink-muted">
        {P14_COPY.DOM_MOVE_HELP}{" "}
        {model.secondary.includes("ask_support") ? (
          <Link href={SUPPORT_CHANGE_HREF} className={LINK}>
            {P14_COPY.BTN_ASK_SUPPORT}
          </Link>
        ) : null}
      </p>
      {model.secondary.includes("set_up_email") ? (
        <Actions>
          <Link
            href="/hub/settings?tab=domain&view=email"
            className={buttonClasses("secondary", "md")}
          >
            {P14_COPY.BTN_SET_UP_EMAIL}
          </Link>
        </Actions>
      ) : null}
    </Section>
  );
}

function SwitchBackSection({
  view,
  model,
}: {
  view: OwnerDomainView;
  model: DomainViewModel;
}) {
  const count = Math.max(
    1,
    view.records.filter((r) => r.group === "email" && r.status === "pending")
      .length,
  );
  return (
    <Section id="domain-switch-back">
      <FocusOnce>
        <InlineAlert
          tone="error"
          title={P14_COPY.MISMATCH_T({ registrar: model.registrar })}
        >
          {P14_COPY.MISMATCH_B({ count, registrar: model.registrar })}
        </InlineAlert>
      </FocusOnce>
      <SectionHeading id="domain-switch-back" title={C.switchBackH} />
      {view.oldNameservers.length > 0 ? (
        <NameserverPair label={C.oldNameservers} values={view.oldNameservers} />
      ) : null}
      <details className="rounded border border-hub-border p-4">
        <summary className="flex cursor-pointer items-center gap-2 text-base font-semibold pointer-coarse:min-h-11">
          <Undo2 aria-hidden size={16} />
          {C.stepsBack(model.registrar)}
        </summary>
        <div className="mt-4">
          <RegistrarSteps kind="nameservers" registrar={model.registrarId} />
        </div>
      </details>
      {model.secondary.includes("switched_back") ? (
        <Actions>
          <CheckButton
            label={P14_COPY.BTN_SWITCHED_BACK}
            icon="none"
            from="switch_back"
          />
        </Actions>
      ) : null}
    </Section>
  );
}

function LostSection({
  view,
  model,
}: {
  view: OwnerDomainView;
  model: DomainViewModel;
}) {
  const domain = view.domain ?? "";
  return (
    <Section id="domain-lost">
      <FocusOnce>
        <InlineAlert
          tone="error"
          title={P14_COPY.LOST_T({ domain })}
          action={
            model.secondary.includes("ask_support") ? (
              <Link
                href={SUPPORT_QUESTION_HREF}
                className={buttonClasses("secondary", "sm")}
              >
                {P14_COPY.BTN_ASK_SUPPORT}
              </Link>
            ) : undefined
          }
        >
          {P14_COPY.LOST_B({ registrar: model.registrar })}
        </InlineAlert>
      </FocusOnce>
      <SectionHeading id="domain-lost" title={C.lostH} />
      <NameserverPair values={view.nameservers} />
      {model.secondary.includes("send_steps") ? (
        <Actions>
          <SendStepsIsland domain={domain} registrar={model.registrar} />
        </Actions>
      ) : null}
    </Section>
  );
}

function ActiveSection({
  view,
  model,
  howTo,
  notice,
}: {
  view: OwnerDomainView;
  model: DomainViewModel;
  howTo: string | null;
  notice: "ns-not-yet" | null;
}): JSX.Element {
  switch (model.section) {
    case "closed":
      return <ClosedSection howTo={howTo} />;
    case "connect":
      return <ConnectSection view={view} model={model} howTo={howTo} />;
    case "checking":
      return <CheckingSection view={view} model={model} />;
    case "findings":
      return <FindingsSection view={view} model={model} howTo={howTo} />;
    case "nameservers":
      return <NameserversSection view={view} model={model} />;
    case "waiting":
      return <WaitingSection view={view} model={model} notice={notice} />;
    case "connected":
      return <ConnectedSection view={view} model={model} />;
    case "finishing":
      return <FinishingSection view={view} />;
    case "live":
      return <LiveSection view={view} model={model} />;
    case "switch_back":
      return <SwitchBackSection view={view} model={model} />;
    case "lost":
      return <LostSection view={view} model={model} />;
  }
}

function ExpiryAlert({
  model,
  howTo,
}: {
  model: DomainViewModel;
  howTo: string | null;
}) {
  const e = model.expiry;
  if (!e) return null;
  const alert = (
    <InlineAlert
      tone={e.tone}
      action={
        howTo ? (
          <HowToLink href={howTo} hash="renew" label={C.howToRenew} />
        ) : undefined
      }
    >
      {e.text}
    </InlineAlert>
  );
  return e.focus ? <FocusOnce>{alert}</FocusOnce> : alert;
}

function HistoryLine({ view }: { view: OwnerDomainView }) {
  if (!view.history) return null;
  const done = view.steps.filter((s) => s.status === "done");
  return (
    <details data-domain-history="" className="text-sm text-hub-ink-muted">
      <summary className="cursor-pointer pointer-coarse:min-h-11">
        {view.history}. {C.show}
      </summary>
      {done.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 pl-4">
          {done.map((s) => (
            <li key={s.label}>
              {s.label}
              {s.at ? ` · ${formatDomainDate(s.at)}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

export function DomainPanel({
  view,
  model,
  subView = null,
  records = null,
  notice = null,
}: {
  view: OwnerDomainView;
  model: DomainViewModel;
  /** `?view=records|email` (14-32): rendered only when `records` (a CDS zone) exists. */
  subView?: "records" | "email" | null;
  /** The 14-28 owner records view; null before a CDS zone exists. */
  records?: OwnerDnsRecordsView | null;
  notice?: "ns-not-yet" | null;
}) {
  if (subView && records) {
    return (
      <div
        data-domain-panel={model.state}
        data-domain-subview={subView}
        className="flex flex-col gap-8 font-hub text-hub-ink"
      >
        {subView === "records" ? (
          <DnsRecordsView records={records} adminRead={model.readOnly} />
        ) : (
          <EmailSetupView
            records={records}
            adminRead={model.readOnly}
            howToHref={helpHref("email-address")}
          />
        )}
      </div>
    );
  }
  const howTo = domainHowToHref();
  const showHistory =
    model.section === "connected" ||
    model.section === "finishing" ||
    model.section === "live";
  return (
    <div
      data-domain-panel={model.state}
      className="flex flex-col gap-8 font-hub text-hub-ink"
    >
      <DomainStatusPoller
        active={model.poll}
        state={view.state}
        mark={domainMark(view)}
      />
      <div className="flex flex-col gap-2">
        <DomainStatusLine
          tone={model.tone}
          sentence={<Sentence runs={model.sentence} />}
          {...(model.link ? { link: model.link } : {})}
        />
        {model.adminNote ? (
          <p className="text-sm text-hub-ink-muted">{model.adminNote}</p>
        ) : null}
      </div>
      <ExpiryAlert model={model} howTo={howTo} />
      <ActiveSection view={view} model={model} howTo={howTo} notice={notice} />
      {showHistory ? <HistoryLine view={view} /> : null}
    </div>
  );
}
