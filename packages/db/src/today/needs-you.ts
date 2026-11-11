// P11 Needs you (DASH-20, DASH-21, DASH-22, DASH-27, DASH-31; D285, D312; 11-13; RESEARCH
// Pattern 3). The one source for the Today list, the sidebar / tab badges and bell clearing.
//
// listNeedsYou(ctx, deps) runs every core provider and each active add-on's
// `today.needsYou(ctx)` (handed in as `deps.today`, built by the web app from the registry,
// so this package never imports the registry: invariant 4) under Promise.allSettled:
// - a provider that throws is skipped and named in `failed`, so its section's badge is
//   omitted rather than shown wrong (T-11-13-03); the log carries the error name only.
// - every item carries an internal feature/access pair; after the merge an item is dropped
//   when `!can(ctx, feature, access)` (billing Owner only, Viewers get nothing; D285,
//   T-11-13-01). The internal fields are stripped before return.
// - every href must pass isHubHref; add-on items must also use their own `<slug>:` key and
//   `addon:<slug>` (or a core) section (T-11-13-02). Anything else is dropped.
// - urgent first, then oldest (sortNeedsYou). Duplicate keys keep the first.
// A provider is only called when the person could see its items, so a Forbidden read never
// lands in `failed`. Org context is a required argument and every read is scoped to
// ctx.orgId through the existing org-scoped functions (invariant 1).
import { can, type Action } from "@cds/core";
import { addonIntakeFields, stillNeeded } from "@cds/core/intake";
import { isHubHref, sortNeedsYou, type NeedsYouItem } from "@cds/core/today";
import { assertOrgContext, type OrgContext } from "../context";
import { domainNeedsYou } from "../dns/owner";
import { listSubmissions } from "../forms/submissions";
import { listEmailRoutes } from "../intake/email-routes";
import { leavingNeedsYou } from "../offboarding/offboardings";
import { getIntakeSnapshot } from "../intake/snapshot";
import { agreementStatus } from "../legal/signatures";
import { getOrgStage } from "../org-stage";
import { readConnectStatus } from "../payments/connect";
import { billingNeedsYou } from "../payments/needs-you";
import { supportNeedsYou } from "../support/needs-you";

/** One active add-on's Needs-you provider (structurally the registry's TodayProvider). */
export type NeedsYouAddonProvider = {
  slug: string;
  needsYou?: (ctx: OrgContext) => Promise<NeedsYouItem[]>;
};

/** The registry slice the intake provider reads (add-on intake fields). */
export type AddonRegistryLike = Parameters<typeof addonIntakeFields>[0];

export type NeedsYouDeps = {
  /** activeTodayProviders(ADDON_REGISTRY, ADDON_SERVER, active, paused). */
  today: readonly NeedsYouAddonProvider[];
  registry: AddonRegistryLike;
  now?: Date;
};

export type NeedsYouResult = { items: NeedsYouItem[]; failed: string[] };

type Grant = { feature: string; access: Action };
type Tagged = NeedsYouItem & Grant;

type Env = { now: string; registry: AddonRegistryLike };

type CoreProvider = Grant & {
  name: string;
  run(ctx: OrgContext, env: Env): Promise<Tagged[]>;
};

/** Stages in which the still-needed intake items are the owner's build work (D312). */
const BUILD_STAGES: readonly string[] = ["being_built", "ready_for_review"];
/** The inbox provider's item cap (apps/web lib/bell.ts mirrors it; a drift test checks). */
export const NEEDS_YOU_INBOX_MAX = 20;
const INBOX_MAX = NEEDS_YOU_INBOX_MAX;

