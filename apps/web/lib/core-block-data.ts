// Live core block data for the tenant site and the builder preview (07-07; Finding 4, D253,
// D156 isolation; T-07-07-05, T-07-07-08).
//
// Core blocks that show org data read it here, page-wide, and PageRenderer passes it to
// every section as `coreData` (add-on data stays `boundData`, addon-site.ts):
//   - business: the org's public business projection (name, phone, public email, address,
//     time zone, hours, socials) for the hours, social and map blocks. Read only when the
//     page has one of those blocks.
//   - loadCoreBlockData: visitor path, SiteContext, cached 60 s (site-cache getPublicBusiness).
//   - previewCoreBlockData: builder preview, OrgContext, through getBusinessProfile and the
//     same projection, so preview shows what the site will show. A member without the read
//     grant sees the blocks without business data rather than an error.
// 07-12 adds the media resolver and 07-19 the form loader to this file; each source is
// loaded in its own try/catch so one failure never blanks the page.
//   - media (07-12; CONT-33, choice 16): the ids every section's refsOf(...).media names, plus
//     the items of every live pop-up, resolved to ResolvedMedia. Visitor path through
//     resolvePublicMedia (tokens when unpromoted or protected), preview through
//     resolveHubMedia. Resolved per request: the media slice is never put in unstable_cache.
//   - forms (07-19; CONT-25, choice 6): the ids every section's refsOf(...).forms names, plus
//     every live pop-up's form items, read through readPublicForms (held forms omitted,
//     soft-deleted kept) and stamped as FormView { form, pageId, status, preview }. The no-JS
//     status (parseFormStatus) lands only on the matching form. Preview reads getForm per id
//     and projects it with publicFormOf (preview: true, sending off).
//     10-40 (BILL-14, D233; choice 3): a `?resume=<token>` link pre-fills the matching Builder
//     Pro form server-side (resumeFormDraft, scoped to this org and form; the token's shape is
//     checked by parseFormResume first) and marks it `resumed`; when no save-later form on the
//     page knows the token, each of them shows the expired notice over an empty form.
//   - mapKey / share (07-24; CONT-24, CONT-27; choices 1, 5): a page with a map section gets
//     the validated Maps Embed browser key from getMapEmbed() (absent = keyless stand-in);
//     a page whose social section shows share buttons gets the page { url, title } from
//     opts.page. The preview never sets share (share buttons render inert there).
//   - services / team (P8, 08-08; TMPL-02, D253, RESEARCH Pitfall 9): a page with a Services
//     block gets coreData.services, one with an Our team block coreData.team; published rows
//     only, in owner order, read per request (live). Visitor path: readPublicServices /
//     readPublicTeam (SiteContext); team photos resolve through resolvePublicMedia (deleted or
//     unresolved = no photo, so the initials tile shows). Preview: listPublishedServices /
//     listPublishedTeam with the member's OrgContext (content read, so a Viewer sees the
//     same published rows, WR-C02), photos through resolveHubMedia,
//     and sets editorPreview (empty data-bound blocks show the editor-only card there only).
// Every lookup into section data is an own-property lookup; malformed sections are ignored.
import { Forbidden, NotFound } from "@cds/core";
import {
  itemRefs,
  unionRefs,
  type ColumnItem,
  type SectionRefs,
} from "@cds/core/content";
import {
  getBusinessProfile,
  getForm,
  getMapEmbed,
  listPublishedServices,
  listPublishedTeam,
  readPublicForms,
  readPublicServices,
  readPublicTeam,
  projectPublicBusiness,
  resumeFormDraft,
  resolveHubMedia,
  resolvePublicMedia,
  type OrgContext,
  type PublicBusiness,
  type SiteContext,
} from "@cds/db";
import {
  publicFormOf,
  type CoreBoundData,
  type FormStatusView,
  type FormView,
  type ResolvedMedia,
} from "@cds/ui/site";
import { SECTION_REGISTRY } from "./section-registry";
import { getLiveSite, getPublicBusiness } from "./site-cache";

type SectionLike = {
  id: string;
  section_type: string;
  content: unknown;
};

/** Core section types whose renderers read coreData.business. */
export const BUSINESS_BOUND_TYPES: readonly string[] = Object.freeze([
  "hours",
  "social",
  "map",
]);

