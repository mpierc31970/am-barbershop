// Renders one published page (CONT-03, CONT-04, D31, D187, D253, D-UI-11; invariants 6
// and 7; 03-UI-SPEC "Site rendering contract", "Heading-level rule").
//
// Ported from donor src/components/sections/PageRenderer.tsx as a server component over
// the published JSON (no client fetching, no loading state). Exactly one h1: the Hero (the
// only type that owns it, 07-04 / CONT-35, computed once with headingOwnerId) or, when no
// Hero owns it, the visible PageTitleHeader (D280, D-UI-P7-13). Every other block heading
// is <h2>. The first block loads its image eagerly.
// Skip link and banner sit above this in the tenant layout (03-12).
// hideTranslate marker for page kinds flagged in PAGE_KIND_FLAGS (07-26, CONT-34): the
// layout cannot know the page, so TranslateLink checks for the attribute on <main>.
import {
  HIDE_TRANSLATE_ATTR,
  headingOwnerId,
  type PublishedPage,
  type PublishedSection,
  type SectionRegistry,
} from "@cds/core/content";
import {
  SectionRenderer,
  type InjectedSectionRenderer,
} from "./SectionRenderer";
import { PageTitleHeader } from "./PageTitleHeader";
import { renderableSections } from "./renderable";
import type { CoreBoundData } from "./types";

export interface PageRendererProps {
  page: PublishedPage;
  registry: SectionRegistry;
  now: Date;
  /**
   * Ids of the pop-ups that can open on this page (PopupHost renders exactly these).
   * A pop-up button pointing anywhere else is not rendered (WR-C07). Omitted = no
   * filtering (the builder preview, which renders no pop-ups).
   */
  openablePopups?: ReadonlySet<string>;
  /**
   * Add-on block renderers by section type, injected by the app from the add-on registry
   * (05-10). @cds/ui never imports an add-on: without this, add-on blocks draw nothing.
   */
  renderers?: Readonly<Record<string, InjectedSectionRenderer>>;
  /** Live add-on data keyed by section id (blockData results, D253). */
  boundData?: Readonly<Record<string, unknown>>;
  /**
   * False for a block that must not draw: an add-on block whose owner is off or whose live
   * data is empty. Such a block never takes the h1 or the eager image (Pitfall 9, WR-C08).
   */
  isDrawn?: (section: PublishedSection) => boolean;
  /**
   * Core bound data for the whole page: business, forms, media; built by apps/web
   * `core-block-data.ts` (07-07, 07-12, 07-19). Core blocks only; add-ons use boundData.
   */
  coreData?: CoreBoundData;
  /** True for a page kind that hides the Translate link (hidesTranslate(kind); 07-26). */
  hideTranslate?: boolean;
}

const hasOwn = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

export function PageRenderer({
  page,
  registry,
  now,
  openablePopups,
  renderers,
  boundData,
  isDrawn,
  coreData,
  hideTranslate = false,
}: PageRendererProps) {
  const sections = Array.isArray(page.sections) ? page.sections : [];
  // Only blocks that actually draw may own the h1 or the eager image: an add-on block with
  // no renderer, an off owner or empty data would otherwise take the h1 and leave the page
  // with none (WR-C08, Pitfall 9). The same filtered list is what gets drawn.
  const drawn = renderableSections(sections, registry, {
    extraTypes: renderers ? new Set(Object.keys(renderers)) : undefined,
    isDrawn,
  });
  const ownerId = headingOwnerId(drawn, registry);
  const firstId = drawn[0]?.id;

  return (
    <main
      id="content"
      tabIndex={-1}
      className="outline-none"
      {...(hideTranslate ? { [HIDE_TRANSLATE_ATTR]: "" } : {})}
    >
      {ownerId === null && <PageTitleHeader title={page.page?.title ?? ""} />}
      {drawn.map((section) => (
        <SectionRenderer
          key={section.id}
          section={section}
          registry={registry}
          isH1Owner={section.id === ownerId}
          isFirst={section.id === firstId}
          now={now}
          openablePopups={openablePopups}
          renderers={renderers}
          data={
            boundData && hasOwn(boundData, section.id)
              ? boundData[section.id]
              : undefined
          }
          coreData={coreData}
        />
      ))}
    </main>
  );
}
