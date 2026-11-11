// From CDS (DASH-23): at most one card, priority pinned CDS note (12-29, COMM-02) > announcement > new add-on training (installed in
// the last 14 days) > tip (core list, rotating by week) > suggested add-on. Dismissed ids are
// skipped. Never adds to Needs you. Pure: the caller loads rows and the person's dismissed list.

export type FromCdsLink = { label: string; href: string };

export type FromCdsAnnouncement = {
  id: string;
  title: string;
  text: string;
  link?: FromCdsLink | null;
};

/** A pinned org CDS note (12-29; `pinnedNoteForFromCds`). Outranks the announcement. */
export type FromCdsNote = {
  id: string;
  title: string;
  text: string;
  created: string;
};

/** Where Read the note goes (Support > Messages). */
export const FROM_CDS_NOTE_HREF = "/hub/support?tab=messages";

export type FromCdsTraining = {
  slug: string;
  name: string;
  line: string;
  installedAt: string;
};

export type FromCdsTip = {
  id: string;
  title: string;
  line: string;
  link: FromCdsLink;
};

export type FromCdsSuggestion = { slug: string; name: string; summary: string };

export type FromCdsCard =
  | {
      kind: "note";
      id: string;
      title: string;
      text: string;
      link: FromCdsLink;
    }
  | {
      kind: "announcement";
      id: string;
      title: string;
      text: string;
      link: FromCdsLink | null;
    }
  | { kind: "training"; id: string; slug: string; title: string; text: string }
  | { kind: "tip"; id: string; title: string; text: string; link: FromCdsLink }
  | {
      kind: "addon";
      id: string;
      slug: string;
      title: string;
      text: string;
      href: string;
    };

export type PickFromCdsInput = {
  /** The org's pinned CDS note (people with support:read only; the caller decides). */
  note?: FromCdsNote | null;
  announcement?: FromCdsAnnouncement | null;
  recentAddonTraining?: readonly FromCdsTraining[] | null;
  tips?: readonly FromCdsTip[] | null;
  /** Path-eligible, not installed; the caller passes it only for Owners (UI-SPEC § 8). */
  suggestedAddon?: FromCdsSuggestion | null;
  /** Card ids the person dismissed (`note:<id>`, `announcement:<id>`, `training:<slug>`, `tip:<id>`, `addon:<slug>`). */
  dismissed: readonly string[];
  now: Date;
};

export const TRAINING_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

/** Plain tips (D119 tone): one small thing that makes the owner's job easier. */
export const CORE_TIPS: readonly FromCdsTip[] = Object.freeze([
  {
    id: "reply-fast",
    title: "Reply to new messages within a day",
    line: "People who hear back the same day are far more likely to book. Your Inbox shows what is waiting.",
    link: { label: "Open Inbox", href: "/hub/inbox" },
  },
  {
    id: "fresh-photos",
    title: "Swap in a fresh photo",
    line: "A recent photo of your work makes your home page feel current. Upload it once and use it anywhere.",
    link: { label: "Open Media", href: "/hub/media" },
  },
  {
    id: "edit-a-page",
    title: "You can change any page yourself",
    line: "Add, move or remove blocks on any page. Your colors and fonts stay on brand.",
    link: { label: "Open Website", href: "/hub/website" },
  },
  {
    id: "bio-links",
    title: "Put your site in your bio",
    line: "Add your website link to Instagram, Facebook and the rest so new visitors can find you.",
    link: { label: "Open Marketing", href: "/hub/marketing" },
  },
  {
    id: "check-hours",
    title: "Keep your hours up to date",
    line: "Holiday hours or a new day off? Update them once and your site shows them everywhere.",
    link: { label: "Open Settings", href: "/hub/settings" },
  },
  {
    id: "weekly-numbers",
    title: "Glance at your numbers once a week",
    line: "Reports shows visitors and messages compared with last week, in plain words.",
    link: { label: "Open Reports", href: "/hub/reports" },
  },
  {
    id: "phone-alerts",
    title: "Get alerts on your phone",
    line: "Choose which alerts reach you, and set quiet hours so nothing buzzes at night.",
    link: { label: "Open your profile", href: "/hub/profile" },
  },
  {
    id: "invite-help",
    title: "Invite someone to help",
    line: "Give a team member their own login, with only the access they need.",
    link: { label: "Open People & roles", href: "/hub/settings?tab=people" },
  },
]);

/** Monday-start week index since the epoch (1970-01-01 was a Thursday). Deterministic. */
function weekIndex(now: Date): number {
  const days = Math.floor(now.getTime() / DAY_MS);
  return Math.floor((days + 3) / 7);
}

export function pickFromCds(input: PickFromCdsInput): FromCdsCard | null {
  const dismissed = new Set(input.dismissed);
  const nowMs = input.now.getTime();

  // Dismissing hides the card, never the note itself (UI-SPEC "From CDS card").
  const n = input.note;
  if (n && !dismissed.has(`note:${n.id}`)) {
    return {
      kind: "note",
      id: `note:${n.id}`,
      title: n.title,
      text: n.text,
      link: { label: "Read the note", href: FROM_CDS_NOTE_HREF },
    };
  }

  const a = input.announcement;
  if (a && !dismissed.has(`announcement:${a.id}`)) {
    return {
      kind: "announcement",
      id: `announcement:${a.id}`,
      title: a.title,
      text: a.text,
      link: a.link ?? null,
    };
  }

  const recent = (input.recentAddonTraining ?? [])
    .map((t) => ({ t, ms: Date.parse(t.installedAt) }))
    .filter(
      ({ t, ms }) =>
        !Number.isNaN(ms) &&
        ms <= nowMs &&
        nowMs - ms <= TRAINING_WINDOW_DAYS * DAY_MS &&
        !dismissed.has(`training:${t.slug}`),
    )
    .sort((x, y) => y.ms - x.ms);
  const t = recent[0]?.t;
  if (t) {
    return {
      kind: "training",
      id: `training:${t.slug}`,
      slug: t.slug,
      title: `Getting started with ${t.name}`,
      text: t.line,
    };
  }

  const tips = input.tips ?? [];
  if (tips.length > 0) {
    const start = weekIndex(input.now) % tips.length;
    for (let i = 0; i < tips.length; i++) {
      const tip = tips[(start + i) % tips.length]!;
      if (!dismissed.has(`tip:${tip.id}`)) {
        return {
          kind: "tip",
          id: `tip:${tip.id}`,
          title: tip.title,
          text: tip.line,
          link: tip.link,
        };
      }
    }
  }

  const s = input.suggestedAddon;
  if (s && !dismissed.has(`addon:${s.slug}`)) {
    return {
      kind: "addon",
      id: `addon:${s.slug}`,
      slug: s.slug,
      title: s.name,
      text: s.summary,
      href: `/hub/add-ons/${encodeURIComponent(s.slug)}`,
    };
  }

  return null;
}