const hasOwn = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

function needsBusiness(sections: readonly SectionLike[]): boolean {
  return someSection(sections, (type) => BUSINESS_BOUND_TYPES.includes(type));
}

/** The 08-05 block row shapes (CoreBoundData slices; the ui barrel exports only the parent). */
type PublicService = NonNullable<CoreBoundData["services"]>[number];
type PublicTeamMember = NonNullable<CoreBoundData["team"]>[number];

/** P8 (08-08): section types whose renderers read coreData.services. */
export const SERVICES_TYPES: readonly string[] = Object.freeze(["services"]);

/** P8 (08-08): section types whose renderers read coreData.team. */
export const TEAM_TYPES: readonly string[] = Object.freeze(["team"]);

function needsServices(sections: readonly SectionLike[]): boolean {
  return someSection(sections, (type) => SERVICES_TYPES.includes(type));
}

function needsTeam(sections: readonly SectionLike[]): boolean {
  return someSection(sections, (type) => TEAM_TYPES.includes(type));
}

const PRICE_TYPES: readonly string[] = ["fixed", "from", "free", "ask"];

/** 08-08 choice 1: price_display as the block's price_type; anything else reads "ask". */
function priceType(v: unknown): PublicService["price_type"] {
  return typeof v === "string" && PRICE_TYPES.includes(v)
    ? (v as PublicService["price_type"])
    : "ask";
}

type ServiceRow = {
  id: string;
  name: string;
  description: string;
  price_display: unknown;
  price_cents: number | null;
  duration_minutes: number | null;
};

function toBlockService(r: ServiceRow): PublicService {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    price_type: priceType(r.price_display),
    price_cents: r.price_cents,
    duration_minutes: r.duration_minutes,
  };
}

type MemberRow = {
  id: string;
  name: string;
  role: string;
  bio: string;
  photoId: string;
};

/** Photo ids of the members, once each, in order. */
function photoIdsOf(rows: readonly MemberRow[]): string[] {
  return [...new Set(rows.map((r) => r.photoId).filter((id) => id !== ""))];
}

/** 08-08 choice 2: an unresolved, deleted or src-less photo is omitted (initials tile). */
function toBlockTeam(
  rows: readonly MemberRow[],
  photos: Readonly<Record<string, ResolvedMedia>>,
): PublicTeamMember[] {
  return rows.map((r) => {
    const m =
      r.photoId !== "" && hasOwn(photos, r.photoId)
        ? photos[r.photoId]
        : undefined;
    const usable =
      m !== undefined &&
      m.kind === "image" &&
      m.deleted !== true &&
      m.src !== "";
    return {
      id: r.id,
      name: r.name,
      role: r.role,
      bio: r.bio,
      ...(usable ? { photo: m } : {}),
    };
  });
}

const MAP_TYPE = "map";
const SOCIAL_TYPE = "social";

/** Own-property-safe walk: does some section of a type match (content optional)? */
function someSection(
  sections: readonly SectionLike[],
  test: (type: string, content: unknown) => boolean,
): boolean {
  if (!Array.isArray(sections)) return false;
  for (const s of sections as readonly unknown[]) {
    if (typeof s !== "object" || s === null || !hasOwn(s, "section_type")) {
      continue;
    }
    const type = (s as { section_type: unknown }).section_type;
    const content = hasOwn(s, "content")
      ? (s as { content: unknown }).content
      : undefined;
    if (typeof type === "string" && test(type, content)) return true;
  }
  return false;
}

/** The validated Maps Embed key when the page has a map section (07-24, choice 1). */
function mapKeyFor(sections: readonly SectionLike[]): string | undefined {
  if (!someSection(sections, (type) => type === MAP_TYPE)) return undefined;
  try {
    return getMapEmbed().frameKey;
  } catch (err) {
    console.error("[site] core block data failed", "map", err);
    return undefined;
  }
}