/** PocketBase dates ("YYYY-MM-DD HH:MM:SS.sssZ") as ISO; anything else falls back. */
function isoOf(v: string, fallback: string): string {
  const t = Date.parse(v.replace(" ", "T"));
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

const inbox: CoreProvider = {
  name: "inbox",
  feature: "content",
  access: "read",
  async run(ctx, env) {
    const page = await listSubmissions(ctx, {
      view: "messages",
      unread: true,
      perPage: INBOX_MAX,
    });
    return page.items.map((m) => {
      const form = m.formName.trim() || "a";
      return {
        key: `inbox:${m.id}`,
        kind: "inbox.message",
        level: "normal",
        title: m.from.trim() || `New message from the ${form} form`,
        sub: `From the ${form} form`,
        actionLabel: "Reply",
        href: `/hub/inbox?tab=messages&message=${encodeURIComponent(m.id)}`,
        section: "inbox",
        at: isoOf(m.created, env.now),
        feature: "content",
        access: "read",
      };
    });
  },
};

const billing: CoreProvider = {
  name: "billing",
  feature: "billing",
  access: "read",
  async run(ctx, env) {
    return (await billingNeedsYou(ctx)).map((b) => {
      const tab = b.kind === "finish_stripe" ? "payments" : "billing";
      const id =
        b.kind === "quote"
          ? `:${decodeURIComponent(b.href.split("/").pop() ?? "")}`
          : "";
      return {
        key: `billing:${b.kind}${id}`,
        kind: `billing.${b.kind}`,
        level: b.kind === "fix_card" ? "urgent" : "normal",
        title: b.title,
        actionLabel: b.actionLabel,
        href: b.href,
        section: "settings",
        tab,
        at: env.now,
        feature: "billing",
        access: "read",
      };
    });
  },
};

/** An onboarding started and never finished (billing covers a once-connected account). */
const stripe: CoreProvider = {
  name: "stripe",
  feature: "connect",
  access: "write",
  async run(ctx, env) {
    const s = await readConnectStatus(ctx);
    if (s.state !== "setup_unfinished") return [];
    return [
      {
        key: "connect:setup",
        kind: "connect.setup",
        level: "normal",
        title: "Finish Stripe setup",
        actionLabel: "Finish Stripe setup",
        href: "/hub/settings?tab=payments",
        section: "settings",
        tab: "payments",
        at: env.now,
        feature: "connect",
        access: "write",
      },
    ];
  },
};

const agreement: CoreProvider = {
  name: "agreement",
  feature: "policy_accept",
  access: "run",
  async run(ctx, env) {
    const s = await agreementStatus(ctx);
    if (s.state !== "outdated") return [];
    return [
      {
        key: "agreement:reaccept",
        kind: "agreement.reaccept",
        level: "normal",
        title: "Accept the updated terms",
        actionLabel: "Review terms",
        href: "/hub/agreement?mode=reaccept",
        section: "settings",
        tab: "legal",
        at: env.now,
        feature: "policy_accept",
        access: "run",
      },
    ];
  },
};

const intake: CoreProvider = {
  name: "intake",
  feature: "business",
  access: "write",
  async run(ctx, env) {
    const { stage } = await getOrgStage(ctx);
    if (!BUILD_STAGES.includes(stage)) return [];
    const snapshot = await getIntakeSnapshot(ctx);
    const { required, optional } = stillNeeded(
      snapshot,
      addonIntakeFields(env.registry, snapshot.selections),
    );
    const item = (n: (typeof required)[number], opt: boolean): Tagged => ({
      key: `intake:${n.fieldId}`,
      kind: "intake.field",
      level: "normal",
      title: n.label,
      ...(opt ? { sub: n.ownerText ?? "", optional: true } : {}),
      actionLabel: "Add",
      href: n.href,
      section: "today",
      at: env.now,
      feature: "business",
      access: "write",
    });
    return [
      ...required.map((n) => item(n, false)),
      ...optional.map((n) => item(n, true)),
    ];
  },
};

const email: CoreProvider = {
  name: "email",
  feature: "business",
  access: "write",
  async run(ctx, env) {
    const routes = await listEmailRoutes(ctx);
    return routes
      .filter((r) => r.status !== "confirmed")
      .map((r) => {
        const bouncing = r.status === "bouncing";
        return {
          key: `email:${r.id}`,
          kind: bouncing ? "email.bouncing" : "email.confirm",
          level: bouncing ? "urgent" : "normal",
          title: bouncing
            ? `Email to ${r.address} is bouncing`
            : `Confirm ${r.address}`,
          actionLabel: bouncing ? "Fix email address" : "Confirm email address",
          href: "/hub/settings?tab=email",
          section: "settings",
          tab: "email",
          at: env.now,
          feature: "business",
          access: "write",
        };
      });
  },
};

/**
 * P12 support provider (12-24): CDS replies, tickets waiting on you, new CDS messages and
 * notes, the Owner's paid choices, held changes and org-wide planned work. Keys are
 * `support:...`; apps/web lib/bell.ts maps this provider's name to that prefix.
 */
const cds: CoreProvider = {
  name: "cds",
  feature: "support",
  access: "read",
  async run(ctx, env) {
    return supportNeedsYou(ctx, new Date(env.now), {
      addonName: (slug) => env.registry.get(slug)?.name,
    });
  },
};

/** P14 (14-29): the owner's domain step (connect, DNSSEC, forwarding, nameservers, ...). */
const domain: CoreProvider = {
  name: "domain",
  feature: "domain",
  access: "write",
  async run(ctx, env) {
    return (await domainNeedsYou(ctx, new Date(env.now))).map((i) => ({
      ...i,
      feature: "domain",
      access: "write" as const,
    }));
  },
};

/** P14 (14-39): "Move your DNS before you leave" while the handback is open (Owner). */
const leaving: CoreProvider = {
  name: "leaving",
  feature: "offboarding",
  access: "run",
  async run(ctx, env) {
    return (await leavingNeedsYou(ctx, new Date(env.now))).map((i) => ({
      ...i,
      feature: "offboarding",
      access: "run" as const,
    }));
  },
};

export const NEEDS_YOU_PROVIDERS: readonly CoreProvider[] = Object.freeze([
  inbox,
  billing,
  stripe,
  agreement,
  intake,
  email,
  cds,
  domain,
  leaving,
]);

function isText(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 500;
}

/** An add-on item is kept only when it is well formed and stays in its own lane. */
function addonItem(slug: string, raw: unknown): Tagged | null {
  if (typeof raw !== "object" || raw === null) return null;
  const i = raw as NeedsYouItem;
  if (!isText(i.key) || !i.key.startsWith(`${slug}:`)) return null;
  if (!isText(i.title) || !isText(i.actionLabel) || !isText(i.kind))
    return null;
  if (i.level !== "urgent" && i.level !== "normal") return null;
  // An add-on badges its own tab (or the Add-ons section), never a core section.
  if (i.section !== `addon:${slug}` && i.section !== "addons") return null;
  if (typeof i.at !== "string") return null;
  const out: Tagged = {
    key: i.key,
    kind: i.kind,
    level: i.level,
    title: i.title,
    actionLabel: i.actionLabel,
    href: i.href,
    section: i.section,
    at: i.at,
    feature: `addon:${slug}`,
    access: "read",
  };
  if (typeof i.sub === "string") out.sub = i.sub;
  if (i.optional === true) out.optional = true;
  if (typeof i.tab === "string") out.tab = i.tab;
  return out;
}

function strip(t: Tagged): NeedsYouItem {
  const item: NeedsYouItem & Partial<Grant> = { ...t };
  delete item.feature;
  delete item.access;
  return item;
}

/**
 * The person's Needs-you list: core and add-on items, grant-filtered, urgent first then
 * oldest. `failed` names each provider that threw (`inbox`, `addon:<slug>`, ...).
 */
export async function listNeedsYou(
  ctx: OrgContext,
  deps: NeedsYouDeps,
): Promise<NeedsYouResult> {
  assertOrgContext(ctx);
  // Viewers see numbers only (D310): no list, no reads.
  if (ctx.role === "viewer") return { items: [], failed: [] };
  const env: Env = {
    now: (deps.now ?? new Date()).toISOString(),
    registry: deps.registry,
  };

  const jobs: { name: string; run: () => Promise<Tagged[]> }[] = [];
  for (const p of NEEDS_YOU_PROVIDERS) {
    if (!can(ctx, p.feature, p.access)) continue;
    jobs.push({ name: p.name, run: () => p.run(ctx, env) });
  }
  for (const a of deps.today) {
    const fn = a.needsYou;
    if (typeof fn !== "function") continue;
    if (!can(ctx, `addon:${a.slug}`, "read")) continue;
    jobs.push({
      name: `addon:${a.slug}`,
      run: async () => {
        const raw: unknown = await fn(ctx);
        if (!Array.isArray(raw)) throw new TypeError("not an array");
        return raw
          .map((r) => addonItem(a.slug, r))
          .filter((r): r is Tagged => r !== null);
      },
    });
  }

  const settled = await Promise.allSettled(jobs.map((j) => j.run()));
  const failed: string[] = [];
  const merged: Tagged[] = [];
  settled.forEach((s, n) => {
    const name = jobs[n]!.name;
    if (s.status === "fulfilled") {
      merged.push(...s.value);
      return;
    }
    failed.push(name);
    const err: unknown = s.reason;
    console.error(
      `[needs-you] ${name} failed ${err instanceof Error ? err.name : typeof err}`,
    );
  });

  const seen = new Set<string>();
  const kept: NeedsYouItem[] = [];
  for (const t of merged) {
    if (seen.has(t.key)) continue;
    if (!isHubHref(t.href)) continue;
    if (!can(ctx, t.feature, t.access)) continue;
    seen.add(t.key);
    kept.push(strip(t));
  }
  return { items: sortNeedsYou(kept), failed };
}
