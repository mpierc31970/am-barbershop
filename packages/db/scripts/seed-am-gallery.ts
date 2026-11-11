// A&M Barber Studio: the Gallery page and the Home photo slider. Idempotent, and touches
// nothing else (unlike seed-am-barber.ts, it never rewrites pages the owner may have edited).
//
//   npm run am:gallery
//
// - /gallery: heading, a photo grid of every "gallery" photo in the media library, then
//   "On TikTok" with four empty columns: the owner drops a TikTok video item into each
//   from the builder (a video item can't be saved without a link).
// - Home: services two per row (photo on top), and a slider of the same photos just
//   above Opening hours.
// - Gallery goes in the menu; both pages are published.
// Re-runs refresh the photo lists and keep everything else as the owner left it.
//
// Storage: like am:seed, run it against a copy of the live object store and copy the
// changed files back (CLAUDE.md "Seeding").
import "@cds/addon-registry/server";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { withSuperuser } from "../src/client";
import { addPageToNav } from "../src/content/chrome/nav";
import { createPage, listPages, updatePage } from "../src/content/pages";
import { recordingInvalidator } from "../src/content/ports";
import { publishPage, type PublishDeps } from "../src/content/publish";
import {
  getContentScanner,
  getSearchPinger,
} from "../src/content/scan-standin";
import {
  deleteSection,
  listSections,
  saveSection,
} from "../src/content/sections";
import { mintOrgContext } from "../src/context";
import { listMedia } from "../src/media/assets";

const SLUG = "am-barber";
const IP = "am-gallery";
const ID = (n: number) =>
  `a3b00000-0000-4000-9000-0000000000${String(n).padStart(2, "0")}`;

function log(line: string): void {
  console.log(line);
}