/** Share data when some social section shows share buttons (07-24, choice 5). */
function shareFor(
  sections: readonly SectionLike[],
  page: PageOpts | undefined,
): PageOpts | undefined {
  if (!page || typeof page.url !== "string" || page.url === "")
    return undefined;
  const sharing = someSection(
    sections,
    (type, content) =>
      type === SOCIAL_TYPE &&
      typeof content === "object" &&
      content !== null &&
      hasOwn(content, "show_share") &&
      (content as { show_share: unknown }).show_share === true,
  );
  return sharing
    ? { url: page.url, title: typeof page.title === "string" ? page.title : "" }
    : undefined;
}

/** 07-24: the page member of the loader opts (absolute URL + title for share buttons). */
export type PageOpts = { url: string; title: string };

function withExtras(
  out: CoreBoundData,
  mapKey: string | undefined,
  share: PageOpts | undefined,
): CoreBoundData {
  if (mapKey) out.mapKey = mapKey;
  if (share) out.share = share;
  return out;
}

type MediaMap = Record<string, ResolvedMedia>;
type FormMap = Record<string, FormView>;

/** 07-19: the forms member of the loader opts (choice 6; separate from media's pageId). */
export type FormsOpts = {
  pageId: string | null;
  status: { formId: string; status: FormStatusView } | null;
  /** 10-40: a shape-checked resume token from `?resume=` (parseFormResume), or null. */
  resume?: string | null;
};

function result(
  business: PublicBusiness | null,
  media: MediaMap = {},
  forms: FormMap | null = null,
  services: PublicService[] | null = null,
  team: PublicTeamMember[] | null = null,
): CoreBoundData {
  const out: CoreBoundData = business ? { business, media } : { media };
  if (forms && Object.keys(forms).length > 0) out.forms = forms;
  if (services) out.services = services;
  if (team) out.team = team;
  return out;
}

/** Media ids of the sections (registry refsOf) plus every live pop-up's items. */
export function mediaIdsFor(
  sections: readonly SectionLike[],
  popups: readonly { content: unknown }[] = [],
): string[] {
  return refsFor(sections, popups).media;
}

/** Form ids of the sections plus every live pop-up's form items (07-19). */
export function formIdsFor(
  sections: readonly SectionLike[],
  popups: readonly { content: unknown }[] = [],
): string[] {
  return refsFor(sections, popups).forms;
}

function refsFor(
  sections: readonly SectionLike[],
  popups: readonly { content: unknown }[],
): SectionRefs {
  const refs: SectionRefs[] = [];
  if (Array.isArray(sections)) {
    for (const s of sections as readonly unknown[]) {
      if (typeof s !== "object" || s === null) continue;
      if (!hasOwn(s, "section_type") || !hasOwn(s, "content")) continue;
      const { section_type: type, content } = s as {
        section_type: unknown;
        content: unknown;
      };
      if (typeof type !== "string") continue;
      const def = SECTION_REGISTRY.get(type);
      if (!def) continue;
      try {
        refs.push(def.refsOf(content));
      } catch {
        // A malformed section contributes nothing.
      }
    }
  }
  for (const p of popups) {
    if (typeof p !== "object" || p === null || !hasOwn(p, "content")) continue;
    // Pop-up content is { items } (not columns): the same item walker the pop-up writer uses.
    const content = p.content as { items?: unknown };
    const items =
      typeof content === "object" &&
      content !== null &&
      hasOwn(content, "items")
        ? content.items
        : null;
    if (!Array.isArray(items)) continue;
    for (const item of items as unknown[]) {
      if (typeof item === "object" && item !== null) {
        refs.push(itemRefs(item as ColumnItem));
      }
    }
  }
  return unionRefs(refs);
}

/** Visitor path: page-wide core data for the published page (D253). */
export async function loadCoreBlockData(
  site: SiteContext,
  sections: readonly SectionLike[],
  opts: {
    pageId?: string;
    protectedPage?: boolean;
    forms?: FormsOpts;
    page?: PageOpts;
  } = {},
): Promise<CoreBoundData> {
  const popupsP = livePopups(site);
  const [business, media, forms, services, team] = await Promise.all([
    visitorBusiness(site, sections),
    visitorMedia(site, sections, opts, popupsP),
    visitorForms(site, sections, opts.forms ?? null, popupsP),
    visitorServices(site, sections),
    visitorTeam(site, sections, opts),
  ]);
  return withExtras(
    result(business, media, forms, services, team),
    mapKeyFor(sections),
    shareFor(sections, opts.page),
  );
}

