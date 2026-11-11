// /staff/review/<id> (13-38 choice 3; STAFF-23, STAFF-24, STAFF-26; D248, D249, D-UI-P13-10,
// -25; 13-UI-SPEC "Case page" lines 693-719). One layout for flags, holds, spot checks, reports
// and DMCA notices. `R-31` reads the case (staffGetCase: reporter fields are staff-only and shown
// only here); a 15-character id (or `flag-<id>`) is a scan flag / hold from the review queue
// read model (open first, then done), else a case by its record id. Unknown → notFound().
// Left column: What was found (URLs open in a new tab, rel noopener noreferrer; every reported
// text is rendered as text, T-13-38-03), the CaseTimeline (reports and DMCA), the spot-check
// pages, then the sticky OutcomeBar (secondary only). Right rail: Assignee, Due, Site (+ repeat
// flag, D-UI-P13-25: no close-site button), Audit (last 5 lines + Full audit).
import { CdsError } from "@cds/core";
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import {
  describeTakedown,
  spotCheckPages,
  staffGetCase,
  staffGetFlag,
  staffListAuditLog,
  staffSupportLabels,
  type PlatformContext,
  type ReviewQueueItem,
  type StaffAuditRow,
  type StaffReviewCase,
} from "@cds/db";
import { Badge, type BadgeTone } from "@cds/ui/hub";
import {
  formatCaseWhen,
  REVIEW_COPY,
  type CaseTimelineEntry,
} from "@cds/ui/staff";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SECTION_REGISTRY } from "../../../../../../lib/section-registry";
import { requireStaff, staffCan } from "../../../../../../lib/staff-session";
import { SitesLoadError } from "../../sites/SitesLoadError";
import {
  AssignControl,
  CaseOutcomes,
  CaseTimelineActions,
  SpotPages,
  type CaseOutcomesProps,
} from "../CaseActions";
import {
  actorLabel,
  assigneeLabel,
  categoryLabel,
  errName,
  spotPageUrl,
} from "../review-data";

export const metadata: Metadata = { title: "Review case" };

export const dynamic = "force-dynamic";

const C = REVIEW_COPY;
const TZ = BUSINESS_TIME_ZONE;
const REF_RE = /^R-[1-9]\d{0,8}$/i;
const ID_RE = /^[a-z0-9]{15}$/;

const BACK =
  "inline-flex items-center gap-1 self-start rounded text-sm font-semibold text-hub-accent " +
  "underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-hub-accent";
const LINK =
  "font-semibold text-hub-accent underline underline-offset-2 break-all " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

type Loaded =
  | { type: "case"; c: StaffReviewCase }
  | { type: "flag"; item: ReviewQueueItem };

function isNotFound(err: unknown): boolean {
  return err instanceof CdsError && err.code === "not_found";
}

