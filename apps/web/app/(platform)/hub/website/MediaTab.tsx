// Website › Media (07-17 replaces the 07-03 shell; CONT-14, CONT-19, CONT-21, CONT-35, D280,
// D278, D311, D-UI-P7-4/5/7/8/9; 07-UI-SPEC "Media"; T-07-17-01, T-07-17-07).
// Server panel: reads the first library page (60, newest first), the usage meter, the page's
// video states and the business time zone; with `&asset=<id>` the open file and where it is
// used; with `&view=describe` the photos still missing a description. Then it hands plain
// props to MediaPanel. The org comes only from the session, and every URL value goes through
// parseMediaParams first (unknown values dropped, never thrown). A file in the URL that is gone
// shows the GONE alert over the list; any other failure rethrows so website/page.tsx shows
// ERR-LOAD. Read-only roles (content read) get no write controls (canWrite false).
import { NotFound, can } from "@cds/core";
import {
  getBusinessProfile,
  getLibraryItem,
  listLibrary,
  listMediaNeedingDescription,
  mediaUsage,
  mediaUsedOn,
  videoStates,
  type OrgContext,
} from "@cds/db";
import {
  MEDIA_PAGE_SIZE,
  type LibraryItemView,
  type MediaUsedOnView,
} from "@cds/ui/hub";
import type { JSX } from "react";
import { mediaUsageView } from "../../../../lib/media-usage-view";
import { SECTION_REGISTRY } from "../../../../lib/section-registry";
import { requireHubSession } from "../../../../lib/session";
import { TourHost } from "../TourHost";
import { tourState } from "../tour-slot";
import { MediaPanel } from "./MediaPanel";
import { parseMediaParams } from "./media-params";

export type SearchParams = Record<string, string | string[] | undefined>;

/** The business's time zone; UTC when it can't be read. */
async function timeZoneOf(ctx: OrgContext): Promise<string> {
  try {
    const profile = await getBusinessProfile(ctx);
    return profile.time_zone || "UTC";
  } catch {
    return "UTC";
  }
}

export async function MediaTab(
  searchParams: SearchParams,
): Promise<JSX.Element> {
  const { ctx } = await requireHubSession();
  const params = parseMediaParams(searchParams);
  const canWrite = can(ctx, "content", "write");

  const [page, usage, timeZone, describe] = await Promise.all([
    listLibrary(ctx, {
      filter: params.type,
      q: params.q,
      page: 1,
      perPage: MEDIA_PAGE_SIZE,
    }),
    mediaUsage(ctx),
    timeZoneOf(ctx),
    params.view === "describe"
      ? listMediaNeedingDescription(ctx, { limit: 200 })
      : Promise.resolve(null),
  ]);

  const videoIds = page.items
    .filter((i) => i.kind === "video")
    .map((i) => i.id);
  const states = videoIds.length > 0 ? await videoStates(ctx, videoIds) : {};

  let open: { item: LibraryItemView; usedOn: MediaUsedOnView } | null = null;
  let gone = false;
  if (params.asset) {
    try {
      const [item, usedOn] = await Promise.all([
        getLibraryItem(ctx, params.asset),
        mediaUsedOn(ctx, params.asset, SECTION_REGISTRY),
      ]);
      const state =
        item.kind === "video"
          ? (await videoStates(ctx, [item.id]))[item.id]
          : undefined;
      open = { item: state ? { ...item, videoState: state } : item, usedOn };
    } catch (err) {
      if (err instanceof NotFound) gone = true;
      else throw err;
    }
  }

  const tour = await tourState(ctx, "media");
  return (
    <>
      <MediaPanel
        page={{
          ...page,
          items: page.items.map((i) =>
            i.kind === "video" && states[i.id]
              ? { ...i, videoState: states[i.id] }
              : i,
          ),
        }}
        usage={await mediaUsageView(usage, ctx)}
        params={params}
        open={open}
        describeRows={describe ? describe.items : null}
        canWrite={canWrite}
        timeZone={timeZone}
        gone={gone}
      />
      {/* 11-48 (DASH-17, D208): first-use tour `media` (Upload files, a file, storage). */}
      {tour ? <TourHost tourId="media" autoStart={tour.autoStart} /> : null}
    </>
  );
}