async function livePopups(
  site: SiteContext,
): Promise<readonly { content: unknown }[]> {
  try {
    return (await getLiveSite(site)).popups;
  } catch (err) {
    console.error("[site] core block data failed", "popups", err);
    return [];
  }
}

async function visitorForms(
  site: SiteContext,
  sections: readonly SectionLike[],
  opts: FormsOpts | null,
  popupsP: Promise<readonly { content: unknown }[]>,
): Promise<FormMap | null> {
  try {
    const ids = formIdsFor(sections, await popupsP);
    if (ids.length === 0) return null;
    const read = await readPublicForms(site, ids);
    const out: FormMap = {};
    for (const id of Object.keys(read)) {
      const form = read[id];
      if (!form) continue;
      out[id] = {
        form,
        pageId: opts?.pageId ?? null,
        status: opts?.status?.formId === id ? opts.status.status : null,
        preview: false,
      };
    }
    if (opts?.resume) await applyResume(site, out, opts.resume);
    return out;
  } catch (err) {
    console.error("[site] core form data failed", err);
    return null;
  }
}

/** 10-40: pre-fill the form a resume token belongs to, or mark save-later forms expired. */
async function applyResume(
  site: SiteContext,
  forms: FormMap,
  token: string,
): Promise<void> {
  const ids = Object.keys(forms).filter(
    (id) => forms[id]?.form.pro?.save_resume === true,
  );
  if (ids.length === 0) return;
  let found = false;
  for (const id of ids) {
    let draft: Awaited<ReturnType<typeof resumeFormDraft>> = null;
    try {
      draft = await resumeFormDraft(site, id, token);
    } catch (err) {
      // Never the token: the error class only.
      console.error(
        "[site] form resume failed",
        err instanceof Error ? err.name : "unknown",
      );
    }
    if (!draft) continue;
    found = true;
    forms[id] = {
      ...forms[id]!,
      values: draft.answers,
      resume: { kind: "resumed", token },
    };
    break;
  }
  if (found) return;
  for (const id of ids) {
    forms[id] = { ...forms[id]!, resume: { kind: "expired" } };
  }
}

async function visitorBusiness(
  site: SiteContext,
  sections: readonly SectionLike[],
): Promise<PublicBusiness | null> {
  if (!needsBusiness(sections)) return null;
  try {
    return await getPublicBusiness(site);
  } catch (err) {
    console.error("[site] core block data failed", "business", err);
    return null;
  }
}

async function visitorServices(
  site: SiteContext,
  sections: readonly SectionLike[],
): Promise<PublicService[] | null> {
  if (!needsServices(sections)) return null;
  try {
    return (await readPublicServices(site)).map(toBlockService);
  } catch (err) {
    console.error("[site] core block data failed", "services", err);
    return null;
  }
}

async function visitorTeam(
  site: SiteContext,
  sections: readonly SectionLike[],
  opts: { pageId?: string; protectedPage?: boolean },
): Promise<PublicTeamMember[] | null> {
  if (!needsTeam(sections)) return null;
  let rows: MemberRow[];
  try {
    rows = (await readPublicTeam(site)).map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      bio: m.bio,
      photoId: m.photo,
    }));
  } catch (err) {
    console.error("[site] core block data failed", "team", err);
    return null;
  }
  let photos: MediaMap = {};
  const ids = photoIdsOf(rows);
  if (ids.length > 0) {
    try {
      // Choice 2: the same org-scoped resolver and options as the page's other media.
      photos = await resolvePublicMedia(site, ids, {
        ...(opts.pageId ? { pageId: opts.pageId } : {}),
        protectedPage: opts.protectedPage === true,
      });
    } catch (err) {
      console.error("[site] core block data failed", "team photos", err);
    }
  }
  return toBlockTeam(rows, photos);
}

async function visitorMedia(
  site: SiteContext,
  sections: readonly SectionLike[],
  opts: { pageId?: string; protectedPage?: boolean },
  popupsP: Promise<readonly { content: unknown }[]>,
): Promise<MediaMap> {
  const popups = await popupsP;
  try {
    const ids = mediaIdsFor(sections, popups);
    if (ids.length === 0) return {};
    return await resolvePublicMedia(site, ids, {
      ...(opts.pageId ? { pageId: opts.pageId } : {}),
      protectedPage: opts.protectedPage === true,
    });
  } catch (err) {
    console.error("[site] core block data failed", "media", err);
    return {};
  }
}

