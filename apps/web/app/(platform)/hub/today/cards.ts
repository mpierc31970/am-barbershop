// Today cards, From CDS and the work-in-progress card (11-19; DASH-21, DASH-22, DASH-23,
// DASH-33; 11-UI-SPEC "Today" §§ 4, 8 and "Live, normal"; D-UI-P11-24, D-UI-P11-30; D310;
// T-11-19-01). Server-only. Every read takes the session OrgContext; each loader resolves
// (never rejects) so one failing source only changes its own section or card.
// - Cards: the core Inquiries card (content:read, the Inbox's own gate) plus each active,
//   unpaused add-on's card, each only when the person can read `addon:<slug>` (checked BEFORE
//   the provider runs). Order: defaultCardOrder(path, available, prefs.todayLayout); only the
//   visible cards are loaded. A provider that throws turns into that card's error line; a
//   provider returning null contributes nothing today. Provider data is cut to 4 rows and any
//   href that is not a hub path is dropped.
// - From CDS: pickFromCds over the active announcement, add-ons installed in the last 14 days
//   (with a training entry), CORE_TIPS (only tips whose screen the person can open) and one
//   suggested add-on (Owner only, not impersonating; path-eligible, public, can be added).
//   Kinds by role follow the UI-SPEC role table. 12-29 (COMM-02): the org's pinned CDS note
//   (deps.note, loaded by the page for people with support:read) outranks everything.
// - Work in progress: open work orders needing setup (WorkOrderSummary.setup), Owner only
//   (billing:read), shown after launch.
import { ADDON_REGISTRY, howToSteps } from "@cds/addon-registry";
import type { TodayProvider } from "@cds/addon-registry/server";
import { can, type OrgRole } from "@cds/core";
import { ADDON_PATHS, type AddonPath } from "@cds/core/addons";
import {
  CORE_TIPS,
  TODAY_CARD_MAX_ROWS,
  TRAINING_WINDOW_DAYS,
  defaultCardOrder,
  isHubHref,
  pickFromCds,
  startOfBusinessDayUtc,
  type AvailableCard,
  type FromCdsCard,
  type FromCdsNote,
  type FromCdsTip,
  type FromCdsTraining,
  type TodayCardData,
} from "@cds/core/today";
import {
  activeAddons,
  activeAnnouncement,
  listSubmissions,
  listWorkOrders,
  recentAddonInstalls,
  type MemberPrefs,
  type OrgContext,
  type WeekNumbers,
} from "@cds/db";
import type { BuildWorkJob, TodayCardView } from "@cds/ui/hub/today";
import { formatWeekday, TODAY_CARDS_COPY } from "@cds/ui/hub/today";
import { availability } from "../add-ons/catalog-logic";

export type Section<T> = { ok: true; data: T } | { ok: false };

export const INQUIRIES_CARD_ID = "inquiries";
const INBOX_HREF = "/hub/inbox?tab=messages";
const DAY_MS = 86_400_000;

export type TodayRailDeps = {
  now: Date;
  /** The org's active, unpaused add-on Today providers; null when that state can't be read. */
  providers: () => Promise<TodayProvider[] | null>;
  path: () => Promise<AddonPath>;
  /** null when prefs can't be read (defaults then). */
  prefs: Promise<MemberPrefs | null>;
  timeZone: Promise<string>;
  /** This week vs last week (shared with This week; memoized by the caller). */
  week: () => Promise<WeekNumbers>;
  /** 12-29: the pinned CDS note (resolves null on failure or without support:read). */
  note?: Promise<FromCdsNote | null>;
};

export type TodayCardsData = {
  cards: TodayCardView[];
  /** Every card the person may see: visible first (in order), then hidden. */
  all: { id: string; title: string }[];
  hidden: string[];
  defaultOrder: string[];
};

export type FromCdsData = {
  card: FromCdsCard;
  steps: { screen: string; action: string; expected: string }[];
};

function logFail(what: string, err: unknown): void {
  console.error(
    `[today] ${what} failed`,
    err instanceof Error ? err.name : typeof err,
  );
}

