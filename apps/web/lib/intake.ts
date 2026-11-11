// Setup (intake) helpers for the hub (06-18; ONB-01, ONB-02, ONB-03; T-06-88).
// PROFILE_KEYS / ANSWER_KEYS are the only keys the intake actions forward: every other key
// in an action payload is dropped before the chokepoint (which validates again).
// loadStageData (server-only) reads everything the setup overview and a step need; for the
// words and people steps it also reads the services / team lists (06-20), for the email step
// the email routes and the platform mail domain (06-22; mailDomain() is server-only, so the
// page hands it to the client preview).
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { can } from "@cds/core";
import type { AddonIntakeField, AddonManifest } from "@cds/core/addons";
import {
  STAGES,
  addonIntakeFields,
  setupProgress,
  stageStatus,
  stillNeeded,
  type BusinessProfileValues,
  type IntakeAnswers,
  type IntakeSnapshot,
  type NeededItem,
  type PriceDisplay,
  type StageSlug,
} from "@cds/core/intake";
import {
  CDS_CHOOSE_PAIRING_ID,
  findPairing,
  type MoodboardProposal,
} from "@cds/core/theme";
import type { MediaAssetView } from "@cds/ui/hub";
import {
  getBusinessProfile,
  getIntakeSnapshot,
  getOrgIntake,
  getOrgStage,
  getSitePreviewUrl,
  getSendingView,
  listEmailRoutes,
  listMedia,
  mailDomain,
  listServices,
  listTeam,
  readCheckoutState,
  type AddonIntakeConfig,
  type BusinessProfile,
  type EmailRoute,
  type MediaAsset,
  type OrgContext,
  type OrgStage,
  type Service,
  type TeamMember,
} from "@cds/db";
import { getAgreementStatus } from "./agreement-gate";
import {
  AGREEMENT_STAGES,
  agreementSetupItem,
  type AgreementSetupItem,
} from "./agreement-setup";
import {
  CHECKOUT_STAGES,
  checkoutSetupItem,
  type CheckoutSetupItem,
} from "./checkout-setup";

type Exhaustive<K extends string, L extends readonly string[]> =
  Exclude<K, L[number]> extends never ? L : never;

const PROFILE_LIST = [
  "tagline",
  "business_type",
  "business_type_other",
  "description",
  "phone",
  "public_email",
  "address",
  "service_area",
  "time_zone",
  "hours",
  // 11-35: an intake answer; the chokepoint stores it in social_accounts, not business_profile.
  "socials",
  "about",
  "mission",
  "headline",
  "font_pairing",
  "ga4_id",
  "legal_name",
  "privacy_contact",
  "legal_region",
] as const satisfies readonly (keyof BusinessProfileValues)[];

const ANSWER_LIST = [
  "domain_choice",
  "domain",
  "registrar",
  "domain_ideas",
  "gbp",
] as const satisfies readonly (keyof IntakeAnswers)[];

/** Business profile keys plus org_name (which renames the organization). */
export const PROFILE_KEYS: readonly string[] = Object.freeze([
  ...(PROFILE_LIST satisfies Exhaustive<
    keyof BusinessProfileValues,
    typeof PROFILE_LIST
  >),
  "org_name",
]);

export const ANSWER_KEYS: readonly string[] = Object.freeze([
  ...(ANSWER_LIST satisfies Exhaustive<
    keyof IntakeAnswers,
    typeof ANSWER_LIST
  >),
]);

/** Own, allow-listed keys only; anything else in the payload is dropped. */
export function pickKeys(
  raw: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  for (const k of keys) if (Object.hasOwn(o, k)) out[k] = o[k];
  return out;
}

// loadStageData: everything the setup overview and a step need, in one call. Reads through
// the @cds/db chokepoint (business read), never an org id from input. Plain data, safe to
// hand to client islands.

