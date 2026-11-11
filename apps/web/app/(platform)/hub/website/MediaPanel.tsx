"use client";
// Website › Media client panel (07-17; CONT-14, CONT-18, CONT-19, CONT-21, CONT-35, D275,
// D280, D311, D-UI-P7-4/5/7/8/9; 07-UI-SPEC "Media"; choices 1, 5, 7, 8, 9). Wires the media
// actions and the MediaSource into the @cds/ui media components. Owner-hub pattern (D311):
// list first, a drawer for the record, one primary per view (Upload files; while the library
// is empty, the empty state's Upload files is the one primary, P5 R2).
//   - Filter and search live in the URL (type=, q=) and replace it inside a transition: the
//     grid dims and is aria-busy until the server answers. Load more appends the next 60
//     through the source.
//   - The drawer is URL-led on `asset`: local state opens it at once from the tile, then the
//     URL loads Used on. Close removes the key.
//   - Uploads run through useMediaUploads; each finished file is fetched and put first in the
//     grid, and a batch with photos toasts "N photos uploaded…" with Describe them (8 s).
//   - Polling (D-UI-P7-8): every 10 s only while a video is waiting or optimizing; each video
//     that turns ready is announced once ("NAME is ready.") through the toast region.
//   - Read-only roles get no Upload, Save, Delete, Try again, captions or cover controls; the
//     chokepoint refuses their writes regardless (T-07-17-07).
//   - 10-43 (BILL-13, D222, D225, D285; T-10-43-01/02): at 100%, when the server view says the
//     viewer can buy (Owner, not impersonating), Upload files becomes the pack buttons
//     ("Add 5 GB for {catalog price}/mo" primary, 25 GB secondary; WR-D05) with USAGE-FULL-PACKS under the meter.
//     A click loads the server preview (packPreviewAction) into ChargeConfirmDialog; confirming
//     runs buyPackAction on the saved card, then router.refresh() re-reads the usage view so
//     Upload files returns without a full reload. No second purchase path (10-29's actions).
import {
  Button,
  DescribeList,
  IconButton,
  InlineAlert,
  MEDIA_COPY,
  MEDIA_PAGE_SIZE,
  MEDIA_POLL_MS,
  MediaDetailDrawer,
  MediaDropZone,
  MediaFilters,
  MediaGrid,
  MediaPicker,
  MediaUploadButton,
  TrainingDrawer,
  UsageMeter,
  fetchMediaSource,
  isVideoPolling,
  mediaDeletedToast,
  mediaUploadedToast,
  sendXhr,
  useMediaUploads,
  useToast,
  videoReadyToast,
  type DescribeRowView,
  type LibraryItemView,
  type LibraryPageView,
  type MediaFilterPatch,
  type MediaSource,
  type MediaUsageView,
  type MediaUsedOnView,
  type PickedMedia,
  type VideoStateView,
} from "@cds/ui/hub";
import {
  ChargeConfirmDialog,
  type ChargePreview,
  type ChargeResult,
} from "@cds/ui/hub/billing";
import { CircleHelp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  deleteLibraryMediaAction,
  retryVideoAction,
  setVideoCoverAction,
} from "../../../actions/media";
import { buyPackAction, packPreviewAction } from "../../../actions/billing";
import { CARD_HREF, PREVIEW_FAILED } from "../settings/billing-copy";
import { GuardedLink } from "../GuardedLink";
import { MEDIA_STEPS, MEDIA_TITLE } from "./media-steps";
import { mediaFiltered, mediaHref, type MediaParams } from "./media-params";

export interface MediaPanelProps {
  page: LibraryPageView;
  usage: MediaUsageView;
  params: MediaParams;
  open: { item: LibraryItemView; usedOn: MediaUsedOnView } | null;
  /** Set only on `&view=describe`. */
  describeRows: DescribeRowView[] | null;
  canWrite: boolean;
  timeZone: string;
  /** The file in the URL is gone (deleted, or not this org's). */
  gone: boolean;
  /** Test seam; the hub uses fetchMediaSource. */
  source?: MediaSource;
}

type Local = { id: string; item: LibraryItemView | null } | null;
type PackSize = "5gb" | "25gb";

const pageHref = (id: string) => `/hub/website/pages/${encodeURIComponent(id)}`;

function captionsUrl(id: string): string {
  return `/hub/api/media/captions?${new URLSearchParams([["asset", id]]).toString()}`;
}

function sentence(v: unknown, fallback: string): string {
  return typeof v === "string" && v.includes(" ") ? v : fallback;
}