/** A stored plan path, or Standard. */
export function asAddonPath(raw: unknown): AddonPath {
  return (ADDON_PATHS as readonly unknown[]).includes(raw)
    ? (raw as AddonPath)
    : "standard";
}

/** D-UI-P11-30: "Inquiries" is only the Standard card title; the hub says "messages". */
export function inquiriesTitle(path: AddonPath): string {
  return path === "standard"
    ? TODAY_CARDS_COPY.inquiriesTitle
    : TODAY_CARDS_COPY.messages;
}

/** Provider output made safe to render: at most 4 rows, hub-only hrefs, strings only. */
export function cleanCardData(
  raw: TodayCardData,
  fallbackTitle: string,
): TodayCardData {
  const text = (v: unknown, max: number) =>
    typeof v === "string" ? v.slice(0, max) : "";
  const href = (v: unknown) =>
    typeof v === "string" && isHubHref(v) ? v : undefined;
  const rows = Array.isArray(raw?.rows) ? raw.rows : [];
  const link = raw?.link;
  return {
    title: text(raw?.title, 80) || fallbackTitle,
    rows: rows.slice(0, TODAY_CARD_MAX_ROWS).map((r) => {
      const h = href(r?.href);
      return {
        label: text(r?.label, 120),
        value: text(r?.value, 40),
        ...(h ? { href: h } : {}),
      };
    }),
    link: {
      label: text(link?.label, 60),
      href: href(link?.href) ?? "",
    },
  };
}

async function inquiriesCard(
  ctx: OrgContext,
  deps: TodayRailDeps,
  title: string,
): Promise<TodayCardView> {
  const [tz, page, week] = await Promise.all([
    deps.timeZone,
    listSubmissions(ctx, { perPage: 3 }),
    deps.week().catch((err: unknown) => {
      logFail("inquiries count", err);
      return null;
    }),
  ]);
  const weekStart =
    week && week.days.now[0]
      ? startOfBusinessDayUtc(week.days.now[0], tz).getTime()
      : deps.now.getTime() - 7 * DAY_MS;
  const rows = page.items
    .filter((m) => {
      const t = Date.parse(
        m.created.includes("T") ? m.created : m.created.replace(" ", "T"),
      );
      return Number.isFinite(t) && t >= weekStart;
    })
    .slice(0, 3)
    .map((m) => ({
      label: `${m.from.trim() || TODAY_CARDS_COPY.someone} · ${m.formName}`,
      value: formatWeekday(m.created, tz),
      href: `${INBOX_HREF}&message=${encodeURIComponent(m.id)}`,
    }));
  return {
    id: INQUIRIES_CARD_ID,
    title,
    state: "ok",
    data: {
      title,
      rows,
      link: { label: TODAY_CARDS_COPY.openInbox, href: "/hub/inbox" },
    },
    empty: TODAY_CARDS_COPY.inquiriesEmpty,
    ...(week
      ? { footer: TODAY_CARDS_COPY.messagesThisWeek(week.inquiries.now) }
      : {}),
  };
}