export type StageRow = {
  slug: StageSlug;
  name: string;
  href: string;
  status: "not_started" | "started" | "done";
  required: number;
  optional: number;
  summary: string;
};

/** A team member as the Team list and drawer see it (06-20). */
export type TeamMemberView = {
  id: string;
  name: string;
  role: string;
  bio: string;
  is_published: boolean;
  photo: MediaAssetView | null;
};

/** A service as the Services list and drawer see it (06-20). */
export type ServiceView = {
  id: string;
  name: string;
  description: string;
  price_display: PriceDisplay;
  price_cents: number | null;
  duration_minutes: number | null;
  is_published: boolean;
};

/** An email route as "Where should your email go?" sees it (06-22; never the confirm hash). */
export type EmailRouteView = {
  id: string;
  purpose: "default" | "inquiries" | "newsletter" | "billing" | "account";
  address: string;
  senderName: string;
  status: "waiting" | "confirmed" | "bouncing";
  /** A new default address waiting for its confirmation; the confirmed one still works. */
  pendingDefault: boolean;
};

/** The email routing data a page hands to the client component (06-22). */
export type EmailRoutingData = {
  routes: EmailRouteView[];
  /** The platform mail domain (server-only env), for the From preview. */
  mailDomain: string;
  /** organizations.slug, the <slug>@ of the From preview. */
  slug: string;
  /** P14 (14-25): own-domain sending state for the "Sending from your domain" row (absent = none). */
  sending?: {
    state: "none" | "pending" | "verified" | "failed";
    domain: string;
    localPart: string;
    /** Owner only (domain write) may change the local part. */
    canEdit: boolean;
  };
};

/** One column of an add-on's spreadsheet, as a field of "Add one by one". */
export type ProofColumn = {
  key: string;
  label: string;
  example: string;
  required: boolean;
};

/** A picked add-on's proof section in "People & proof" (CONTEXT A3-Q5; plain data). */
export type AddonProofView = {
  slug: string;
  name: string;
  /** "Paste or import your testimonials" */
  label: string;
  /** "Add one by one" */
  addOneLabel: string;
  singular: string;
  plural: string;
  fields: AddonIntakeField[];
  fieldValues: Record<string, string | boolean>;
  columns: ProofColumn[];
  /**
   * Held rows, each column formatted as the spreadsheet writes it. `key` is the row's stable
   * key: edit and remove address it, never the position (B-WR-08).
   */
  records: { key: string; title: string; values: Record<string, string> }[];
  csvEnabled: boolean;
};

/** A proof add-on the owner didn't pick (a link to its detail page, D-UI-P6-18). */
export type ProofOffer = { slug: string; name: string };

