// ServicesSection (08-05; TMPL-01, TMPL-02, D37, D253, D-UI-P8-15, -16, -18, -19;
// 08-UI-SPEC "Services block"; T-08-05-01, -02).
//
// Items come live from coreData.services (published only, owner order; 08-08 loader), cut
// to "How many to show" (0 = all). Two displays:
// - List: <ul> max 768px, rows 16px padding-y with 1px rules between them; name (<h3>,
//   body 600) left and price right (wraps under the name below 480px), then duration and
//   description in text-muted.
// - Cards: <ul> grid, 32px gap, 1 / 2 (>= 640px) / 3 (>= 1024px) columns, except exactly
//   4 items stay at 2 (no orphan). Card ground follows the P7 table-stripe rule.
// Nothing published -> renders nothing (no heading, no band). In the builder preview
// (coreData.editorPreview) an editor-only empty card shows instead. Text is React text
// only; line breaks via pre-line. --site-* roles only, no accent. Server component.
import type { ServicesBlockContent } from "@cds/core/content";
import { RowRenderer } from "../RowRenderer";
import {
  BODY_CLASS,
  HEADING_CLASSES,
  type PublicService,
  type SectionComponentProps,
} from "../types";
import { text } from "../urls";
import { durationText, priceText, readServices } from "./services-team";

/**
 * Editor-only empty card for data-bound blocks (08-05 choice 1). Rendered only when
 * coreData.editorPreview is set, so it never reaches public output.
 */
export function EditorEmptyCard({
  heading,
  body,
  layout,
  background,
}: {
  heading: string;
  body: string;
} & Pick<SectionComponentProps, "layout" | "background">) {
  return (
    <RowRenderer layout={layout} background={background}>
      <div
        data-editor-only=""
        className="flex max-w-[640px] flex-col gap-2 rounded-site-media border border-dashed border-site-border p-6"
      >
        <p className={`${BODY_CLASS} font-semibold text-site-text`}>
          {heading}
        </p>
        <p className={`${BODY_CLASS} text-site-text-muted`}>{body}</p>
      </div>
    </RowRenderer>
  );
}

function cardColumns(n: number): string {
  if (n <= 1) return "grid-cols-1";
  if (n === 2 || n === 4) return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
}

function Meta({
  service,
  showDuration,
}: {
  service: PublicService;
  showDuration: boolean;
}) {
  const duration = showDuration ? durationText(service.duration_minutes) : "";
  return duration ? (
    <p className={`${BODY_CLASS} text-site-text-muted tabular-nums`}>
      {duration}
    </p>
  ) : null;
}

export function ServicesSection({
  content,
  layout,
  background,
  coreData,
}: SectionComponentProps<ServicesBlockContent>) {
  const c = (content ?? {}) as ServicesBlockContent;
  const heading = text(c.heading);
  const all = readServices(coreData);
  const limit = typeof c.limit === "number" && c.limit > 0 ? c.limit : 0;
  const shown = limit ? all.slice(0, limit) : all;
  const showDescriptions = c.show_descriptions !== false;
  const showDurations = c.show_durations !== false;

  if (shown.length === 0) {
    return coreData?.editorPreview === true ? (
      <EditorEmptyCard
        heading="No services showing yet"
        body="Add services in Website › Services and they show here."
        layout={layout}
        background={background}
      />
    ) : null;
  }

  let body;
  if (c.display === "list") {
    body = (
      <ul className="max-w-[768px]">
        {shown.map((s) => {
          const price = priceText(s.price_type, s.price_cents);
          return (
            <li
              key={s.id}
              className="border-t border-site-border py-4 first:border-t-0"
            >
              <div className="flex flex-col gap-x-4 gap-y-1 min-[480px]:flex-row min-[480px]:items-baseline min-[480px]:justify-between">
                <h3 className={`${BODY_CLASS} font-semibold text-site-text`}>
                  {s.name}
                </h3>
                {price ? (
                  <p
                    className={`${BODY_CLASS} shrink-0 font-semibold text-site-text tabular-nums`}
                  >
                    {price}
                  </p>
                ) : null}
              </div>
              <Meta service={s} showDuration={showDurations} />
              {showDescriptions && s.description ? (
                <p
                  className={`${BODY_CLASS} mt-1 whitespace-pre-line text-site-text-muted`}
                >
                  {s.description}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  } else {
    const ground =
      background === "alternate" ? "bg-site-surface" : "bg-site-surface-raised";
    body = (
      <ul className={`grid gap-8 ${cardColumns(shown.length)}`}>
        {shown.map((s) => {
          const price = priceText(s.price_type, s.price_cents);
          const duration = showDurations
            ? durationText(s.duration_minutes)
            : "";
          return (
            <li
              key={s.id}
              className={`${ground} flex flex-col gap-2 rounded-site-media p-6`}
            >
              <h3 className={`${HEADING_CLASSES[3]} text-site-text`}>
                {s.name}
              </h3>
              {price || duration ? (
                <p className={`${BODY_CLASS} tabular-nums`}>
                  {price ? (
                    <span className="font-semibold text-site-text">
                      {price}
                    </span>
                  ) : null}
                  {price && duration ? (
                    <span className="text-site-text-muted"> · </span>
                  ) : null}
                  {duration ? (
                    <span className="text-site-text-muted">{duration}</span>
                  ) : null}
                </p>
              ) : null}
              {showDescriptions && s.description ? (
                <p
                  className={`${BODY_CLASS} whitespace-pre-line text-site-text-muted`}
                >
                  {s.description}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <RowRenderer layout={layout} background={background}>
      <div className="flex flex-col gap-8">
        {/* A blank heading keeps a hidden h2 so the <h3> names never skip a level (WR-C03). */}
        {heading ? (
          <h2 className={`${HEADING_CLASSES[2]} text-site-text`}>{heading}</h2>
        ) : (
          <h2 className="sr-only">Services</h2>
        )}
        {body}
      </div>
    </RowRenderer>
  );
}
