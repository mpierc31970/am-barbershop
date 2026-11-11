"use client";
// MediaDetailDrawer: one file's record (07-17; CONT-14, CONT-18, CONT-35, D275, D280, D311;
// 07-UI-SPEC "Media detail drawer", "Destructive actions"; choices 7-9). Right Drawer 480px,
// title = file name:
//   preview (photo 960px contain / <video controls> with poster / <audio controls>), a <dl>
//   (Size · Dimensions or Length · Added · Used on page links), Description (photos; required,
//   /250, Save description is the drawer's one primary, disabled until changed), Captions and
//   Cover (videos), MOVE-TO-YOUTUBE (only when the tab passes it), and ghost-danger Delete.
// Delete opens a danger Dialog with Keep autofocused; its body is the "keeps showing" copy when
// the file is used anywhere (Used on, kept versions, pop-ups, a video cover, a setup slot),
// else the "deleted for good" copy (choice 7). Read-only roles see no write controls; the
// chokepoint refuses their writes regardless (T-07-17-07). Names render as text only.
import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useState,
  type AnchorHTMLAttributes,
  type ComponentType,
} from "react";
import type { HubActionResult } from "./addon-types";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Drawer } from "./Drawer";
import { IconButton } from "./IconButton";
import { InlineAlert } from "./feedback";
import { TextArea } from "./fields";
import { MediaDropZone } from "./MediaDropZone";
import { formatWhen } from "./contacts/copy";
import {
  MEDIA_COPY,
  MEDIA_LIMITS,
  deleteLabel,
  deleteTitle,
  formatDuration,
  keepLabel,
  tileSize,
  type LibraryItemView,
  type UsedOnView,
} from "./media/copy";

const ALT_MAX = 250;

export interface MediaDetailDrawerProps {
  open: boolean;
  item: LibraryItemView | null;
  /** null while Used on is loading. */
  usedOn: UsedOnView | null;
  canWrite: boolean;
  timeZone: string;
  onClose(): void;
  onDescribe(id: string, alt: string): Promise<HubActionResult<unknown>>;
  onDelete(id: string): void | Promise<void>;
  /** A .vtt file to set or replace, or null to remove. */
  onCaptions?(file: File | null): void | Promise<unknown>;
  onChooseCover?(): void;
  onResetCover?(): void;
  pageHref(pageId: string): string;
  LinkComponent?: ComponentType<
    AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
  >;
  /** Choice 9: off until Bunny delivery stats exist (07-10). */
  moveToYouTube?: boolean;
}

/** Used anywhere a delete would break (D275 soft delete). */
export function mediaIsUsed(u: UsedOnView | null): boolean {
  if (!u) return true;
  return (
    u.pages.length > 0 ||
    u.inVersions ||
    u.inPopups ||
    Boolean(u.asCover) ||
    Boolean(u.intakeSlot)
  );
}

function isVtt(file: File): boolean {
  const okType =
    /\.vtt$/i.test(file.name) || (file.type || "").toLowerCase() === "text/vtt";
  return okType && file.size > 0 && file.size <= MEDIA_LIMITS.captions;
}