export type StageData = {
  stage: OrgStage;
  profile: BusinessProfile;
  answers: IntakeAnswers;
  firstVisitDismissed: boolean;
  /** ISO time of the last Send to CDS, or null. */
  submittedAt: string | null;
  snapshot: IntakeSnapshot;
  /** Active setup photos (every kind, display order), for the upload fields. */
  media: MediaAssetView[];
  needed: { required: NeededItem[]; optional: NeededItem[] };
  stages: StageRow[];
  progress: { done: number; total: 7 };
  /** Owner or Admin (business write); an Editor sees every step read-only. */
  canEdit: boolean;
  isOwner: boolean;
  impersonating: boolean;
  /** Picked add-ons with an intake contribution, in registry order. */
  proof: AddonProofView[];
  /** Public proof add-ons on the org's path that weren't picked. */
  proofOffers: ProofOffer[];
  /** The stored mood board proposal (org_intake.moodboard_proposal), preview only (D47). */
  moodboardProposal: MoodboardProposal | null;
  /**
   * The preview address for "See your site's preview" (08-09, CONTEXT A2-Q5). Loaded only at
   * stage being_built; null otherwise or when it can't be read (the line then shows no link).
   */
  previewUrl: string | null;
  /**
   * The agreement item for the "What's still needed" panel (09-19, CONTEXT A2-Q5): null
   * before Send to CDS or when the status can't be read (the panel then shows nothing).
   */
  agreement: AgreementSetupItem;
  /**
   * "Pay and start your build" (10-22): null before Send to CDS, once closed, or when the
   * checkout state can't be read.
   */
  checkout: CheckoutSetupItem;
  /** Loaded for the words step (and Website › Services). */
  services?: ServiceView[];
  /** Loaded for the people step (and Settings › Team & hours). */
  team?: TeamMemberView[];
  /** Loaded for the email step (and Settings › Email). */
  email?: EmailRoutingData;
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** "Rivera Bakery · logo added · Clean and modern" (06-UI-SPEC stage list rows). */
export function stageSummary(slug: StageSlug, s: IntakeSnapshot): string {
  if (!s.stagesSaved.includes(slug)) return "Not started";
  const p = s.profile;
  const parts: string[] = [];
  switch (slug) {
    case "business": {
      if (s.orgName.trim()) parts.push(s.orgName.trim());
      if (s.media.logo) parts.push("logo added");
      const pairing = findPairing(p.font_pairing);
      if (
        p.font_pairing &&
        p.font_pairing !== CDS_CHOOSE_PAIRING_ID &&
        pairing.id === p.font_pairing
      ) {
        parts.push(pairing.label);
      }
      break;
    }
    case "contact":
      if (p.phone) parts.push(p.phone);
      if (p.public_email) parts.push(p.public_email);
      if (p.hours) parts.push("hours added");
      break;
    case "email":
      parts.push(
        s.email.defaultConfirmed
          ? "Main address confirmed"
          : "Main address not confirmed yet",
      );
      if (s.email.bouncing > 0) parts.push(`${s.email.bouncing} bouncing`);
      break;
    case "words":
      if (p.about.trim()) parts.push("About written");
      if (p.headline.trim()) parts.push("headline added");
      if (s.counts.services > 0) {
        parts.push(plural(s.counts.services, "service", "services"));
      }
      break;
    case "people":
      if (s.counts.team > 0) {
        parts.push(plural(s.counts.team, "team member", "team members"));
      }
      break;
    case "look":
      if (s.media.hero) parts.push("main photo added");
      if (s.counts.gallery > 0) {
        parts.push(plural(s.counts.gallery, "photo", "photos"));
      }
      if (s.counts.moodboard > 0) parts.push("mood board added");
      break;
    case "the-rest": {
      const a = s.answers;
      if (a.domain_choice === "have") parts.push(a.domain || "Own domain");
      else if (a.domain_choice === "need") parts.push("Needs a domain");
      else parts.push("Domain later");
      if (p.ga4_id) parts.push("Analytics added");
      break;
    }
  }
  return parts.length > 0 ? parts.join(" · ") : "Nothing added yet";
}

/** A chokepoint MediaAsset -> the upload field's view (thumbnail from the private route). */
export function mediaView(a: MediaAsset): MediaAssetView {
  return {
    id: a.id,
    kind: a.kind,
    width: a.width,
    height: a.height,
    webWidth: a.webWidth,
    bytes: a.bytes,
    alt: a.alt,
    thumbUrl: `/hub/media/${a.id}/thumb`,
  };
}

export function teamMemberView(
  m: TeamMember,
  media: readonly MediaAssetView[],
): TeamMemberView {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    bio: m.bio,
    is_published: m.is_published,
    photo: m.photoId ? (media.find((x) => x.id === m.photoId) ?? null) : null,
  };
}

export function emailRouteView(r: EmailRoute): EmailRouteView {
  return {
    id: r.id,
    purpose: r.purpose,
    address: r.address,
    senderName: r.senderName,
    status: r.status,
    pendingDefault: r.pendingDefault,
  };
}

