// The every-block dev tenant (DEV ONLY; Phase 7 exit, CONT-13, CONT-15, CONT-20, CONT-33;
// 07-33 choices 1-6). One fixture, three callers: `npm run tenants:seed-dev -- --blocks`,
// the exit integration test (apps/web/test/blocks-exit.integration.test.tsx) and the
// Lighthouse runner (packages/db/scripts/lighthouse.ts) all call seedBlocksTenant, so the
// three can never drift.
//
// BLOCKS_FIXTURE is pure data (page -> sections, plus the pop-up). Record ids are written as
// tokens ("$photo:3", "$logo:0", "$video", "$audio", "$form:main", "$form:old",
// "$page:visit") and resolved at seed time with resolveBlocksTokens. dev-seed-blocks.test.ts
// fails when a CORE_SECTIONS type or a COLUMN_ITEM_KINDS kind is missing from the fixture,
// so a future block cannot skip the exit fixture (choice 4).
//
// Invariant 1: everything after bootstrapDevTenant goes through the normal @cds/db writers
// as the owner; this file never holds a PocketBase client. assertDevEnvironment() runs first
// (CDS_ENV must be exactly "dev"). Not exported from the @cds/db root (WR-A05): callers
// import it by relative path. Passwords are never logged or returned.
import { InvalidInput } from "@cds/core";
import type { AddonRegistry } from "@cds/core/addons";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type { FormDefinition, FormProSettings } from "@cds/core/forms";
import sharp from "sharp";
import { assertDevEnvironment, bootstrapDevTenant } from "./dev-seed";
import {
  appendChunk,
  createForm,
  createPage,
  deleteForm,
  ensureNotFoundPage,
  finishChunkedUpload,
  getContentScanner,
  getSearchPinger,
  installAddon,
  listForms,
  listOrgAddons,
  listLibrary,
  listMedia,
  listPages,
  listPopups,
  listSections,
  orgContextFromToken,
  publishPage,
  recordingInvalidator,
  refreshSiteIcons,
  saveBusinessProfile,
  saveFooter,
  saveForm,
  saveNav,
  savePopup,
  saveSection,
  saveService,
  saveSiteSettings,
  saveTeamMember,
  setPagePassword,
  signInMember,
  startChunkedUpload,
  updatePage,
  uploadImage,
  uploadLibraryAudio,
  uploadLibraryImage,
  type PublishDeps,
} from "./index";
import { createVideoFromUpload } from "./media/video/upload";
import { drainVideoQueue } from "./media/video/job";
import { getVideoTranscoder } from "./media/video/transcoder";
import { createFakeTranscoder } from "./media/video/fake";
import type { ObjectStore } from "./storage";

export const BLOCKS_HOST = "blocks.localhost";
export const BLOCKS_SLUG = "blocks";
export const BLOCKS_NAME = "Blocks Bakery";
export const BLOCKS_OWNER_EMAIL = "owner@blocks.test";
const SEED_IP = "dev-seed";

export type BlocksPageKey = "home" | "gallery" | "visit" | "members";

export type FixtureSection = {
  type: string;
  layout: string;
  content: Record<string, unknown>;
};

export type FixturePage = {
  slug: string;
  title: string;
  description: string;
  sections: FixtureSection[];
};

const GALLERY_ALTS = [
  "Fresh sourdough loaf on a board",
  "Croissants cooling on a wire rack",
  "A baker shaping dough by hand",
  "Cinnamon rolls fresh from the oven",
  "Rye bread sliced on a table",
  "A tray of fruit tarts",
  "Flour dusted over a wooden bench",
  "Baguettes stacked in a basket",
  "A three-tier celebration cake",
  "Morning light in the shop window",
  "Seeded loaves on the counter",
  "Coffee and a pastry by the window",
  "The oven door open at dawn",
  "A box of mixed cookies",
];
const LOGO_NAMES = [
  "Austin Grain Co.",
  "Hill Country Dairy",
  "Congress Ave Coffee",
  "Texas Mill Works",
];