/** Today cards for this person; null for Viewers (the section is absent, D310 / UI-SPEC). */
export async function loadTodayCards(
  ctx: OrgContext,
  deps: TodayRailDeps,
): Promise<Section<TodayCardsData | null>> {
  if (ctx.role === "viewer") return { ok: true, data: null };
  try {
    const [path, prefs, providers] = await Promise.all([
      deps.path().catch((err: unknown) => {
        logFail("plan path", err);
        return "standard" as AddonPath;
      }),
      deps.prefs,
      deps.providers(),
    ]);
    // T-11-19-01: an add-on's card only with its grant, decided before the provider runs.
    const addonCards = (providers ?? []).filter(
      (
        p,
      ): p is TodayProvider &
        Required<Pick<TodayProvider, "card" | "cardSpec">> =>
        Boolean(p.card && p.cardSpec) && can(ctx, `addon:${p.slug}`, "read"),
    );
    const titles = new Map<string, string>();
    const available: AvailableCard[] = [];
    if (can(ctx, "content", "read")) {
      titles.set(INQUIRIES_CARD_ID, inquiriesTitle(path));
      available.push({ id: INQUIRIES_CARD_ID, order: 0 });
    }
    addonCards.forEach((p, i) => {
      titles.set(p.cardSpec.id, p.cardSpec.title);
      available.push({ id: p.cardSpec.id, order: i + 1 });
    });
    const base = defaultCardOrder(path, available);
    const layout = defaultCardOrder(path, available, prefs?.todayLayout);
    const byId = new Map(addonCards.map((p) => [p.cardSpec.id, p]));

    const cards = await Promise.all(
      layout.visible.map(async (id): Promise<TodayCardView | null> => {
        const title = titles.get(id) ?? id;
        try {
          if (id === INQUIRIES_CARD_ID) {
            return await inquiriesCard(ctx, deps, title);
          }
          const p = byId.get(id);
          if (!p) return null;
          const data = await p.card(ctx);
          if (!data) return null;
          return { id, title, state: "ok", data: cleanCardData(data, title) };
        } catch (err) {
          logFail(`card ${id}`, err);
          return { id, title, state: "error" };
        }
      }),
    );
    return {
      ok: true,
      data: {
        cards: cards.filter((c): c is TodayCardView => c !== null),
        all: [...layout.visible, ...layout.hidden].map((id) => ({
          id,
          title: titles.get(id) ?? id,
        })),
        hidden: layout.hidden,
        defaultOrder: base.visible,
      },
    };
  } catch (err) {
    logFail("cards", err);
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------------------
// From CDS

type FromCdsKinds = {
  announcement: boolean;
  training: boolean;
  tips: boolean;
  suggestion: boolean;
};

/** UI-SPEC role table: which From CDS kinds a person can get. */
export function fromCdsKinds(
  role: OrgRole | string,
  impersonating: boolean,
): FromCdsKinds {
  if (role === "viewer") {
    return {
      announcement: false,
      training: false,
      tips: true,
      suggestion: false,
    };
  }
  if (role === "staff" || role === "renter") {
    return {
      announcement: false,
      training: true,
      tips: false,
      suggestion: false,
    };
  }
  return {
    announcement: true,
    training: true,
    tips: true,
    suggestion: role === "owner" && !impersonating,
  };
}

/**
 * Tip screens that don't exist yet. A tip never links to a missing screen; drop an entry
 * here when its screen ships (Profile shipped in 11-24, People & roles in 11-39).
 */
export const TIP_SCREENS_PENDING: readonly string[] = [];

/** The feature a tip's screen needs; a tip shows only when the person can open it. */
export function tipAllowed(tip: FromCdsTip, ctx: OrgContext): boolean {
  const href = tip.link.href;
  const at = (p: string) =>
    href === p || href.startsWith(`${p}?`) || href.startsWith(`${p}/`);
  if (TIP_SCREENS_PENDING.some(at)) return false;
  // Every member has Your profile and alerts (11-24).
  if (at("/hub/profile")) return true;
  // People & roles: only the Owner can invite, so the tip is theirs (11-39).
  if (href.startsWith("/hub/settings?tab=people")) {
    return ctx.role === "owner" && can(ctx, "members", "write");
  }
  if (at("/hub/settings")) return can(ctx, "settings", "read");
  return can(ctx, "content", "read");
}

async function trainingCandidates(
  ctx: OrgContext,
  now: Date,
): Promise<{
  list: FromCdsTraining[];
  steps: Map<string, FromCdsData["steps"]>;
}> {
  const since = new Date(now.getTime() - TRAINING_WINDOW_DAYS * DAY_MS);
  const installs = await recentAddonInstalls(ctx, since);
  const list: FromCdsTraining[] = [];
  const steps = new Map<string, FromCdsData["steps"]>();
  for (const i of installs) {
    const m = ADDON_REGISTRY.get(i.slug);
    const entry = m?.training[0];
    if (!m || !entry || !can(ctx, `addon:${m.slug}`, "read")) continue;
    const s = howToSteps(entry.howTo).map((x) => ({
      screen: x.screen,
      action: x.action,
      expected: x.expected,
    }));
    if (s.length === 0) continue;
    steps.set(m.slug, s);
    list.push({
      slug: m.slug,
      name: m.name,
      line: m.summary,
      installedAt: i.installedAt.includes("T")
        ? i.installedAt
        : i.installedAt.replace(" ", "T"),
    });
  }
  return { list, steps };
}

async function suggestedAddon(
  ctx: OrgContext,
  path: AddonPath,
): Promise<{ slug: string; name: string; summary: string } | null> {
  const active = await activeAddons(ctx);
  for (const m of ADDON_REGISTRY.publicList()) {
    if (!m.paths.includes(path)) continue;
    const a = availability({
      manifest: m,
      active,
      role: ctx.role as OrgRole,
      impersonating: Boolean(ctx.impersonator),
      registry: ADDON_REGISTRY,
    });
    if (a.state === "can-add") {
      return { slug: m.slug, name: m.name, summary: m.summary };
    }
  }
  return null;
}

/** One From CDS card for this person, or null. Never touches Needs you. */
export async function loadFromCds(
  ctx: OrgContext,
  deps: TodayRailDeps,
): Promise<Section<FromCdsData | null>> {
  try {
    const kinds = fromCdsKinds(ctx.role, Boolean(ctx.impersonator));
    const soft = <T>(what: string, p: Promise<T>, fallback: T): Promise<T> =>
      p.catch((err: unknown) => {
        logFail(what, err);
        return fallback;
      });
    const [prefs, path, note] = await Promise.all([
      deps.prefs,
      soft("plan path", deps.path(), "standard" as AddonPath),
      soft("pinned note", deps.note ?? Promise.resolve(null), null),
    ]);
    const [announcement, training, suggestion] = await Promise.all([
      kinds.announcement
        ? soft(
            "announcement",
            activeAnnouncement(
              deps.now,
              path === "studio" ? "studio" : "standard",
            ),
            null,
          )
        : Promise.resolve(null),
      kinds.training
        ? soft("training", trainingCandidates(ctx, deps.now), {
            list: [],
            steps: new Map<string, FromCdsData["steps"]>(),
          })
        : Promise.resolve({
            list: [],
            steps: new Map<string, FromCdsData["steps"]>(),
          }),
      kinds.suggestion
        ? soft("suggested add-on", suggestedAddon(ctx, path), null)
        : Promise.resolve(null),
    ]);
    const card = pickFromCds({
      note,
      announcement: announcement
        ? {
            id: announcement.id,
            title: announcement.title,
            text: announcement.body,
            link: announcement.href
              ? { label: "Read more", href: announcement.href }
              : null,
          }
        : null,
      recentAddonTraining: training.list,
      tips: kinds.tips ? CORE_TIPS.filter((t) => tipAllowed(t, ctx)) : [],
      suggestedAddon: suggestion,
      dismissed: prefs?.dismissed ?? [],
      now: deps.now,
    });
    if (!card) return { ok: true, data: null };
    const steps =
      card.kind === "training" ? (training.steps.get(card.slug) ?? []) : [];
    return { ok: true, data: { card, steps } };
  } catch (err) {
    logFail("from cds", err);
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------------------
// Work in progress (DASH-33)

/** Open work orders needing setup (Owner only; anyone else, or a failed read, gets none). */
export async function loadBuildWork(ctx: OrgContext): Promise<BuildWorkJob[]> {
  if (!can(ctx, "billing", "read")) return [];
  try {
    const list = await listWorkOrders(ctx);
    return list
      .filter((w) => w.setup !== null)
      .map((w) => ({
        id: w.id,
        title: w.title,
        step: w.setup as BuildWorkJob["step"],
        startedLabel: w.acceptedLabel,
        href: w.href,
      }));
  } catch (err) {
    logFail("work orders", err);
    return [];
  }
}