/** 14-25: the own-domain sending state; any read failure only shows the "none" row. */
async function readSending(
  ctx: OrgContext,
): Promise<Omit<NonNullable<EmailRoutingData["sending"]>, "canEdit">> {
  try {
    return await getSendingView(ctx);
  } catch {
    return { state: "none", domain: "", localPart: "hello" };
  }
}

/** Routes, mail domain and slug for the routing component (business read). */
export async function loadEmailRouting(
  ctx: OrgContext,
  slug?: string,
): Promise<EmailRoutingData> {
  const [routes, org, sending] = await Promise.all([
    listEmailRoutes(ctx),
    slug === undefined ? getOrgStage(ctx) : Promise.resolve({ slug }),
    readSending(ctx),
  ]);
  return {
    routes: routes.map(emailRouteView),
    mailDomain: mailDomain(),
    slug: org.slug ?? "",
    sending: { ...sending, canEdit: can(ctx, "domain", "write") },
  };
}

export function serviceView(s: Service): ServiceView {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    price_display: s.price_display,
    price_cents: s.price_cents,
    duration_minutes: s.duration_minutes,
    is_published: s.is_published,
  };
}

function csvOf(m: AddonManifest) {
  const rec = m.intake?.records;
  if (!rec || !m.csv) return null;
  const key = rec.csv ?? rec.collection;
  return Object.hasOwn(m.csv, key) ? m.csv[key]! : null;
}

/** The proof sections of the picked add-ons, and the proof add-ons not picked. */
export function proofOf(
  selections: readonly string[],
  config: AddonIntakeConfig,
  path: IntakeSnapshot["path"],
): { proof: AddonProofView[]; proofOffers: ProofOffer[] } {
  const proof: AddonProofView[] = [];
  const proofOffers: ProofOffer[] = [];
  for (const m of ADDON_REGISTRY.list()) {
    const intake = m.intake;
    if (!intake) continue;
    if (!selections.includes(m.slug)) {
      if (
        m.visibility === "public" &&
        (path === "" || m.paths.includes(path))
      ) {
        proofOffers.push({ slug: m.slug, name: m.name });
      }
      continue;
    }
    const held = Object.hasOwn(config, m.slug) ? config[m.slug]! : null;
    const rec = intake.records;
    const spec = rec ? m.records[rec.collection] : undefined;
    const csv = csvOf(m);
    const fieldValues: Record<string, string | boolean> = {};
    for (const f of intake.fields ?? []) {
      const v = held?.fields[f.id];
      fieldValues[f.id] =
        f.kind === "switch" ? v === true : typeof v === "string" ? v : "";
    }
    const columns: ProofColumn[] = csv
      ? csv.columns.map((c) => ({
          key: c.key,
          label: c.label,
          example: c.example,
          required: c.required,
        }))
      : [];
    proof.push({
      slug: m.slug,
      name: m.name,
      label: rec?.label ?? "",
      addOneLabel: rec?.addOneLabel ?? "",
      singular: spec?.singular ?? csv?.singular ?? "item",
      plural: spec?.plural ?? csv?.plural ?? "items",
      fields: [...(intake.fields ?? [])],
      fieldValues,
      columns,
      records: (held?.records ?? []).map((r, i) => {
        const values: Record<string, string> = {};
        if (csv)
          for (const c of csv.columns) values[c.key] = c.format(r[c.key]);
        let title = "";
        try {
          title = spec ? spec.title(r) : "";
        } catch {
          title = "";
        }
        return { key: held?.keys?.[i] ?? `r${i}`, title, values };
      }),
      csvEnabled: Boolean(rec && spec && csv),
    });
  }
  return { proof, proofOffers };
}

/**
 * The agreement Setup item (09-19). Read only from ready_for_build onward; a failed status
 * read is logged and shows nothing, so the setup screen still opens (T-09-19-02).
 */