/** Text items, lists and so on with deterministic ids so a re-seed rewrites in place. */
const t = (id: string, html: string) => ({ id, kind: "text", html });
const h = (id: string, text: string, level: 2 | 3 = 2) => ({
  id,
  kind: "heading",
  text,
  level,
});
const cell = (text: string, link = "") => ({
  text,
  bold: false,
  italic: false,
  link,
});

function photo(i: number) {
  return {
    id: `gal-${i}`,
    asset: `$photo:${i}`,
    alt: "",
    alt_reviewed: true,
    caption: i === 0 ? "Our signature loaf" : "",
  };
}

const VIDEO_ITEM = (id: string) => ({
  id,
  kind: "video",
  title: "How we bake our sourdough",
  source: "media",
  asset: "$video",
  provider: "",
  provider_id: "",
  cover: "",
  shape: "16:9",
  controls: true,
  loop: false,
  autoplay: false,
});

/**
 * The every-block fixture (choice 3, 4): four pages and one pop-up. Words: "linen" is
 * the FAQ search word, "quokka" occurs only on the protected members page.
 */
export const BLOCKS_FIXTURE = Object.freeze({
  words: { faq: "linen", protectedOnly: "quokka" },
  pages: {
    home: {
      slug: "home",
      title: "Blocks Bakery: bread baked at dawn",
      description:
        "A family bakery in Austin. Hand-shaped loaves, pastries and celebration cakes, baked fresh every morning.",
      sections: [
        {
          type: "hero",
          layout: "full",
          content: {
            tagline: "Baked fresh at dawn",
            heading: "Bread worth getting up for",
            subtitle: "Hand-shaped loaves and pastries from our Austin oven.",
            cta_primary_text: "Visit us",
            cta_primary_link: "/visit",
          },
        },
        {
          type: "text-only",
          layout: "full",
          content: {
            heading: "Our story",
            text: "<p>We have baked on South Congress for twelve years. Every loaf is shaped by hand.</p>",
          },
        },
        {
          type: "text-image",
          layout: "full",
          content: {
            heading: "Slow dough, big flavor",
            text: "<p>Our dough rests for two days before it meets the oven.</p>",
            image_url: "",
            image_alt: "",
          },
        },
        {
          type: "columns",
          layout: "40-60",
          content: {
            columns: [
              {
                id: "home-col-a",
                items: [
                  {
                    id: "home-img",
                    kind: "image",
                    url: "",
                    alt: "Fresh sourdough loaf on a board",
                    asset: "$photo:0",
                  },
                  { id: "home-spacer", kind: "spacer", height: "md" },
                  {
                    id: "home-btn",
                    kind: "button",
                    text: "See the gallery",
                    link: "/gallery",
                    style: "primary",
                    action: "link",
                    popup_id: "",
                  },
                ],
              },
              {
                id: "home-col-b",
                items: [
                  h("home-h", "Our grand reopening"),
                  t(
                    "home-t",
                    "<p>The new oven is in. Come taste the difference.</p>",
                  ),
                  {
                    id: "home-list",
                    kind: "list",
                    items: ["Sourdough", "Rye", "Croissants"],
                  },
                  { id: "home-div", kind: "divider" },
                  {
                    id: "home-count",
                    kind: "countdown",
                    target_at: "2030-01-01T15:00:00.000Z",
                    zero_message: "We are open!",
                  },
                ],
              },
            ],
          },
        },
        {
          type: "tabs",
          layout: "full",
          content: {
            heading: "What we bake",
            tabs: [
              {
                id: "tab-bread",
                label: "Bread",
                row_layout: "full",
                columns: [
                  {
                    id: "tab-bread-c",
                    items: [
                      t(
                        "tab-bread-t",
                        "<p>Country loaves, rye and baguettes.</p>",
                      ),
                    ],
                  },
                ],
              },
              {
                id: "tab-cake",
                label: "Cakes",
                row_layout: "full",
                columns: [
                  {
                    id: "tab-cake-c",
                    items: [
                      t("tab-cake-t", "<p>Celebration cakes for 12 to 40.</p>"),
                    ],
                  },
                ],
              },
            ],
          },
        },
        {
          type: "table",
          layout: "full",
          content: {
            heading: "Prices",
            header_row: true,
            first_column_header: false,
            striped: true,
            align: ["left", "right", "left"],
            mobile: "scroll",
            // Builder Pro table (10-41/10-42): sort + search mount the TableController island.
            pro: { sticky: true, sortable: true, searchable: true },
            rows: [
              [cell("Item"), cell("Price"), cell("More")],
              [
                cell("Country loaf"),
                cell("$9"),
                cell("Order online", "https://example.com/order"),
              ],
              [cell("Croissant"), cell("$4"), cell("")],
            ],
          },
        },
        {
          type: "faq",
          layout: "full",
          content: {
            heading: "Questions",
            open_first: false,
            items: [
              {
                id: "faq-1",
                question: "How long does your bread keep?",
                answer:
                  "<p>Our sourdough keeps four days wrapped in linen.</p>",
              },
              {
                id: "faq-2",
                question: "Do you take custom cake orders?",
                answer: "<p>Yes, with one week of notice.</p>",
              },
              {
                id: "faq-3",
                question: "Is there parking?",
                answer: "<p>Street parking is free after six.</p>",
              },
            ],
          },
        },
        {
          type: "icon-list",
          layout: "full",
          content: {
            heading: "Why people come back",
            items: [
              {
                id: "il-1",
                icon: "check",
                title: "Baked today",
                text: "Nothing sits overnight.",
              },
              {
                id: "il-2",
                icon: "star",
                title: "Local flour",
                text: "Milled in Texas.",
              },
              {
                id: "il-3",
                icon: "circle-check",
                title: "Real butter",
                text: "No shortcuts.",
              },
            ],
          },
        },
        {
          type: "stats",
          layout: "full",
          content: {
            heading: "By the numbers",
            count_up: true,
            items: [
              {
                id: "st-1",
                value: "12",
                prefix: "",
                suffix: "",
                label: "Years baking",
              },
              {
                id: "st-2",
                value: "1,200",
                prefix: "",
                suffix: "+",
                label: "Loaves a week",
              },
              {
                id: "st-3",
                value: "4.9",
                prefix: "",
                suffix: "",
                label: "Average rating",
              },
            ],
          },
        },
        {
          type: "cta-banner",
          layout: "full",
          content: {
            heading: "Order a cake",
            description: "Tell us the date and we will do the rest.",
            button_text: "Get in touch",
            button_link: "/visit",
          },
        },
      ],
    },
    gallery: {
      slug: "gallery",
      title: "Gallery",
      description:
        "Photos from the Blocks Bakery kitchen, our partners and a short video on how we bake.",
      sections: [
        {
          type: "gallery",
          layout: "full",
          content: {
            heading: "From our kitchen",
            display: "grid",
            columns: 3,
            per_page: 12,
            show_captions: true,
            lightbox: true,
            images: Array.from({ length: 14 }, (_, i) => photo(i)),
          },
        },
        {
          type: "slider",
          layout: "full",
          content: {
            heading: "Behind the counter",
            direction: "ltr",
            arrows: true,
            dots: true,
            autoplay: false,
            interval: 5,
            transition: "slide",
            slides: [
              {
                id: "sl-1",
                row_layout: "full",
                columns: [
                  {
                    id: "sl-1-c",
                    items: [
                      h("sl-1-h", "Morning bake"),
                      t(
                        "sl-1-t",
                        "<p>The first loaves leave the oven at five.</p>",
                      ),
                    ],
                  },
                ],
              },
              {
                id: "sl-2",
                row_layout: "full",
                columns: [
                  {
                    id: "sl-2-c",
                    items: [
                      {
                        id: "sl-2-audio",
                        kind: "audio",
                        title: "A minute in the bakery",
                        source: "media",
                        asset: "$audio",
                        provider: "",
                        provider_id: "",
                      },
                    ],
                  },
                ],
              },
              {
                id: "sl-3",
                row_layout: "full",
                columns: [{ id: "sl-3-c", items: [VIDEO_ITEM("sl-3-video")] }],
              },
            ],
          },
        },
        {
          type: "logo-strip",
          layout: "full",
          content: {
            heading: "Our partners",
            grayscale: true,
            logos: LOGO_NAMES.map((name, i) => ({
              id: `logo-${i}`,
              asset: `$logo:${i}`,
              name,
              link: i === 0 ? "https://example.com/grain" : "",
            })),
          },
        },
      ],
    },
    visit: {
      slug: "visit",
      title: "Visit us",
      description:
        "Find Blocks Bakery on South Congress: hours, directions, booking and a contact form.",
      sections: [
        {
          type: "columns",
          layout: "50-50",
          content: {
            columns: [
              {
                id: "visit-col-a",
                items: [
                  h("visit-h", "Write to us"),
                  { id: "visit-form", kind: "form", form_id: "$form:main" },
                  { id: "visit-form-old", kind: "form", form_id: "$form:old" },
                ],
              },
              {
                id: "visit-col-b",
                items: [
                  {
                    id: "visit-embed",
                    kind: "embed",
                    title: "Book a tasting",
                    provider: "calendly",
                    provider_id: "blocks-bakery/tasting",
                  },
                  {
                    id: "visit-yt",
                    kind: "video",
                    title: "A tour of the shop",
                    source: "link",
                    asset: "",
                    provider: "youtube",
                    provider_id: "dQw4w9WgXcQ",
                    cover: "",
                    shape: "16:9",
                    controls: true,
                    loop: false,
                    autoplay: false,
                  },
                ],
              },
            ],
          },
        },
        {
          type: "map",
          layout: "full",
          content: { heading: "Find us", location: "", show_directions: true },
        },
        {
          type: "hours",
          layout: "full",
          content: { heading: "Opening hours", show_open_now: true },
        },
        {
          type: "social",
          layout: "full",
          content: {
            heading: "Follow and share",
            show_socials: true,
            show_share: true,
            share: ["facebook", "x", "email", "copy"],
          },
        },
        // 08-05: data-bound, fill from the seeded services and team once 08-08 loads them.
        {
          type: "services",
          layout: "full",
          content: {
            heading: "What we bake to order",
            display: "cards",
            limit: 6,
            show_descriptions: true,
            show_durations: true,
          },
        },
        {
          type: "team",
          layout: "full",
          content: { heading: "Our team", show_roles: true, show_bios: true },
        },
      ],
    },
    members: {
      slug: "members",
      title: "Members",
      description: "Recipes and early news for Blocks Bakery members.",
      sections: [
        {
          type: "text-only",
          layout: "full",
          content: {
            heading: "Members corner",
            text: "<p>This month's members recipe is the quokka loaf, a soft rye.</p>",
          },
        },
      ],
    },
  } satisfies Record<BlocksPageKey, FixturePage>,
  popup: {
    name: "Watch the bake",
    trigger: "click",
    items: [h("pop-h", "Watch the bake"), VIDEO_ITEM("pop-video")],
  },
  galleryAlts: GALLERY_ALTS,
  logoNames: LOGO_NAMES,
});

