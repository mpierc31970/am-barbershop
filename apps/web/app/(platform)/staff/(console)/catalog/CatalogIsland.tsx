"use client";
// Catalog islands (13-37 choices 2-4; STAFF-07, D5, D161, D264, D-UI-P13-23; 13-UI-SPEC
// "Catalog" lines 834-872). Client wiring for the three panels:
// - ListingsTable: the add-on listings in owner order with Move up / Move down ghost icon
//   buttons per row (moveListingAction); the name opens the editor (`?tab=addons&edit=<slug>`).
// - ListingEditorIsland: ListingEditor over saveListingAction; screenshots upload by XHR-free
//   fetch to /staff/api/catalog/upload (route handler: the 2 MB Server Action cap); Remove is
//   immediate in the editor with an Undo toast, and the delete is sent when the toast ends
//   (or before Save listing), so Undo never has to re-upload.
// - PricesIsland: PriceGrid over previewPriceAction / savePriceAction through useStaffAction
//   (step-up before the case dialog opens).
// - AnnouncementIsland: the current card, then the form (super_admin) with the FromCdsCard
//   preview; Set announcement (CaseDialog "Replace the current announcement?" when one is
//   showing) and End announcement (immediate + Undo, which sets it again with its old end).
// Row and view types mirror the @cds/db read models (client code never imports @cds/db).
import type { AddonPath } from "@cds/core/addons";
import { P13_COPY } from "@cds/core/staff";
import {
  Badge,
  Button,
  IconButton,
  InlineAlert,
  Select,
  TextArea,
  TextField,
  UNDO_TOAST_MS,
  useToast,
} from "@cds/ui/hub";
import { FromCdsCard } from "@cds/ui/hub/today";
import {
  CATALOG_COPY as C,
  CaseDialog,
  ListingEditor,
  PriceGrid,
  StaffTable,
  useStaffAction,
  type ListingEditorView,
  type PriceGroupView,
  type ScreenshotItem,
  type StaffActionResult,
  type StaffColumn,
} from "@cds/ui/staff";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  clearAnnouncementAction,
  moveListingAction,
  previewPriceAction,
  removeScreenshotAction,
  saveListingAction,
  savePriceAction,
  setAnnouncementAction,
} from "../../../../actions/staff/catalog";
import { CATALOG_ADDONS_HREF, listingEditHref } from "./hrefs";

// ---------------------------------------------------------------- listings table

export type ListingRowView = {
  slug: string;
  name: string;
  availability: "available" | "coming_soon" | "hidden";
  private: boolean;
  tagline: string;
  screenshots: number;
  updated: string;
  sort: number;
  first: boolean;
  last: boolean;
};

const AVAILABILITY_TONE = {
  available: "available",
  coming_soon: "coming-soon",
  hidden: "hidden",
} as const;