async function load(ctx: PlatformContext, raw: string): Promise<Loaded | null> {
  const seg = raw.trim();
  if (REF_RE.test(seg)) {
    try {
      return { type: "case", c: await staffGetCase(ctx, `R-${seg.slice(2)}`) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
  const id = seg.replace(/^flag-/, "");
  if (!ID_RE.test(id)) return null;
  // WR-D05: a direct read by id, not a scan of the capped Done list.
  const item = await staffGetFlag(ctx, id);
  if (item) return { type: "flag", item };
  try {
    return { type: "case", c: await staffGetCase(ctx, id) };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

function sizeText(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

function kindBadge(l: Loaded): { tone: BadgeTone; text: string } {
  if (l.type === "flag") {
    const i = l.item;
    if (i.kind === "scan_hold") {
      const days = i.heldBusinessDays;
      return {
        tone: i.pastPromise ? "r-held-late" : "r-held",
        text: days === undefined ? C.status.held : C.held(days),
      };
    }
    return i.status === "queued"
      ? { tone: "r-queued", text: C.kind.queued }
      : { tone: "r-flag", text: C.kind.scan_flag };
  }
  const k = l.c.kind;
  return {
    tone: k === "dmca" ? "r-dmca" : k === "spot_check" ? "r-spot" : "r-report",
    text: C.kind[k],
  };
}

function statusText(l: Loaded): string {
  const s = l.type === "flag" ? l.item.status : l.c.status;
  return (C.status as Record<string, string>)[s] ?? s;
}

/** "Page · About us" → "Held page · About us". */
function flagHeading(i: ReviewQueueItem): string {
  const t = i.target.title;
  if (i.kind !== "scan_hold") return `${C.kind.scan_flag} · ${t}`;
  return `Held ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

function bareTitle(title: string): string {
  const i = title.indexOf(" · ");
  return i >= 0 ? title.slice(i + 3) : "";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-semibold text-hub-ink-muted">{k}</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  // Only http(s) URLs become links; anything else is shown as text (T-13-38-03).
  if (!/^https?:\/\//i.test(href))
    return <span className="break-all">{href}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
    </a>
  );
}

export default async function ReviewCasePage({
  params,
}: {
  params: Promise<{ case: string }>;
}) {
  const session = await requireStaff("review_queue");
  const { case: rawParam } = await params;
  let raw = rawParam;
  try {
    raw = decodeURIComponent(rawParam);
  } catch {
    notFound();
  }
  const ctx = session.ctx;
  const me = ctx.actor;
  const now = new Date();

  let loaded: Loaded | null;
  try {
    loaded = await load(ctx, raw);
  } catch (err) {
    console.error("[staff review] case read failed", errName(err));
    return (
      <div className="flex flex-col gap-4">
        <Link href="/staff/review" className={BACK}>
          <ArrowLeft aria-hidden size={16} strokeWidth={2} />
          Review queue
        </Link>
        <SitesLoadError href={`/staff/review/${encodeURIComponent(raw)}`} />
      </div>
    );
  }
  if (!loaded) notFound();

  const orgId = loaded.type === "flag" ? loaded.item.orgId : loaded.c.orgId;
  const business =
    (loaded.type === "flag" ? loaded.item.business : loaded.c.business) ?? "";
  const targetCollection =
    loaded.type === "flag"
      ? loaded.item.target.collection
      : loaded.c.targetCollection;
  const targetId =
    loaded.type === "flag" ? loaded.item.target.id : loaded.c.targetId;
  const closed =
    loaded.type === "flag"
      ? loaded.item.status === "resolved"
      : loaded.c.status === "closed";
  const canSuspend = staffCan(session.role, "suspend_now");
  const canTakeDown = staffCan(session.role, "media_takedown");

  // Side reads (best effort: a failure drops the line, never the page).
  let title = loaded.type === "flag" ? bareTitle(loaded.item.target.title) : "";
  if (
    loaded.type === "case" &&
    targetCollection === "pages" &&
    ID_RE.test(targetId)
  ) {
    try {
      const l = await staffSupportLabels(ctx, { pageIds: [targetId] });
      title = l.pages[targetId] ?? "";
    } catch (err) {
      console.error("[staff review] page label failed", errName(err));
    }
  }
  let takedown: CaseOutcomesProps["takedown"] = null;
  if (
    targetCollection === "media_assets" &&
    canTakeDown &&
    orgId &&
    ID_RE.test(targetId) &&
    !closed
  ) {
    try {
      const t = await describeTakedown(ctx, orgId, targetId, {
        sections: SECTION_REGISTRY,
      });
      takedown = { size: sizeText(t.asset.bytes), usedOn: t.usedOn.length };
      if (!title) title = t.asset.name;
    } catch (err) {
      console.error("[staff review] takedown case failed", errName(err));
    }
  }
  let audit: StaffAuditRow[] = [];
  if (orgId) {
    try {
      audit = (await staffListAuditLog(ctx, orgId, { perPage: 5 })).items;
    } catch (err) {
      console.error("[staff review] audit read failed", errName(err));
    }
  }

  const badge = kindBadge(loaded);
  const heading =
    loaded.type === "flag"
      ? flagHeading(loaded.item)
      : C.caseTitle(loaded.c.ref);
  const targetKind: CaseOutcomesProps["targetKind"] =
    targetCollection === "pages"
      ? "page"
      : targetCollection === "media_assets"
        ? "media"
        : targetCollection
          ? "other"
          : "none";
  const held =
    loaded.type === "flag" ? loaded.item.kind === "scan_hold" : false;
  const repeat = loaded.type === "case" && loaded.c.repeatInfringer;
  const dueAt = loaded.type === "case" ? loaded.c.dueAt : null;
  const pastDue = dueAt ? now.getTime() > Date.parse(dueAt) && !closed : false;
  const assignee =
    loaded.type === "case" ? loaded.c.assignee : loaded.item.assignee;

  // What was found.
  const found: (readonly [string, ReactNode])[] = [];
  if (loaded.type === "flag") {
    const i = loaded.item;
    found.push([C.cols.what, i.target.title]);
    if (i.verdict) found.push([C.verdict, i.verdict]);
    if (i.reasons.length > 0) found.push([C.reasons, i.reasons.join("\n")]);
  } else {
    const c = loaded.c;
    if (c.targetUrl)
      found.push([
        "Page address",
        <ExternalLink key="u" href={c.targetUrl}>
          {c.targetUrl}
        </ExternalLink>,
      ]);
    if (title) found.push([C.cols.what, title]);
    found.push([C.cols.category, categoryLabel(c.category)]);
    if (c.description) found.push([C.description, c.description]);
  }
  const liveUrl = loaded.type === "flag" ? loaded.item.target.url : null;

  const target: CaseOutcomesProps["target"] =
    loaded.type === "flag"
      ? { type: "flag", id: loaded.item.ref }
      : { type: "case", ref: loaded.c.ref };

  const timeline: CaseTimelineEntry[] =
    loaded.type === "case"
      ? loaded.c.steps.map((s) => ({
          step: s.step,
          at: s.at,
          byName: actorLabel(s.by, me),
          ...(s.note ? { note: s.note } : {}),
          ...(s.restoreDate ? { restoreDate: s.restoreDate } : {}),
        }))
      : [];

  return (
    <div className="flex w-full flex-col gap-6 font-hub text-hub-ink">
      <Link href="/staff/review" className={BACK}>
        <ArrowLeft aria-hidden size={16} strokeWidth={2} />
        Review queue
      </Link>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <Badge tone={badge.tone}>{badge.text}</Badge>
        <span className="text-sm text-hub-ink-muted">{statusText(loaded)}</span>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title={C.whatFound}>
            <Rows rows={found} />
            {liveUrl ? (
              <p className="text-sm">
                <ExternalLink href={liveUrl}>{C.viewLive}</ExternalLink>
              </p>
            ) : null}
          </Section>
          {loaded.type === "case" &&
          (loaded.c.reporterName || loaded.c.reporterEmail) ? (
            <Section title={C.reporter}>
              <p className="text-sm text-hub-ink-muted">{C.reporterOnly}</p>
              <Rows
                rows={[
                  ...(loaded.c.reporterName
                    ? ([["Name", loaded.c.reporterName]] as const)
                    : []),
                  ...(loaded.c.reporterEmail
                    ? ([["Email", loaded.c.reporterEmail]] as const)
                    : []),
                ]}
              />
            </Section>
          ) : null}
          {loaded.type === "case" && loaded.c.dmcaStatement ? (
            <Section title={C.dmcaStatements}>
              <Rows
                rows={[
                  [
                    C.goodFaith,
                    loaded.c.dmcaStatement.good_faith ? "Yes" : "No",
                  ],
                  [C.accuracy, loaded.c.dmcaStatement.accuracy ? "Yes" : "No"],
                  [C.signature, loaded.c.dmcaStatement.signature],
                  [
                    C.signedAt,
                    formatCaseWhen(loaded.c.dmcaStatement.signed_at, TZ),
                  ],
                ]}
              />
            </Section>
          ) : null}
          {loaded.type === "case" && loaded.c.kind !== "spot_check" ? (
            <CaseTimelineActions
              caseRef={loaded.c.ref}
              kind={loaded.c.kind}
              entries={timeline}
              timeZone={TZ}
              closed={closed}
            />
          ) : null}
          {loaded.type === "case" && loaded.c.kind === "spot_check" ? (
            <SpotPages
              caseRef={loaded.c.ref}
              closed={closed}
              pages={spotCheckPages(loaded.c.pages).map((pg) => ({
                pageId: pg.pageId,
                title: pg.title,
                state: pg.state,
                ...(pg.note ? { note: pg.note } : {}),
                url: spotPageUrl(loaded.c.targetUrl, pg.slug),
              }))}
            />
          ) : null}
          <CaseOutcomes
            target={target}
            business={business}
            title={title}
            targetKind={targetKind}
            held={held}
            canSuspend={canSuspend}
            canTakeDown={canTakeDown}
            closed={closed}
            takedown={takedown}
          />
        </div>
        <aside className="flex flex-col gap-6" aria-label="Case details">
          {loaded.type === "case" ? (
            <Section title={C.rail.assignee}>
              <AssignControl
                caseRef={loaded.c.ref}
                label={assigneeLabel(assignee, me)}
                mine={assignee === me}
                assigned={Boolean(assignee)}
                closed={closed}
              />
            </Section>
          ) : null}
          {dueAt ? (
            <Section title={C.rail.due}>
              <p className={"text-sm " + (pastDue ? "text-hub-danger" : "")}>
                {C.rail.duePromise(formatCaseWhen(dueAt, TZ))}
              </p>
            </Section>
          ) : null}
          <Section title={C.rail.site}>
            {orgId ? (
              <div className="flex flex-col gap-2 text-sm">
                <Link href={`/staff/sites/${orgId}`} className={LINK}>
                  {business || orgId}
                </Link>
                {repeat ? (
                  <>
                    <span>
                      <Badge tone="repeat">{C.repeat}</Badge>
                    </span>
                    <span className="text-hub-ink-muted">
                      {C.rail.closingNote}
                    </span>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-hub-ink-muted">{C.noSite}</p>
            )}
          </Section>
          {orgId ? (
            <Section title={C.rail.audit}>
              {audit.length > 0 ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {audit.map((a) => (
                    <li key={a.id} className="break-words">
                      {a.action} · {a.actorName || C.cdsStaff} ·{" "}
                      <span className="text-hub-ink-muted">
                        {formatCaseWhen(a.created, TZ)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Link href={`/staff/sites/${orgId}?tab=audit`} className={LINK}>
                {C.rail.fullAudit}
              </Link>
            </Section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
