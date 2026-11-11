// IconListSection (07-21; CONT-27, CONT-35; 07-UI-SPEC "Icon list").
//
// A <ul> in auto-fit columns (min 280px, 32px gap), no boxes: a 24px icon in theme primary
// (aria-hidden) beside the title (body 600) and optional text (body, text-muted). Icons map
// through the static ICON_LIST_COMPONENTS table; an unknown id gets Check, never a dynamic
// import (T-07-21-05). Items without a title are skipped; none left renders nothing. The
// heading is an <h2>: only the Hero or the page title owns the page H1. --site-* roles
// only. Server component.
import type { IconListBlockContent, IconListItem } from "@cds/core/content";
import { RowRenderer } from "../RowRenderer";
import {
  BODY_CLASS,
  HEADING_CLASSES,
  type SectionComponentProps,
} from "../types";
import { text } from "../urls";
import { iconListComponent } from "./icon-list-icons";

export function IconListSection({
  content,
  layout,
  background,
}: SectionComponentProps<IconListBlockContent>) {
  const c = (content ?? {}) as IconListBlockContent;
  const items: IconListItem[] = (Array.isArray(c.items) ? c.items : []).filter(
    (i) => !!i && text(i.title) !== "",
  );
  if (items.length === 0) return null;
  const heading = text(c.heading);

  return (
    <RowRenderer layout={layout} background={background}>
      <div className="flex flex-col gap-8">
        {heading && <h2 className={HEADING_CLASSES[2]}>{heading}</h2>}
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-8">
          {items.map((item) => {
            const Icon = iconListComponent(item.icon);
            const body = text(item.text);
            return (
              <li key={item.id} className="flex items-start gap-4">
                <Icon
                  aria-hidden="true"
                  focusable="false"
                  className="mt-[0.15em] size-6 shrink-0 text-site-primary"
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <span
                    className={`${BODY_CLASS} font-semibold text-site-text`}
                  >
                    {text(item.title)}
                  </span>
                  {body && (
                    <span className={`${BODY_CLASS} text-site-text-muted`}>
                      {body}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </RowRenderer>
  );
}