/** Builder preview: the same data read with the member's OrgContext. */
export async function previewCoreBlockData(
  ctx: OrgContext,
  sections: readonly SectionLike[],
): Promise<CoreBoundData> {
  const [business, media, forms, services, team] = await Promise.all([
    previewBusiness(ctx, sections),
    previewMedia(ctx, sections),
    previewForms(ctx, sections),
    previewServices(ctx, sections),
    previewTeam(ctx, sections),
  ]);
  // 08-08: editorPreview is set on the builder preview only (T-08-08-03), never on visitors.
  return {
    ...withExtras(
      result(business, media, forms, services, team),
      mapKeyFor(sections),
      undefined,
    ),
    editorPreview: true,
  };
}

async function previewServices(
  ctx: OrgContext,
  sections: readonly SectionLike[],
): Promise<PublicService[] | null> {
  if (!needsServices(sections)) return null;
  try {
    // WR-C02: the published projection on content read, so a Viewer sees what the site shows.
    return (await listPublishedServices(ctx)).map(toBlockService);
  } catch (err) {
    if (!(err instanceof Forbidden)) {
      console.error("[site] core block data failed", "services", err);
    }
    return null;
  }
}

async function previewTeam(
  ctx: OrgContext,
  sections: readonly SectionLike[],
): Promise<PublicTeamMember[] | null> {
  if (!needsTeam(sections)) return null;
  let rows: MemberRow[];
  try {
    rows = (await listPublishedTeam(ctx)).map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      bio: m.bio,
      photoId: m.photo,
    }));
  } catch (err) {
    if (!(err instanceof Forbidden)) {
      console.error("[site] core block data failed", "team", err);
    }
    return null;
  }
  let photos: MediaMap = {};
  const ids = photoIdsOf(rows);
  if (ids.length > 0) {
    try {
      photos = await resolveHubMedia(ctx, ids);
    } catch (err) {
      if (!(err instanceof Forbidden)) {
        console.error("[site] core block data failed", "team photos", err);
      }
    }
  }
  return toBlockTeam(rows, photos);
}

async function previewForms(
  ctx: OrgContext,
  sections: readonly SectionLike[],
): Promise<FormMap | null> {
  try {
    const ids = formIdsFor(sections).slice(0, 20);
    if (ids.length === 0) return null;
    const out: FormMap = {};
    await Promise.all(
      ids.map(async (id) => {
        try {
          const rec = await getForm(ctx, id);
          out[id] = {
            form: publicFormOf(rec, id),
            pageId: null,
            status: null,
            preview: true,
          };
        } catch (err) {
          if (!(err instanceof NotFound) && !(err instanceof Forbidden)) {
            console.error("[site] core form data failed", err);
          }
        }
      }),
    );
    return out;
  } catch (err) {
    console.error("[site] core form data failed", err);
    return null;
  }
}

async function previewMedia(
  ctx: OrgContext,
  sections: readonly SectionLike[],
): Promise<MediaMap> {
  try {
    const ids = mediaIdsFor(sections);
    if (ids.length === 0) return {};
    return await resolveHubMedia(ctx, ids);
  } catch (err) {
    if (!(err instanceof Forbidden)) {
      console.error("[site] core block data failed", "media", err);
    }
    return {};
  }
}

async function previewBusiness(
  ctx: OrgContext,
  sections: readonly SectionLike[],
): Promise<PublicBusiness | null> {
  if (!needsBusiness(sections)) return null;
  let business: PublicBusiness | null = null;
  try {
    const profile = await getBusinessProfile(ctx);
    // No row yet (id ""): null, like the visitor read.
    business =
      profile.id === ""
        ? null
        : projectPublicBusiness(
            profile as unknown as Record<string, unknown>,
            profile.orgName,
          );
  } catch (err) {
    if (!(err instanceof Forbidden)) {
      console.error("[site] core block data failed", "business", err);
    }
  }
  return business;
}
