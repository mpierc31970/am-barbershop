// HoursSection (07-24; CONT-27, D257; 07-UI-SPEC "Business hours", copy 644-645, a11y 683).
//
// Reads the hours, time zone, phone and email live from coreData.business (07-07). Heading
// (<h2>, only when non-blank) -> a reserved one-line "Open now" slot filled by the OpenNow
// island in the visitor's browser (a constant <noscript><style> collapses it without JS)
// -> a real <table> (visually hidden caption, Monday first, today 600, closed rows
// text-muted, tabular-nums) -> "Times are in Central Time". "Today" is computed on the
// server from `now` in the business time zone. No hours: "Contact us for hours." plus
// phone and email links when set. --site-* roles only. Server component.
import {
  hoursRows,
  timeZoneLabel,
  type HoursBlockContent,
} from "@cds/core/content";
import { OpenNow } from "../client/OpenNow";
import { RowRenderer } from "../RowRenderer";
import {
  BODY_CLASS,
  HEADING_CLASSES,
  type SectionComponentProps,
} from "../types";
import { text } from "../urls";
import { businessHasHours, readBusiness, telHref } from "./business";

/** Constant CSS (no owner input): without JS the empty pill slot takes no space. */
export const OPEN_NOW_NOSCRIPT_CSS = "[data-open-now]{display:none}";

const EMAIL = /^[^\s@<>"'?&]+@[^\s@<>"'?&]+\.[^\s@<>"'?&]+$/;
const LINK =
  "text-site-primary underline underline-offset-4 inline-flex min-h-11 items-center";

export function HoursSection({
  content,
  layout,
  background,
  now,
  coreData,
}: SectionComponentProps<HoursBlockContent>) {
  const c = (content ?? {}) as HoursBlockContent;
  const heading = text(c.heading);
  const business = readBusiness(coreData);
  const hours = business?.hours ?? null;
  const tz = business?.timeZone ?? "";

  if (!businessHasHours(hours)) {
    const tel = business ? telHref(business.phone) : "";
    const email =
      business && EMAIL.test(business.publicEmail) ? business.publicEmail : "";
    return (
      <RowRenderer layout={layout} background={background}>
        <div className="flex flex-col gap-4">
          {heading && <h2 className={HEADING_CLASSES[2]}>{heading}</h2>}
          <p className={`${BODY_CLASS} text-site-text`}>
            Contact us for hours.
          </p>
          {tel || email ? (
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              {tel ? (
                <li>
                  <a href={tel} className={`${BODY_CLASS} ${LINK}`}>
                    {business!.phone}
                  </a>
                </li>
              ) : null}
              {email ? (
                <li>
                  <a
                    href={`mailto:${email}`}
                    className={`${BODY_CLASS} ${LINK}`}
                  >
                    {email}
                  </a>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      </RowRenderer>
    );
  }

  const rows = hoursRows(hours, tz, now ?? new Date());
  const zone = timeZoneLabel(tz);
  const showPill = c.show_open_now !== false && tz !== "";

  return (
    <RowRenderer layout={layout} background={background}>
      <div className="flex max-w-[640px] flex-col gap-4">
        {heading && <h2 className={HEADING_CLASSES[2]}>{heading}</h2>}
        {showPill ? (
          <>
            <div data-open-now="" className="min-h-[44px]">
              <OpenNow hours={hours!} timeZone={tz} />
            </div>
            <noscript>
              <style>{OPEN_NOW_NOSCRIPT_CSS}</style>
            </noscript>
          </>
        ) : null}
        <table className={`${BODY_CLASS} w-full border-collapse text-left`}>
          <caption className="sr-only">Opening hours</caption>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.day}
                className={`border-b border-site-border last:border-b-0 ${
                  r.closed ? "text-site-text-muted" : "text-site-text"
                }`}
              >
                <th
                  scope="row"
                  className={`py-2 pr-6 align-top ${
                    r.today ? "font-semibold" : "font-normal"
                  }`}
                >
                  {r.label}
                </th>
                <td
                  className={`py-2 tabular-nums ${r.today ? "font-semibold" : ""}`}
                >
                  {r.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {zone ? (
          <p className={`${BODY_CLASS} text-site-text-muted`}>
            Times are in {zone}
          </p>
        ) : null}
      </div>
    </RowRenderer>
  );
}