export function MediaPanel(props: MediaPanelProps) {
  const {
    page,
    usage,
    params,
    open,
    describeRows,
    canWrite,
    timeZone,
    gone,
    source = fetchMediaSource,
  } = props;
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState<LibraryItemView[]>(page.items);
  const [pageNo, setPageNo] = useState(page.page);
  const [total, setTotal] = useState(page.total);
  const [seenPage, setSeenPage] = useState(page);
  const [loadingMore, setLoadingMore] = useState(false);
  const [local, setLocal] = useState<Local>(() =>
    params.asset && !gone
      ? { id: params.asset, item: open?.item ?? null }
      : null,
  );
  const [seenAsset, setSeenAsset] = useState(params.asset);
  const [training, setTraining] = useState(false);
  const [coverFor, setCoverFor] = useState<string | null>(null);
  const [packSize, setPackSize] = useState<PackSize | null>(null);
  const [packPreview, setPackPreview] = useState<ChargePreview | null>(null);
  const packSeq = useRef(0);
  const announced = useRef(new Set<string>());
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });

  // A fresh server page (filter, search, refresh) replaces the list.
  if (seenPage !== page) {
    setSeenPage(page);
    setItems(page.items);
    setPageNo(page.page);
    setTotal(page.total);
  }
  // The URL's asset changed under us (Back): follow it.
  if (params.asset !== seenAsset) {
    setSeenAsset(params.asset);
    if (!params.asset || gone) setLocal(null);
    else if (local?.id !== params.asset) {
      setLocal({
        id: params.asset,
        item: items.find((i) => i.id === params.asset) ?? open?.item ?? null,
      });
    }
  }

  function go(href: string) {
    startTransition(() => router.replace(href, { scroll: false }));
  }

  // ---- Polling (D-UI-P7-8) ----
  const states: Record<string, VideoStateView> = {};
  for (const i of items) {
    if (i.kind === "video" && i.videoState) states[i.id] = i.videoState;
  }
  const pollKey = isVideoPolling(states)
    ? Object.keys(states)
        .filter((id) => states[id] === "waiting" || states[id] === "optimizing")
        .join(",")
    : "";

  useEffect(() => {
    if (pollKey === "") return;
    const ids = pollKey.split(",");
    const timer = setInterval(() => {
      void source.states(ids).then((res) => {
        if (!res.ok) return;
        const cur = itemsRef.current;
        const ready: LibraryItemView[] = [];
        const next = cur.map((i) => {
          const s = res.data[i.id];
          if (!s || s === i.videoState) return i;
          if (s === "ready") ready.push(i);
          return { ...i, videoState: s };
        });
        setItems(next);
        for (const v of ready) {
          if (announced.current.has(v.id)) continue;
          announced.current.add(v.id);
          toast.show({ message: videoReadyToast(v.name) });
        }
        if (ready.length > 0) router.refresh();
      });
    }, MEDIA_POLL_MS);
    return () => clearInterval(timer);
  }, [pollKey, source, toast, router]);

  // ---- Uploads ----
  const uploads = useMediaUploads({
    onUploaded: (assetId) => {
      void source.items([assetId]).then((res) => {
        if (!res.ok) return;
        setItems((list) => [
          ...res.data,
          ...list.filter((x) => !res.data.some((n) => n.id === x.id)),
        ]);
      });
    },
    onBatchDone: (summary) => {
      router.refresh();
      if (summary.images > 0) {
        toast.show({
          message: mediaUploadedToast(summary.images),
          action: {
            label: MEDIA_COPY.describeThem,
            onClick: () =>
              router.push(mediaHref(params, { view: "describe", asset: null })),
          },
          durationMs: 8000,
        });
      }
    },
  });

  // ---- Grid ----
  async function loadMore() {
    setLoadingMore(true);
    const res = await source.list({
      filter: params.type,
      q: params.q,
      page: pageNo + 1,
      perPage: MEDIA_PAGE_SIZE,
    });
    setLoadingMore(false);
    if (!res.ok) {
      toast.show({ message: res.message });
      return;
    }
    setItems((list) => [
      ...list,
      ...res.data.page.items.filter((i) => !list.some((x) => x.id === i.id)),
    ]);
    setPageNo(res.data.page.page);
    setTotal(res.data.page.total);
  }

  function onFilter(patch: MediaFilterPatch) {
    go(
      mediaHref(params, {
        ...(patch.filter !== undefined ? { type: patch.filter } : {}),
        ...(patch.q !== undefined ? { q: patch.q } : {}),
        asset: null,
      }),
    );
  }

  function openAsset(id: string) {
    setLocal({ id, item: items.find((i) => i.id === id) ?? null });
    setSeenAsset(id);
    router.replace(mediaHref(params, { asset: id }), { scroll: false });
  }

  function closeDrawer() {
    setLocal(null);
    setSeenAsset(undefined);
    router.replace(mediaHref(params, { asset: null }), { scroll: false });
  }

  function patchItem(id: string, p: Partial<LibraryItemView>) {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)));
    setLocal((l) =>
      l && l.id === id && l.item ? { ...l, item: { ...l.item, ...p } } : l,
    );
  }

  async function retry(id: string) {
    const res = await retryVideoAction(id);
    if (!res.ok) {
      toast.show({ message: res.message });
      return;
    }
    announced.current.delete(id);
    patchItem(id, { videoState: "waiting" });
    toast.show({ message: MEDIA_COPY.optimizingAgain });
    router.refresh();
  }

  async function remove(id: string) {
    const kind = items.find((i) => i.id === id)?.kind ?? local?.item?.kind;
    const res = await deleteLibraryMediaAction(id);
    if (!res.ok) {
      toast.show({ message: res.message });
      return;
    }
    toast.show({ message: mediaDeletedToast(kind ?? "image") });
    setItems((list) => list.filter((i) => i.id !== id));
    if (local?.id === id) closeDrawer();
    router.refresh();
  }

  // ---- Drawer ----
  const drawerItem =
    local === null
      ? null
      : open && open.item.id === local.id
        ? { ...open.item, ...pickFresh(open.item, local.item) }
        : local.item;
  const usedOn =
    local !== null && open && open.item.id === local.id ? open.usedOn : null;

  async function describe(id: string, alt: string) {
    const res = await source.describe([{ id, alt }]);
    if (res.ok) {
      patchItem(id, { alt, needsDescription: false });
      toast.show({ message: MEDIA_COPY.descriptionSaved });
      router.refresh();
    }
    return res;
  }

  async function captions(file: File | null) {
    if (!local) return;
    const id = local.id;
    try {
      const res = await sendXhr(
        file
          ? {
              method: "PUT",
              url: captionsUrl(id),
              headers: { "Content-Type": "text/vtt" },
              body: file,
            }
          : { method: "DELETE", url: captionsUrl(id) },
      );
      if (res.status < 200 || res.status >= 300) {
        toast.show({ message: sentence(res.json.error, MEDIA_COPY.captions) });
        return;
      }
      patchItem(id, { hasCaptions: file !== null });
      toast.show({
        message: file ? MEDIA_COPY.captionsSaved : MEDIA_COPY.captionsRemoved,
      });
      router.refresh();
    } catch {
      toast.show({ message: MEDIA_COPY.failed });
    }
  }

  async function setCover(videoId: string, imageId: string | null) {
    const res = await setVideoCoverAction(videoId, imageId);
    if (!res.ok) {
      toast.show({ message: res.message });
      return;
    }
    patchItem(videoId, { customCover: imageId !== null });
    toast.show({ message: MEDIA_COPY.coverSaved });
    router.refresh();
  }

  // ---- Storage packs at the limit (10-43) ----
  async function openPack(size: PackSize) {
    const seq = ++packSeq.current;
    setPackSize(size);
    setPackPreview(null);
    const res = await packPreviewAction(size).catch(() => null);
    if (seq !== packSeq.current) return;
    if (res && res.ok) {
      setPackPreview(res.preview);
      return;
    }
    setPackSize(null);
    toast.show({ message: res?.message || PREVIEW_FAILED });
  }

  function closePack() {
    packSeq.current++;
    setPackSize(null);
    setPackPreview(null);
  }

  async function confirmPack(token: string): Promise<ChargeResult> {
    if (!packSize) {
      return { ok: false, reason: "error", message: PREVIEW_FAILED };
    }
    const res = await buyPackAction(packSize, token);
    if (res.ok) router.refresh();
    return res;
  }

  const offers = usage.offers ?? [];
  const buying =
    canWrite &&
    usage.level === "full" &&
    usage.canBuy === true &&
    offers.length > 0;

  const filtered = mediaFiltered(params);
  const hasMore = pageNo * page.perPage < total;
  const empty = items.length === 0 && uploads.tiles.length === 0 && !filtered;
  const describing = params.view === "describe" && describeRows !== null;

  return (
    <div className="flex flex-col gap-6 font-hub" data-media-panel="">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl leading-tight font-semibold text-hub-ink">
            {MEDIA_COPY.title}
          </h2>
          <IconButton
            label={MEDIA_TITLE}
            onClick={() => setTraining(true)}
            icon={<CircleHelp aria-hidden size={20} strokeWidth={2} />}
          />
        </div>
        {buying ? (
          <div
            className="flex flex-wrap items-center gap-3"
            data-pack-offers=""
          >
            {offers.map((o, i) => (
              <Button
                key={o.size}
                variant={i === 0 ? "primary" : "secondary"}
                data-pack-offer={o.size}
                onClick={() => void openPack(o.size)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        ) : canWrite && !empty && !describing ? (
          <div data-tour="media-upload">
            <MediaUploadButton usage={usage} onFiles={uploads.add} />
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2" data-tour="media-meter">
        <UsageMeter usage={usage} />
        {buying ? (
          <p
            className="max-w-[68ch] text-sm text-hub-ink-muted"
            data-usage-full=""
          >
            {usage.message}
          </p>
        ) : null}
      </div>
      {gone ? <InlineAlert tone="info">{MEDIA_COPY.gone}</InlineAlert> : null}

      {describing ? (
        <DescribeList
          rows={describeRows}
          onSave={async (entries) => {
            const res = await source.describe(entries);
            if (res.ok) router.refresh();
            return res;
          }}
          backHref={mediaHref(params, { view: null })}
          LinkComponent={GuardedLink}
        />
      ) : (
        <>
          <MediaFilters
            filter={params.type}
            q={params.q}
            counts={page.counts}
            needsDescription={page.needsDescription}
            describeHref={mediaHref(params, { view: "describe", asset: null })}
            LinkComponent={GuardedLink}
            onChange={onFilter}
          />
          <div data-tour={items.length > 0 ? "media-grid" : undefined}>
            <MediaGrid
              items={items}
              uploads={uploads.tiles}
              filtered={filtered}
              hasMore={hasMore}
              loadingMore={loadingMore}
              canWrite={canWrite}
              busy={pending}
              onLoadMore={() => void loadMore()}
              onOpen={openAsset}
              onRetry={(id) => void retry(id)}
              onRemove={(id) => void remove(id)}
              onStop={uploads.stop}
              onRemoveUpload={uploads.remove}
              onClearFilters={() =>
                go(mediaHref(params, { type: "all", q: null }))
              }
              onFiles={uploads.add}
              emptyAction={
                usage.level === "full" ? (
                  <MediaUploadButton usage={usage} onFiles={uploads.add} />
                ) : (
                  <div
                    className="flex flex-col items-start gap-4"
                    data-tour="media-upload"
                  >
                    <MediaDropZone onFiles={uploads.add} />
                    <MediaUploadButton usage={usage} onFiles={uploads.add} />
                  </div>
                )
              }
            />
          </div>
        </>
      )}

      <MediaDetailDrawer
        open={local !== null}
        item={drawerItem}
        usedOn={usedOn}
        canWrite={canWrite}
        timeZone={timeZone}
        onClose={closeDrawer}
        onDescribe={describe}
        onDelete={(id) => remove(id)}
        onCaptions={(file) => captions(file)}
        onChooseCover={() => local && setCoverFor(local.id)}
        onResetCover={() => local && void setCover(local.id, null)}
        pageHref={pageHref}
        LinkComponent={GuardedLink}
      />
      {canWrite ? (
        <MediaPicker
          open={coverFor !== null}
          kind="image"
          source={source}
          onUse={(picked: PickedMedia[]) => {
            const img = picked[0];
            if (coverFor && img) void setCover(coverFor, img.id);
          }}
          onClose={() => setCoverFor(null)}
        />
      ) : null}
      {buying || packSize !== null ? (
        <ChargeConfirmDialog
          open={packSize !== null}
          preview={packPreview}
          onConfirm={confirmPack}
          onClose={closePack}
          updateCardHref={CARD_HREF}
        />
      ) : null}
      <TrainingDrawer
        open={training}
        onClose={() => setTraining(false)}
        title={MEDIA_TITLE}
        steps={MEDIA_STEPS}
      />
    </div>
  );
}

/** Local edits (description, captions, cover, state) win over the server-loaded copy. */
function pickFresh(
  server: LibraryItemView,
  local: LibraryItemView | null,
): Partial<LibraryItemView> {
  if (!local) return {};
  return {
    alt: local.alt,
    needsDescription: local.needsDescription,
    ...(local.hasCaptions !== undefined
      ? { hasCaptions: local.hasCaptions }
      : {}),
    ...(local.customCover !== undefined
      ? { customCover: local.customCover }
      : {}),
    ...((local.videoState ?? server.videoState)
      ? { videoState: local.videoState ?? server.videoState }
      : {}),
  };
}