/** Every token form the fixture uses. */
const TOKEN =
  /^\$(photo|logo):(\d+)$|^\$(video|audio)$|^\$form:(main|old)$|^\$page:(home|gallery|visit|members)$/;

/** Deep-copy `value`, replacing every "$token" string with `lookup(token)`. */
export function resolveBlocksTokens<T>(
  value: T,
  lookup: (token: string) => string,
): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return TOKEN.test(v) ? lookup(v) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => [
          k,
          walk(x),
        ]),
      );
    }
    return v;
  };
  return walk(value) as T;
}

export type BlocksSeedInput = {
  host?: string;
  ownerEmail?: string;
  ownerPassword: string;
  pagePassword: string;
  design: unknown;
  transcode?: "fake" | "ffmpeg";
};

export type BlocksSeedDeps = {
  registry: AddonRegistry;
  store?: ObjectStore;
  publicStore?: ObjectStore;
};

export type BlocksSeedResult = {
  orgId: string;
  host: string;
  created: boolean;
  pages: Record<BlocksPageKey | "notFound", string>;
  formId: string;
  deletedFormId: string;
  assets: {
    photos: string[];
    logos: string[];
    video: string;
    audio: string;
    siteLogo: string;
    share: string;
  };
  navVersions: number;
};

async function gradient(
  width: number,
  height: number,
  hue: number,
  format: "png" | "jpeg",
): Promise<Uint8Array> {
  const from = `hsl(${hue % 360},55%,45%)`;
  const to = `hsl(${(hue + 40) % 360},60%,85%)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  const s = sharp(Buffer.from(svg));
  const buf =
    format === "png" ? await s.png().toBuffer() : await s.jpeg().toBuffer();
  return new Uint8Array(buf);
}

/** MPEG-1 Layer III 128 kbit/s 44.1 kHz frames (header FF FB 90 64) behind a small ID3v2 tag. */
export function silentMp3(frames = 400): Uint8Array {
  const FRAME = 417;
  const out = new Uint8Array(10 + 20 + frames * FRAME);
  out.set([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 20], 0);
  for (let i = 0; i < frames; i += 1) {
    out.set([0xff, 0xfb, 0x90, 0x64], 30 + i * FRAME);
  }
  return out;
}

/** The MP4 bytes 07-13's fake-transcoder tests use (ftyp isom + a free box). */
export function fakeMp4(size = 20_000): Uint8Array {
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  const ascii = (s: string, at: number) => {
    for (let i = 0; i < s.length; i += 1) out[at + i] = s.charCodeAt(i);
  };
  view.setUint32(0, 24);
  ascii("ftyp", 4);
  ascii("isom", 8);
  view.setUint32(12, 0x200);
  ascii("isom", 16);
  ascii("mp41", 20);
  view.setUint32(24, size - 24);
  ascii("free", 28);
  for (let i = 32; i < size; i += 1) out[i] = i % 251;
  return out;
}

const OPEN = (start: string, end: string) => ({
  open: true,
  ranges: [{ start, end }],
});
const CLOSED = { open: false, ranges: [] };

/**
 * DEV ONLY. Create or update the every-block tenant on `input.host` (default
 * blocks.localhost, a custom primary host so pages are indexable). Idempotent: library
 * media, forms, pages and sections are found by name / slug / position and rewritten.
 */
export async function seedBlocksTenant(
  input: BlocksSeedInput,
  deps: BlocksSeedDeps,
): Promise<BlocksSeedResult> {
  assertDevEnvironment();
  const host = input.host ?? BLOCKS_HOST;
  const ownerEmail = input.ownerEmail ?? BLOCKS_OWNER_EMAIL;
  if (input.pagePassword.length < 8) {
    throw new InvalidInput("page password must be at least 8 characters");
  }
  const tenant = await bootstrapDevTenant(
    {
      slug: BLOCKS_SLUG,
      name: BLOCKS_NAME,
      host,
      hostKind: "custom",
      ownerEmail,
      ownerPassword: input.ownerPassword,
      design: input.design,
    },
    { invalidator: recordingInvalidator() },
  );
  const { token } = await signInMember(
    ownerEmail,
    input.ownerPassword,
    SEED_IP,
  );
  const ctx = await orgContextFromToken(token, tenant.orgId, SEED_IP);
  const sections = composeSectionRegistry(
    CORE_SECTIONS,
    deps.registry.sections(),
  );
  const store = deps.store ? { store: deps.store } : {};
  const pdeps: PublishDeps = {
    sections,
    invalidator: recordingInvalidator(),
    scanner: getContentScanner(),
    pinger: getSearchPinger(),
    addons: deps.registry,
    ...store,
    ...(deps.publicStore ? { publicStore: deps.publicStore } : {}),
  };

  // Business: profile, hours, socials, services, team (dev-seed-intake.ts calls).
  await saveBusinessProfile(ctx, {
    org_name: BLOCKS_NAME,
    business_type: "bakery",
    tagline: "Baked fresh at dawn",
    phone: "(512) 555-0199",
    public_email: "hello@blocksbakery.test",
    address: {
      street: "1200 South Congress Ave",
      city: "Austin",
      state: "TX",
      zip: "78704",
    },
    time_zone: "America/Chicago",
    hours: {
      mon: CLOSED,
      tue: OPEN("07:00", "15:00"),
      wed: OPEN("07:00", "15:00"),
      thu: OPEN("07:00", "15:00"),
      fri: OPEN("07:00", "18:00"),
      sat: OPEN("08:00", "14:00"),
      sun: CLOSED,
    },
    // 11-35: saveBusinessProfile writes these as social_accounts rows (ig, fb).
    socials: [
      { platform: "instagram", url: "https://instagram.com/blocksbakery" },
      { platform: "facebook", url: "https://facebook.com/blocksbakery" },
    ],
    about: "Blocks Bakery is a family bakery in Austin.",
  });
  if (tenant.created) {
    await saveService(ctx, {
      name: "Custom celebration cake",
      description: "Designed with you, serves 12 to 40.",
      price_display: "from",
      price_cents: 6500,
      duration_minutes: null,
      is_published: true,
    });
    await saveService(ctx, {
      name: "Weekly bread box",
      description: "Three loaves every Saturday.",
      price_display: "fixed",
      price_cents: 2400,
      duration_minutes: null,
      is_published: true,
    });
    await saveTeamMember(ctx, {
      name: "Ana Rivera",
      role: "Head baker",
      bio: "Ana has baked sourdough for twenty years.",
      is_published: true,
    });
    await saveTeamMember(ctx, {
      name: "Sam Ortiz",
      role: "Cake decorator",
      bio: "Sam designs every celebration cake with the family who orders it.",
      is_published: true,
    });
  }

  // Media (choice 5): found by name on a re-run, else uploaded.
  const byName = new Map<string, string>();
  for (let page = 1; ; page += 1) {
    const res = await listLibrary(ctx, { page, perPage: 100 });
    for (const a of res.items) byName.set(a.name, a.id);
    if (res.items.length < 100) break;
  }
  const image = async (
    name: string,
    alt: string,
    bytes: () => Promise<Uint8Array>,
  ) =>
    byName.get(name) ??
    (
      await uploadLibraryImage(ctx, await bytes(), {
        alt,
        filename: name,
        ...store,
      })
    ).asset.id;

  const photos: string[] = [];
  for (let i = 0; i < 14; i += 1) {
    photos.push(
      await image(`blocks-photo-${i + 1}.jpg`, GALLERY_ALTS[i]!, () =>
        gradient(1600, 1067, i * 25, "jpeg"),
      ),
    );
  }
  const logos: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    logos.push(
      await image(`blocks-logo-${i + 1}.png`, `${LOGO_NAMES[i]} logo`, () =>
        gradient(400, 200, 200 + i * 30, "png"),
      ),
    );
  }
  const share = await image(
    "blocks-share.jpg",
    "Blocks Bakery storefront at dawn",
    () => gradient(1200, 630, 30, "jpeg"),
  );

  const chunked = async (
    purpose: "audio" | "video",
    bytes: Uint8Array,
    filename: string,
  ) => {
    const { uploadId, parts } = await startChunkedUpload(ctx, {
      purpose,
      size: bytes.length,
      filename,
    });
    const part = Math.ceil(bytes.length / Math.max(parts, 1));
    for (let i = 0; i < parts; i += 1) {
      await appendChunk(
        ctx,
        uploadId,
        i,
        bytes.subarray(i * part, (i + 1) * part),
      );
    }
    return finishChunkedUpload(ctx, uploadId);
  };
  const audio =
    byName.get("blocks-bakery.mp3") ??
    (
      await uploadLibraryAudio(
        ctx,
        await chunked("audio", silentMp3(), "blocks-bakery.mp3"),
        store,
      )
    ).asset.id;
  let video: string | undefined = byName.get("blocks-sourdough.mp4");
  if (!video) {
    const kind =
      input.transcode ??
      (process.env.CDS_VIDEO_TRANSCODER === "ffmpeg" ? "ffmpeg" : "fake");
    const transcoder =
      kind === "fake"
        ? createFakeTranscoder({
            result: { durationS: 9.4, width: 1280, height: 720 },
          })
        : getVideoTranscoder();
    const made = await createVideoFromUpload(
      ctx,
      await chunked("video", fakeMp4(), "blocks-sourdough.mp4"),
      { ...store, transcoder },
    );
    await drainVideoQueue();
    video = made.asset.id;
  }

  // Site logo (business kind) -> site icons (07-30).
  // Re-runs keep the existing logo (one logo per site; never a duplicate row).
  const siteLogo =
    (await listMedia(ctx, "logo"))[0]?.id ??
    (
      await uploadImage(ctx, await gradient(600, 600, 15, "png"), "logo", {
        alt: "Blocks Bakery logo",
        filename: "logo.png",
        ...store,
      })
    ).asset.id;
  await refreshSiteIcons(ctx, store);

  // Builder Pro (10-44): the Lighthouse gate covers the Pro form and Pro table renders that
  // P10 added to tenant sites. Before checkout an install is free (payments/gate.ts).
  const installed = await listOrgAddons(ctx);
  if (
    !installed.some((r) => r.addon === "builder-pro" && r.status === "active")
  ) {
    await installAddon(ctx, { ...pdeps, addons: deps.registry }, "builder-pro");
  }

  // Forms (07-15 / 07-28): a main contact form and a soft-deleted, still-used one.
  const forms = await listForms(ctx, { includeDeleted: true });
  let main =
    forms.find((f) => f.name === "Contact us") ??
    (await createForm(ctx, pdeps, { template: "contact", name: "Contact us" }))
      .form;
  if (!main.pro || main.pro.steps.length === 0) {
    // A two-step Pro form (10-40): name + email, then phone + message; save and finish later.
    const ids = main.fields.map((f) => f.id);
    const pro: FormProSettings = {
      rules: [],
      steps: [
        { id: "step-you", title: "About you", fields: ids.slice(0, 2) },
        { id: "step-message", title: "Your message", fields: ids.slice(2) },
      ],
      auto_reply: { enabled: false, subject: "", body: "" },
      routing: [],
      save_resume: true,
    };
    const def: FormDefinition = {
      name: main.name,
      layout: main.layout,
      fields: main.fields,
      after_submit: main.after_submit,
      notify_route: main.notify_route,
      newsletter_checkbox: main.newsletter_checkbox,
      newsletter_wording: main.newsletter_wording,
      pro,
    };
    main = (await saveForm(ctx, pdeps, { id: main.id, ...def })).form;
  }
  const old =
    forms.find((f) => f.name === "Old enquiry") ??
    (await createForm(ctx, pdeps, { template: "contact", name: "Old enquiry" }))
      .form;

  // Pages.
  const existing = await listPages(ctx);
  const pages = {} as Record<BlocksPageKey, string>;
  for (const key of Object.keys(BLOCKS_FIXTURE.pages) as BlocksPageKey[]) {
    const fx = BLOCKS_FIXTURE.pages[key];
    const found = existing.find((p) => p.slug === fx.slug);
    pages[key] = (
      found ?? (await createPage(ctx, { title: fx.title, slug: fx.slug }))
    ).id;
  }

  const lookup = (tok: string): string => {
    const m = /^\$(\w+)(?::(\w+))?$/.exec(tok)!;
    const kind = m[1];
    const arg = m[2] ?? "";
    if (kind === "photo") return photos[Number(arg)]!;
    if (kind === "logo") return logos[Number(arg)]!;
    if (kind === "video") return video!;
    if (kind === "audio") return audio;
    if (kind === "form") return arg === "main" ? main.id : old.id;
    if (kind === "page") return pages[arg as BlocksPageKey];
    throw new Error(`unknown fixture token ${tok}`);
  };

  // Pop-up (click trigger) holding the MP4 video item.
  const popupId = (await listPopups(ctx)).find(
    (p) => p.name === BLOCKS_FIXTURE.popup.name,
  )?.id;
  await savePopup(ctx, pdeps, {
    ...(popupId ? { id: popupId } : {}),
    name: BLOCKS_FIXTURE.popup.name,
    trigger: BLOCKS_FIXTURE.popup.trigger,
    frequency: "every-visit",
    show_on: "all-pages",
    enabled: true,
    content: { items: resolveBlocksTokens(BLOCKS_FIXTURE.popup.items, lookup) },
  });

  for (const key of Object.keys(BLOCKS_FIXTURE.pages) as BlocksPageKey[]) {
    const fx = BLOCKS_FIXTURE.pages[key];
    const pageId = pages[key];
    await updatePage(
      ctx,
      pageId,
      {
        title: fx.title,
        seo: {
          meta_title: fx.title,
          meta_description: fx.description,
          ...(key === "home" ? { share_image: share } : {}),
        },
      },
      deps.store,
    );
    const current = await listSections(ctx, pageId);
    for (let i = 0; i < fx.sections.length; i += 1) {
      const s = fx.sections[i]!;
      const prior =
        current[i]?.section_type === s.type ? current[i] : undefined;
      await saveSection(ctx, sections, {
        ...(prior ? { id: prior.id } : {}),
        pageId,
        section_type: s.type,
        row_layout: s.layout,
        content: resolveBlocksTokens(s.content, lookup),
      });
    }
  }

  // The old form is used on visit now, so deleting it must be soft (07-28).
  const oldRow = forms.find((f) => f.id === old.id);
  if (!oldRow?.deleted) {
    const del = await deleteForm(ctx, pdeps, old.id);
    if (del.outcome !== "soft") {
      throw new Error(
        `dev seed: deleting a used form was ${del.outcome}, expected soft`,
      );
    }
  }

  // Chrome: two nav saves (07-29 history), footer, site settings (07-26).
  await saveNav(ctx, pdeps, {
    items: [
      {
        id: "nav-home",
        label: "Home",
        target: `page:${pages.home}`,
        children: [],
      },
    ],
    cta: null,
  });
  await saveNav(ctx, pdeps, {
    items: [
      {
        id: "nav-home",
        label: "Home",
        target: `page:${pages.home}`,
        children: [],
      },
      {
        id: "nav-about",
        label: "About",
        target: `page:${pages.gallery}`,
        children: [
          {
            id: "nav-gallery",
            label: "Gallery",
            target: `page:${pages.gallery}`,
          },
          {
            id: "nav-members",
            label: "Members",
            target: `page:${pages.members}`,
          },
        ],
      },
      {
        id: "nav-order",
        label: "Order online",
        target: "https://example.com/order",
        new_tab: true,
        children: [],
      },
    ],
    cta: { label: "Visit us", target: `page:${pages.visit}` },
  });
  await saveFooter(ctx, pdeps, {
    show_address: true,
    show_hours: true,
    show_socials: true,
    extra_links: [
      {
        id: "foot-press",
        label: "Press kit",
        target: "https://example.com/press",
      },
    ],
    copyright: "",
  });
  await saveSiteSettings(ctx, pdeps, {
    language: "es",
    show_translate: true,
    show_search: true,
    // AI crawlers allowed: llms.txt is served only then (07-31), and the exit test and
    // Lighthouse check it. The blocked-crawler robots group is covered by 07-31's tests.
    allow_ai_crawlers: true,
  });

  // Publish, then protect members, then the edited 404.
  for (const key of ["home", "gallery", "visit", "members"] as const) {
    const res = await publishPage(ctx, pages[key], pdeps);
    if (res.status !== "published") {
      throw new Error(
        `dev seed: publish of ${key} held (${res.reasons.length} reason(s))`,
      );
    }
  }
  await setPagePassword(
    ctx,
    pages.members,
    { password: input.pagePassword },
    pdeps,
  );
  const nf = await ensureNotFoundPage(ctx);
  await updatePage(
    ctx,
    nf.id,
    { title: "Oops, that page has gone stale" },
    deps.store,
  );
  const nfRes = await publishPage(ctx, nf.id, pdeps);
  if (nfRes.status !== "published") {
    throw new Error(
      `dev seed: publish of the 404 held (${nfRes.reasons.length} reason(s))`,
    );
  }

  return {
    orgId: tenant.orgId,
    host,
    created: tenant.created,
    pages: { ...pages, notFound: nf.id },
    formId: main.id,
    deletedFormId: old.id,
    assets: { photos, logos, video, audio, siteLogo, share },
    navVersions: 2,
  };
}