export function ListingsTable({ rows }: { rows: readonly ListingRowView[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const move = useStaffAction(moveListingAction);

  async function go(row: ListingRowView, dir: "up" | "down") {
    setBusy(row.slug);
    try {
      const r = await move(row.slug, dir);
      if (r.ok) router.refresh();
      else if (r.code !== "session_ended") toast.show({ message: r.message });
    } finally {
      setBusy(null);
    }
  }

  const columns: StaffColumn<ListingRowView>[] = [
    {
      id: "addon",
      header: C.cols.addon,
      cell: (r) => r.name,
      priority: 1,
      primary: true,
    },
    {
      id: "availability",
      header: C.cols.availability,
      cell: (r) =>
        r.private ? (
          <span className="text-hub-ink-muted">{C.alwaysPrivate}</span>
        ) : (
          <Badge tone={AVAILABILITY_TONE[r.availability]}>
            {C.availability[r.availability]}
          </Badge>
        ),
      priority: 1,
      stack: true,
      nowrap: true,
    },
    {
      id: "visibility",
      header: C.cols.visibility,
      cell: (r) => (r.private ? C.visibility.private : C.visibility.public),
      priority: 3,
    },
    {
      id: "tagline",
      header: C.cols.tagline,
      cell: (r) => (
        <span className="line-clamp-1 max-w-[40ch]" title={r.tagline}>
          {r.tagline}
        </span>
      ),
      priority: 2,
    },
    {
      id: "screenshots",
      header: C.cols.screenshots,
      cell: (r) => <span className="tabular-nums">{r.screenshots}</span>,
      priority: 4,
      align: "end",
    },
    {
      id: "updated",
      header: C.cols.updated,
      cell: (r) => r.updated,
      priority: 4,
    },
    {
      id: "sort",
      header: C.cols.sort,
      cell: (r) => <span className="tabular-nums">{r.sort}</span>,
      priority: 4,
      align: "end",
    },
    {
      id: "move",
      header: C.cols.move,
      cell: (r) => (
        <span className="flex justify-end gap-1">
          <IconButton
            label={C.moveUpLabel(r.name)}
            icon={<ArrowUp aria-hidden size={16} />}
            size="sm"
            disabled={r.first || busy !== null}
            onClick={() => void go(r, "up")}
          />
          <IconButton
            label={C.moveDownLabel(r.name)}
            icon={<ArrowDown aria-hidden size={16} />}
            size="sm"
            tooltipAlign="end"
            disabled={r.last || busy !== null}
            onClick={() => void go(r, "down")}
          />
        </span>
      ),
      priority: 1,
      align: "end",
    },
  ];

  return (
    <div className="flex flex-col gap-3 font-hub text-hub-ink">
      <p className="text-sm text-hub-ink-muted">{C.behaviourNote}</p>
      <StaffTable
        caption={C.addonsCaption}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.slug}
        rowLabel={(r) => r.name}
        primaryHref={(r) => listingEditHref(r.slug)}
        shortcutsEnabled={false}
      />
    </div>
  );
}

// ---------------------------------------------------------------- listing editor

async function postScreenshot(
  slug: string,
  file: File,
  alt: string,
): Promise<StaffActionResult<ScreenshotItem>> {
  const form = new FormData();
  form.set("slug", slug);
  form.set("alt", alt);
  form.set("file", file);
  try {
    const res = await fetch("/staff/api/catalog/upload", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    const body = (await res.json().catch(() => ({}))) as {
      screenshot?: ScreenshotItem;
      error?: string;
    };
    if (res.ok && body.screenshot) return { ok: true, data: body.screenshot };
    return {
      ok: false,
      code: "upload_failed",
      message:
        res.status === 401
          ? P13_COPY.SESSION_ENDED
          : (body.error ?? P13_COPY.ERR_SEND),
    };
  } catch {
    return { ok: false, code: "upload_failed", message: P13_COPY.ERR_SEND };
  }
}

type PendingRemove = { timer: ReturnType<typeof setTimeout>; id: string };

export function ListingEditorIsland({
  listing,
  taglineMax,
  descriptionMax,
  screenshotsMax,
}: {
  listing: ListingEditorView;
  taglineMax: number;
  descriptionMax: number;
  screenshotsMax: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const save = useStaffAction(saveListingAction);
  const pending = useRef(new Map<string, PendingRemove>());
  // WR-D02: removes already sent. The toast pauses its own timer on hover and focus, so Undo
  // can be pressed after the timer here fired; it must not restore a deleted screenshot.
  const sent = useRef(new Set<string>());

  const sendRemove = useCallback(
    async (id: string, restore?: () => void) => {
      const p = pending.current.get(id);
      if (p) clearTimeout(p.timer);
      pending.current.delete(id);
      sent.current.add(id);
      let r: StaffActionResult<unknown>;
      try {
        r = await removeScreenshotAction(listing.slug, id);
      } catch {
        // WR-D06: a network drop or a thrown action reads as a failed send.
        r = { ok: false, code: "network", message: P13_COPY.ERR_SEND };
      }
      if (!r.ok) {
        sent.current.delete(id);
        restore?.();
        if (r.message) toast.show({ message: r.message });
      }
    },
    [listing.slug, toast],
  );

  // Leaving the editor sends any remove still waiting on its Undo.
  useEffect(() => {
    const map = pending.current;
    return () => {
      for (const id of [...map.keys()]) void sendRemove(id);
    };
  }, [sendRemove]);

  return (
    <ListingEditor
      listing={listing}
      taglineMax={taglineMax}
      descriptionMax={descriptionMax}
      screenshotsMax={screenshotsMax}
      onSave={async (input) => {
        await Promise.all(
          [...pending.current.keys()].map((id) => sendRemove(id)),
        );
        return save(input);
      }}
      onUpload={(file, alt) => postScreenshot(listing.slug, file, alt)}
      onRemoveScreenshot={(item, restore) => {
        const timer = setTimeout(
          () => void sendRemove(item.id, restore),
          UNDO_TOAST_MS,
        );
        pending.current.set(item.id, { timer, id: item.id });
        toast.show({
          message: C.removed,
          action: {
            label: P13_COPY.UNDO,
            onClick: () => {
              if (sent.current.has(item.id)) {
                toast.show({ message: C.removedAlready });
                return;
              }
              const p = pending.current.get(item.id);
              if (p) clearTimeout(p.timer);
              pending.current.delete(item.id);
              restore();
            },
          },
        });
      }}
      onSaved={(message) => {
        toast.show({ message });
        router.refresh();
      }}
      onDiscard={() => router.push(CATALOG_ADDONS_HREF)}
    />
  );
}

// ---------------------------------------------------------------- prices

export function PricesIsland({
  groups,
  canEdit,
}: {
  groups: readonly PriceGroupView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const preview = useStaffAction(previewPriceAction, {
    describe: () => C.previewPrice,
  });
  const savePrice = useStaffAction(savePriceAction);
  return (
    <PriceGrid
      groups={groups}
      canEdit={canEdit}
      onPreview={(t) => preview(t)}
      onSave={(t) => savePrice(t)}
      onSaved={(message) => {
        toast.show({ message });
        router.refresh();
      }}
    />
  );
}

// ---------------------------------------------------------------- announcement

export type AnnouncementView = {
  title: string;
  body: string;
  href: string;
  paths: AddonPath[];
  /** ISO, or null when open-ended. */
  endsAt: string | null;
  /** "Until 30 Oct" / "No end date" (formatted on the server, business time). */
  untilText: string;
  pathsText: string;
};

function previewCard(title: string, body: string, href: string) {
  return {
    kind: "announcement" as const,
    id: "announcement:preview",
    title,
    text: body,
    link: href ? { label: "Read more", href } : null,
  };
}

export function AnnouncementIsland({
  current,
  canEdit,
}: {
  current: AnnouncementView | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const base = useId();
  const set = useStaffAction(setAnnouncementAction, {
    describe: () => C.setAnnouncement,
  });
  const end = useStaffAction(clearAnnouncementAction, {
    describe: () => C.endAnnouncement,
  });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("");
  const [paths, setPaths] = useState<AddonPath[]>([]);
  const [days, setDays] = useState("14");
  const [error, setError] = useState<{
    message: string;
    field?: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const titleTrim = title.trim();
  const canSet =
    titleTrim.length > 0 && titleTrim.length <= 80 && body.length <= 280;

  function input() {
    return { title, body, href, paths, days: Number(days) };
  }

  async function publish() {
    setPending(true);
    setError(null);
    try {
      const r = await set(input());
      if (r.ok) {
        toast.show({ message: C.annSet });
        setTitle("");
        setBody("");
        setHref("");
        setPaths([]);
        router.refresh();
      } else if (r.code !== "step_up_needed" && r.code !== "session_ended") {
        setError({
          message: r.message,
          ...(r.field ? { field: r.field } : {}),
        });
      }
      return r;
    } finally {
      setPending(false);
    }
  }

  async function endNow() {
    if (!current) return;
    const was = current;
    setPending(true);
    try {
      const r = await end();
      if (!r.ok) {
        if (r.code !== "step_up_needed" && r.code !== "session_ended") {
          toast.show({ message: r.message });
        }
        return;
      }
      router.refresh();
      toast.show({
        message: C.annEnded,
        action: {
          label: P13_COPY.UNDO,
          onClick: () => {
            void set({
              title: was.title,
              body: was.body,
              href: was.href,
              paths: was.paths,
              endsAt: was.endsAt,
            }).then((u) => {
              if (u.ok) router.refresh();
              else if (u.code !== "session_ended") {
                toast.show({ message: u.message });
              }
            });
          },
        },
      });
    } finally {
      setPending(false);
    }
  }

  const fieldError = (f: string) =>
    error?.field === f ? error.message : undefined;

  return (
    <div className="flex max-w-[720px] flex-col gap-8 font-hub text-hub-ink">
      <section className="flex flex-col gap-3" aria-labelledby={`${base}-cur`}>
        <h2 id={`${base}-cur`} className="text-lg font-semibold">
          {C.annCurrent}
        </h2>
        {current ? (
          <>
            <div className="max-w-md">
              <FromCdsCard
                card={previewCard(current.title, current.body, current.href)}
                canDismiss={false}
              />
            </div>
            <p className="text-sm text-hub-ink-muted">
              {current.pathsText} · {current.untilText}
            </p>
            {canEdit ? (
              <div>
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void endNow()}
                >
                  {C.endAnnouncement}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-hub-ink-muted">{C.annEmpty}</p>
        )}
      </section>

      {canEdit ? (
        <form
          className="flex flex-col gap-5"
          aria-labelledby={`${base}-new`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSet || pending) return;
            if (current) setConfirmReplace(true);
            else void publish();
          }}
        >
          <h2 id={`${base}-new`} className="text-lg font-semibold">
            {C.setAnnouncement}
          </h2>
          <TextField
            id={`${base}-title`}
            label={C.annTitle}
            value={title}
            maxLength={80}
            counter={{ value: title.length, max: 80 }}
            error={fieldError("title")}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextArea
            id={`${base}-body`}
            label={C.annBody}
            rows={3}
            value={body}
            maxLength={280}
            counter={{ value: body.length, max: 280 }}
            error={fieldError("body")}
            onChange={(e) => setBody(e.target.value)}
          />
          <TextField
            id={`${base}-href`}
            label={C.annLink}
            value={href}
            maxLength={300}
            inputMode="url"
            helper={C.annLinkHelp}
            error={fieldError("href")}
            onChange={(e) => setHref(e.target.value)}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{C.annPaths}</legend>
            <div className="flex gap-6">
              {(["standard", "studio"] as const).map((p) => (
                <label key={p} className="flex min-h-10 items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-hub-accent"
                    checked={paths.includes(p)}
                    onChange={(e) =>
                      setPaths((cur) =>
                        e.target.checked
                          ? [...cur.filter((x) => x !== p), p]
                          : cur.filter((x) => x !== p),
                      )
                    }
                  />
                  {p === "standard" ? "Standard" : "Studio"}
                </label>
              ))}
            </div>
            <p className="text-sm text-hub-ink-muted">{C.annPathsHelp}</p>
          </fieldset>
          <Select
            id={`${base}-days`}
            label={C.annDays}
            value={days}
            options={C.annDaysOptions}
            error={fieldError("days")}
            onChange={(e) => setDays(e.target.value)}
          />
          {titleTrim ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-hub-ink-muted">
                {C.annPreview}
              </h3>
              <div className="max-w-md">
                <FromCdsCard
                  card={previewCard(titleTrim, body.trim(), href.trim())}
                  canDismiss={false}
                />
              </div>
            </div>
          ) : null}
          {error && !error.field ? (
            <InlineAlert tone="error">{error.message}</InlineAlert>
          ) : null}
          <div>
            <Button type="submit" disabled={!canSet || pending}>
              {C.setAnnouncement}
            </Button>
          </div>
        </form>
      ) : (
        <InlineAlert tone="info">{P13_COPY.SUPER_ONLY}</InlineAlert>
      )}

      <CaseDialog
        open={confirmReplace}
        onClose={() => setConfirmReplace(false)}
        title={C.replaceTitle}
        consequence={C.replaceBody}
        caseRows={
          current
            ? [
                ["Showing now", current.title],
                ["New", titleTrim],
              ]
            : []
        }
        confirmLabel={C.replaceConfirm}
        safeLabel={C.replaceSafe}
        onConfirm={() => publish()}
      />
    </div>
  );
}