async function loadAgreementItem(
  ctx: OrgContext,
  stage: OrgStage,
  timeZone: string,
): Promise<AgreementSetupItem> {
  const role = ctx.role;
  const impersonating = Boolean(ctx.impersonator);
  // Before Send to CDS there is nothing to read.
  if (!AGREEMENT_STAGES.includes(stage)) return null;
  try {
    const status = await getAgreementStatus(ctx);
    return agreementSetupItem(stage, status, role, impersonating, timeZone);
  } catch (err) {
    console.error(
      "[setup] agreement status failed",
      err instanceof Error ? err.name : typeof err,
    );
    return null;
  }
}

/**
 * The checkout Setup item (10-22). Read only from Send to CDS onward; a failed read is logged
 * and shows nothing, so the setup screen still opens.
 */
async function loadCheckoutItem(
  ctx: OrgContext,
  stage: OrgStage,
  agreement: AgreementSetupItem,
  timeZone: string,
): Promise<CheckoutSetupItem> {
  // Editors and Viewers have no billing surface: nothing to read or show.
  if (!CHECKOUT_STAGES.includes(stage) || !can(ctx, "addons", "read")) {
    return null;
  }
  try {
    const checkout = await readCheckoutState(ctx);
    return checkoutSetupItem({
      stage,
      agreement,
      checkout,
      role: ctx.role,
      impersonating: Boolean(ctx.impersonator),
      timeZone,
    });
  } catch (err) {
    console.error(
      "[setup] checkout state failed",
      err instanceof Error ? err.name : typeof err,
    );
    return null;
  }
}

export async function loadStageData(
  ctx: OrgContext,
  step?: StageSlug,
): Promise<StageData> {
  const [org, profile, intake, snapshot, media] = await Promise.all([
    getOrgStage(ctx),
    getBusinessProfile(ctx),
    getOrgIntake(ctx),
    getIntakeSnapshot(ctx),
    listMedia(ctx),
  ]);
  const [services, team, email, previewUrl, agreement] = await Promise.all([
    step === "words" ? listServices(ctx) : Promise.resolve(null),
    step === "people" ? listTeam(ctx) : Promise.resolve(null),
    step === "email"
      ? loadEmailRouting(ctx, org.slug ?? "")
      : Promise.resolve(null),
    org.stage === "being_built"
      ? getSitePreviewUrl(ctx)
      : Promise.resolve(null),
    loadAgreementItem(ctx, org.stage, profile.time_zone),
  ]);
  const checkout = await loadCheckoutItem(
    ctx,
    org.stage,
    agreement,
    profile.time_zone,
  );
  const mediaViews = media.map(mediaView);
  const extra = addonIntakeFields(ADDON_REGISTRY, snapshot.selections);
  const needed = stillNeeded(snapshot, extra);
  const stages: StageRow[] = STAGES.map((st) => {
    const status = stageStatus(snapshot, st.slug, extra);
    return {
      slug: st.slug,
      name: st.name,
      href: `/hub/setup/${st.slug}`,
      status: status.status,
      required: status.required,
      optional: status.optional,
      summary: stageSummary(st.slug, snapshot),
    };
  });
  return {
    stage: org.stage,
    profile,
    answers: intake.answers,
    firstVisitDismissed: intake.firstVisitDismissed,
    submittedAt: intake.submittedAt ? intake.submittedAt.toISOString() : null,
    snapshot,
    media: mediaViews,
    needed,
    stages,
    progress: setupProgress(snapshot, extra),
    canEdit: can(ctx, "business", "write"),
    isOwner: ctx.role === "owner",
    impersonating: Boolean(ctx.impersonator),
    moodboardProposal: intake.moodboardProposal ?? null,
    previewUrl,
    agreement,
    checkout,
    ...proofOf(
      snapshot.selections.addons,
      intake.addonConfig ?? {},
      snapshot.path,
    ),
    ...(services ? { services: services.map(serviceView) } : {}),
    ...(team ? { team: team.map((m) => teamMemberView(m, mediaViews)) } : {}),
    ...(email ? { email } : {}),
  };
}