function Body(props: MediaDetailDrawerProps & { item: LibraryItemView }) {
  const {
    item,
    usedOn,
    canWrite,
    timeZone,
    onClose,
    onDescribe,
    onDelete,
    onCaptions,
    onChooseCover,
    onResetCover,
    pageHref,
    LinkComponent,
    moveToYouTube,
  } = props;
  const Link = LinkComponent ?? "a";
  const titleId = useId();
  const altId = useId();
  const [alt, setAlt] = useState(item.alt);
  const [savedAlt, setSavedAlt] = useState(item.alt);
  const [altError, setAltError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [captionsError, setCaptionsError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const keepId = useId();
  const write = canWrite && !item.deleted;

  // The confirm stays mounted, so its safe choice is focused when it opens (not autoFocus).
  useEffect(() => {
    if (!confirming) return;
    document
      .querySelector<HTMLElement>(`[data-keep-media="${CSS.escape(keepId)}"]`)
      ?.focus();
  }, [confirming, keepId]);
  const dirty = alt !== savedAlt;
  const needs = item.kind === "image" && savedAlt.trim() === "";

  async function save() {
    const v = alt.trim();
    if (v === "") {
      setAltError(MEDIA_COPY.altMissing);
      return;
    }
    setAltError(null);
    setSaving(true);
    const res = await onDescribe(item.id, v);
    setSaving(false);
    if (res.ok) {
      setSavedAlt(v);
      setAlt(v);
    } else {
      setAltError(res.message);
    }
  }

  function takeCaptions(files: File[]) {
    const f = files[0];
    if (!f) return;
    if (!isVtt(f)) {
      setCaptionsError(MEDIA_COPY.captions);
      return;
    }
    setCaptionsError(null);
    void onCaptions?.(f);
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await onDelete(item.id);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  const dims =
    item.kind === "image"
      ? item.width > 0
        ? `${item.width} × ${item.height}`
        : "—"
      : item.durationS > 0
        ? formatDuration(item.durationS)
        : "—";

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
        <h2
          id={titleId}
          className="min-w-0 truncate text-xl leading-tight font-semibold"
          title={item.name}
        >
          {item.name}
        </h2>
        <IconButton
          label="Close"
          tooltipAlign="end"
          onClick={onClose}
          icon={<X aria-hidden size={20} strokeWidth={2} />}
        />
      </div>
      <div className="flex flex-1 flex-col gap-6 px-6 py-6">
        {item.deleted ? (
          <InlineAlert tone="info">{MEDIA_COPY.deletedLabel}</InlineAlert>
        ) : null}
        <div className="flex items-center justify-center overflow-hidden rounded bg-hub-surface-2">
          {item.kind === "image" ? (
            <img
              src={item.previewUrl}
              alt={savedAlt}
              className="max-h-80 w-full object-contain"
            />
          ) : item.kind === "video" ? (
            item.videoState && item.videoState !== "ready" ? (
              <p className="p-6 text-sm text-hub-ink-muted">
                {item.videoState === "waiting"
                  ? MEDIA_COPY.videoWaiting
                  : item.videoState === "optimizing"
                    ? MEDIA_COPY.videoProcessing
                    : item.videoState === "failed"
                      ? MEDIA_COPY.videoFailed
                      : MEDIA_COPY.videoFailedFinal}
              </p>
            ) : (
              <video
                controls
                preload="metadata"
                poster={item.posterUrl ?? undefined}
                src={item.previewUrl}
                className="max-h-80 w-full"
              />
            )
          ) : (
            <audio controls src={item.previewUrl} className="w-full p-4" />
          )}
        </div>
        {moveToYouTube && item.kind === "video" ? (
          <InlineAlert tone="info">{MEDIA_COPY.moveToYouTube}</InlineAlert>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-hub-ink-muted">Size</dt>
          <dd className="tabular-nums">{tileSize(item.bytes)}</dd>
          <dt className="text-hub-ink-muted">
            {item.kind === "image" ? "Dimensions" : "Length"}
          </dt>
          <dd className="tabular-nums">{dims}</dd>
          <dt className="text-hub-ink-muted">Added</dt>
          <dd className="tabular-nums">
            {formatWhen(item.createdAt, timeZone) || "—"}
          </dd>
          <dt className="text-hub-ink-muted">Used on</dt>
          <dd data-used-on="">
            {usedOn === null ? (
              <span className="text-hub-ink-muted">Checking…</span>
            ) : usedOn.pages.length === 0 ? (
              <span className="text-hub-ink-muted">{MEDIA_COPY.notUsed}</span>
            ) : (
              usedOn.pages.map((p, i) => (
                <span key={p.id}>
                  {i > 0 ? ", " : ""}
                  <Link
                    href={pageHref(p.id)}
                    className="rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
                  >
                    {p.title}
                  </Link>
                </span>
              ))
            )}
          </dd>
        </dl>

        {item.kind === "image" ? (
          write ? (
            <TextArea
              id={altId}
              label={MEDIA_COPY.descriptionLabel}
              labelExtra={
                needs ? (
                  <Badge tone="needs-description">Needs description</Badge>
                ) : undefined
              }
              helper={MEDIA_COPY.altHelper}
              error={altError ?? undefined}
              rows={2}
              required
              maxLength={ALT_MAX}
              counter={{ value: alt.length, max: ALT_MAX }}
              value={alt}
              onChange={(e) => setAlt(e.currentTarget.value)}
            />
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">
                {MEDIA_COPY.descriptionLabel}
              </span>
              {needs ? (
                <Badge tone="needs-description">Needs description</Badge>
              ) : (
                <p>{savedAlt}</p>
              )}
            </div>
          )
        ) : null}

        {item.kind === "video" && write ? (
          <section
            className="flex flex-col gap-2"
            aria-label={MEDIA_COPY.captionsLabel}
          >
            <h3 className="text-sm font-semibold">
              {MEDIA_COPY.captionsLabel}
            </h3>
            {item.hasCaptions ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>captions.vtt</span>
                <label className="cursor-pointer rounded px-2 py-1 font-semibold text-hub-ink underline underline-offset-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-hub-accent">
                  Replace
                  <input
                    type="file"
                    accept=".vtt,text/vtt"
                    className="sr-only"
                    onChange={(e) => {
                      const files = Array.from(e.currentTarget.files ?? []);
                      e.currentTarget.value = "";
                      takeCaptions(files);
                    }}
                  />
                </label>
                <span aria-hidden>·</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void onCaptions?.(null)}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <MediaDropZone
                compact
                multiple={false}
                accept=".vtt,text/vtt"
                prompt="Drop a .vtt file here, or"
                chooseLabel="choose a file"
                onFiles={takeCaptions}
              />
            )}
            <p className="text-sm text-hub-ink-muted">
              {MEDIA_COPY.captionsHelper}
            </p>
            {captionsError ? (
              <p role="alert" className="text-sm text-hub-danger">
                {captionsError}
              </p>
            ) : null}
          </section>
        ) : null}

        {item.kind === "video" && write ? (
          <section
            className="flex flex-col gap-2"
            aria-label={MEDIA_COPY.coverLabel}
          >
            <h3 className="text-sm font-semibold">{MEDIA_COPY.coverLabel}</h3>
            <div className="flex items-center gap-4">
              {item.posterUrl ? (
                <img
                  src={item.posterUrl}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded object-cover"
                />
              ) : null}
              <div className="flex flex-col items-start gap-1">
                <Button variant="secondary" size="sm" onClick={onChooseCover}>
                  {MEDIA_COPY.chooseCover}
                </Button>
                {item.customCover ? (
                  <Button variant="ghost" size="sm" onClick={onResetCover}>
                    {MEDIA_COPY.generatedCover}
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>
      {write ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hub-border px-6 py-4">
          <Button
            variant="ghost"
            className="text-hub-danger"
            onClick={() => setConfirming(true)}
          >
            {deleteLabel(item.kind)}
          </Button>
          {item.kind === "image" ? (
            <Button
              variant="primary"
              disabled={!dirty}
              loading={saving}
              loadingLabel="Saving…"
              onClick={() => void save()}
            >
              {MEDIA_COPY.saveDescription}
            </Button>
          ) : null}
        </div>
      ) : null}
      {write ? (
        <Dialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title={deleteTitle(item.name)}
          footer={
            <>
              <Button
                variant="secondary"
                data-keep-media={keepId}
                onClick={() => setConfirming(false)}
              >
                {keepLabel(item.kind)}
              </Button>
              <Button
                variant="destructive"
                loading={deleting}
                loadingLabel="Deleting…"
                onClick={() => void confirmDelete()}
              >
                {deleteLabel(item.kind)}
              </Button>
            </>
          }
        >
          <p data-delete-body="">
            {mediaIsUsed(usedOn)
              ? MEDIA_COPY.deleteUsedBody
              : MEDIA_COPY.deleteUnusedBody}
          </p>
        </Dialog>
      ) : null}
    </>
  );
}

export function MediaDetailDrawer(props: MediaDetailDrawerProps) {
  const { open, item, onClose } = props;
  return (
    <Drawer
      open={open && item !== null}
      onClose={onClose}
      label={item?.name ?? "Media"}
      side="right"
    >
      {item ? <Body key={item.id} {...props} item={item} /> : null}
    </Drawer>
  );
}