async function main(): Promise<void> {
  for (const k of ["PB_URL", "PB_SUPERUSER_EMAIL", "PB_SUPERUSER_PASSWORD"]) {
    if (!process.env[k]) throw new Error(`${k} is not set`);
  }
  const { orgId, ownerId } = await withSuperuser(async (pb) => {
    const org = await pb
      .collection("organizations")
      .getFirstListItem(pb.filter("slug = {:s}", { s: SLUG }));
    const m = await pb
      .collection("memberships")
      .getFirstListItem(
        pb.filter("organization = {:o} && role = 'owner'", { o: org.id }),
      );
    return { orgId: org.id, ownerId: String(m.user) };
  });
  const ctx = mintOrgContext({
    orgId,
    actor: ownerId,
    role: "owner",
    grants: [],
    ip: IP,
  });
  const sections = composeSectionRegistry(
    CORE_SECTIONS,
    ADDON_REGISTRY.sections(),
  );
  const pdeps: PublishDeps = {
    sections,
    invalidator: recordingInvalidator(),
    scanner: getContentScanner(),
    pinger: getSearchPinger(),
    addons: ADDON_REGISTRY,
  };

  const photos = await listMedia(ctx, "gallery");
  if (photos.length === 0) throw new Error("no gallery photos in the library");
  const images = photos.map((m, i) => ({
    id: ID(50 + i),
    asset: m.id,
    alt: "",
    alt_reviewed: true,
    caption: "",
  }));
  const galleryContent = (display: "grid" | "slider", heading: string) => ({
    heading,
    display,
    columns: 3,
    per_page: 24,
    show_captions: false,
    lightbox: true,
    images,
  });

  // ---- Gallery page
  const pages = await listPages(ctx);
  const page =
    pages.find((p) => p.slug === "gallery") ??
    (await createPage(ctx, { title: "Gallery", slug: "gallery" }));
  const have = await listSections(ctx, page.id);
  const intro = have.find(
    (s) =>
      s.section_type === "text-only" &&
      JSON.stringify(s.content).includes("Gallery"),
  );
  const introRow = await saveSection(ctx, sections, {
    ...(intro ? { id: intro.id } : {}),
    pageId: page.id,
    section_type: "text-only",
    row_layout: "full",
    content: intro?.content ?? {
      heading: "Gallery",
      text: "<p>Cuts, fades, beards and the shop itself at 2505 S Carrier Pkwy, Grand Prairie.</p>",
    },
  });
  const grid = have.find((s) => s.section_type === "gallery");
  const gridRow = await saveSection(ctx, sections, {
    ...(grid ? { id: grid.id } : { afterId: introRow.id }),
    pageId: page.id,
    section_type: "gallery",
    row_layout: "full",
    content: {
      ...galleryContent("grid", ""),
      ...(grid
        ? { columns: (grid.content as { columns?: number }).columns ?? 3 }
        : {}),
    },
  });
  const tiktokHead = have.find(
    (s) =>
      s.section_type === "text-only" &&
      JSON.stringify(s.content).includes("TikTok"),
  );
  const headRow = tiktokHead
    ? tiktokHead
    : await saveSection(ctx, sections, {
        afterId: gridRow.id,
        pageId: page.id,
        section_type: "text-only",
        row_layout: "full",
        content: {
          heading: "On TikTok",
          text: "<p>Our latest videos.</p>",
        },
      });
  if (!have.some((s) => s.section_type === "columns")) {
    await saveSection(ctx, sections, {
      afterId: headRow.id,
      pageId: page.id,
      section_type: "columns",
      row_layout: "25-25-25-25",
      content: {
        columns: [1, 2, 3, 4].map((n) => ({ id: ID(n), items: [] })),
      },
    });
  }
  await updatePage(ctx, page.id, {
    seo: {
      meta_title: "Gallery | A&M Barber Studio, Grand Prairie, TX",
      meta_description:
        "Haircuts, skin fades, beard trims and the shop at A&M Barber Studio, 2505 S Carrier Pkwy, Grand Prairie, TX.",
    },
  });
  const gRes = await publishPage(ctx, page.id, pdeps);
  if (gRes.status !== "published") throw new Error("Gallery publish held");
  await addPageToNav(ctx, pdeps, page.id);
  log(
    `PASS gallery page: ${photos.length} photos, 4 TikTok slots, in the menu`,
  );

  // ---- Home slider, just above Opening hours
  const home = pages.find((p) => p.slug === "home");
  if (!home) throw new Error("no Home page");

  // ---- Home services: two per row (photo on top, text under it), not one 40-60 row each.
  // Rows are found by the seed's fixed column ids; each service keeps its own items, so the
  // owner's edits survive. Already paired (a 50-50 row) = nothing to do.
  const svcCol = (n: number) =>
    `a3b00000-0000-4000-8100-0000000000${String(n).padStart(2, "0")}`;
  const before0 = await listSections(ctx, home.id);
  type Col = { id: string; items: { kind?: string }[] };
  const rowOf = (n: number) =>
    before0.find(
      (s) =>
        s.section_type === "columns" &&
        JSON.stringify(s.content).includes(svcCol(n)),
    );
  const svcRows = [0, 1, 2, 3, 4].map(rowOf);
  if (svcRows.every(Boolean) && svcRows[0]!.row_layout !== "50-50") {
    const itemsOf = (n: number) => {
      const cols = (svcRows[n]!.content as { columns: Col[] }).columns;
      const items = cols.flatMap((c) => c.items);
      return [
        ...items.filter((i) => i.kind === "image"),
        ...items.filter((i) => i.kind !== "image"),
      ];
    };
    for (const [a, b] of [
      [0, 1],
      [2, 3],
      [4, -1],
    ] as const) {
      await saveSection(ctx, sections, {
        id: svcRows[a]!.id,
        pageId: home.id,
        section_type: "columns",
        row_layout: "50-50",
        content: {
          columns: [
            { id: svcCol(a), items: itemsOf(a) },
            b >= 0
              ? { id: svcCol(b), items: itemsOf(b) }
              : { id: ID(9), items: [] },
          ],
        },
      });
    }
    await deleteSection(ctx, svcRows[1]!.id);
    await deleteSection(ctx, svcRows[3]!.id);
    log("PASS home services: two per row");
  }

  const homeSections = await listSections(ctx, home.id);
  const slider = homeSections.find((s) => s.section_type === "gallery");
  const hoursAt = homeSections.findIndex((s) => s.section_type === "hours");
  const before =
    homeSections[(hoursAt > 0 ? hoursAt : homeSections.length) - 1];
  await saveSection(ctx, sections, {
    ...(slider ? { id: slider.id } : { afterId: before!.id }),
    pageId: home.id,
    section_type: "gallery",
    row_layout: "full",
    content: galleryContent(
      "slider",
      slider
        ? String((slider.content as { heading?: string }).heading ?? "")
        : "From the chair",
    ),
  });
  const hRes = await publishPage(ctx, home.id, pdeps);
  if (hRes.status !== "published") throw new Error("Home publish held");
  log("PASS home slider above Opening hours");
}

main().catch((err: unknown) => {
  console.error(
    `FAIL ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown error"}`,
  );
  if (err && typeof err === "object" && "data" in err) {
    console.error(
      JSON.stringify((err as { data: unknown }).data).slice(0, 800),
    );
  }
  process.exit(1);
});
