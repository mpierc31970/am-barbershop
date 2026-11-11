"use client";
// ListingEditor (13-37 choice 2; STAFF-07, D5, D264; 13-UI-SPEC "Catalog" lines 840-856). One
// add-on's listing, two columns at ≥ 1024px:
// - Left (720px): Tagline (counter; the manifest summary as "Default: …"), Description,
//   Availability (Available · Coming soon · Hidden; disabled for a private add-on, which is
//   never listed), Screenshots (ScreenshotList). A field overriding the manifest shows a
//   ghost Reset to default, which clears the override ("" = manifest default).
// - Right: Owners see, the P5 AddonCard as /start and the hub add-ons screen show it,
//   live-updating.
// - Footer: primary Save listing (disabled while a field is over its limit or an alt text is
//   empty) · ghost Discard changes.
// Over-limit input is blocked twice: maxLength while typing, and Save while a pasted value is
// still over. `onSave` is the caller's useStaffAction-wrapped saveListingAction.
import { P13_COPY } from "@cds/core/staff";
import { useEffect, useId, useMemo, useState } from "react";
import { AddonCard } from "../../hub/AddonCard";
import { Button } from "../../hub/Button";
import { InlineAlert } from "../../hub/feedback";
import { TextArea, TextField } from "../../hub/fields";
import { RadioCardGroup } from "../../hub/RadioCardGroup";
import { rethrowControlFlow, type StaffActionResult } from "../dialogs";
import { CATALOG_COPY as C } from "./copy";
import { ScreenshotList, type ScreenshotItem } from "./ScreenshotList";

export type ListingAvailability = "available" | "coming_soon" | "hidden";

export const LISTING_AVAILABILITIES: readonly ListingAvailability[] = [
  "available",
  "coming_soon",
  "hidden",
];

export interface ListingEditorView {
  slug: string;
  name: string;
  /** Manifest summary: the default tagline and description. */
  summary: string;
  private: boolean;
  taglineOverride: string;
  descriptionOverride: string;
  availability: ListingAvailability;
  screenshots: ScreenshotItem[];
  /** "Category · Adds a page, a block and a tab" line on the preview card. */
  meta: string;
  /** The Standard price as owners see it on the card; null = Price coming soon. */
  priceLabel: string | null;
}

export interface ListingSave {
  slug: string;
  tagline: string;
  description: string;
  availability: ListingAvailability;
  screenshots: { id: string; alt: string }[];
}

export interface ListingEditorProps {
  listing: ListingEditorView;
  taglineMax?: number;
  descriptionMax?: number;
  screenshotsMax?: number;
  onSave: (input: ListingSave) => Promise<StaffActionResult<unknown>>;
  onUpload: (
    file: File,
    alt: string,
  ) => Promise<StaffActionResult<ScreenshotItem>>;
  /** Immediate remove with Undo (the caller's toast); `restore` puts it back on Undo. */
  onRemoveScreenshot: (item: ScreenshotItem, restore: () => void) => void;
  onSaved?: (message: string) => void;
  onDiscard?: () => void;
}

type Draft = {
  tagline: string;
  description: string;
  availability: ListingAvailability;
  screenshots: ScreenshotItem[];
};

function draftOf(l: ListingEditorView): Draft {
  return {
    tagline: l.taglineOverride,
    description: l.descriptionOverride,
    availability: l.availability,
    screenshots: l.screenshots,
  };
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-1 text-sm font-semibold text-hub-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
    >
      {C.resetToDefault}
    </button>
  );
}

export function ListingEditor({
  listing,
  taglineMax = 120,
  descriptionMax = 2000,
  screenshotsMax = 6,
  onSave,
  onUpload,
  onRemoveScreenshot,
  onSaved,
  onDiscard,
}: ListingEditorProps) {
  const base = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(listing));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setDraft(draftOf(listing));
  }, [listing]);

  const taglineOver = draft.tagline.length > taglineMax;
  const descriptionOver = draft.description.length > descriptionMax;
  const altMissing = draft.screenshots.some((s) => s.alt.trim() === "");
  const canSave = !taglineOver && !descriptionOver && !altMissing && !pending;

  const shown = useMemo(
    () => ({
      tagline: draft.tagline.trim() || listing.summary,
      comingSoon: draft.availability === "coming_soon",
    }),
    [draft.tagline, draft.availability, listing.summary],
  );

  async function save() {
    if (!canSave) return;
    setPending(true);
    setError(null);
    try {
      const r = await onSave({
        slug: listing.slug,
        tagline: draft.tagline.trim(),
        description: draft.description.trim(),
        availability: draft.availability,
        screenshots: draft.screenshots.map((s) => ({
          id: s.id,
          alt: s.alt.trim(),
        })),
      });
      if (r.ok) onSaved?.(C.saved);
      else if (r.code !== "step_up_needed" && r.code !== "session_ended") {
        setError(r.message);
      }
    } catch (err) {
      rethrowControlFlow(err);
      setError(P13_COPY.ERR_SEND);
    } finally {
      setPending(false);
    }
  }

  function removeShot(id: string) {
    const index = draft.screenshots.findIndex((s) => s.id === id);
    const item = draft.screenshots[index];
    if (!item) return;
    setDraft((d) => ({
      ...d,
      screenshots: d.screenshots.filter((s) => s.id !== id),
    }));
    onRemoveScreenshot(item, () =>
      setDraft((d) => {
        if (d.screenshots.some((s) => s.id === id)) return d;
        const next = [...d.screenshots];
        next.splice(Math.min(index, next.length), 0, item);
        return { ...d, screenshots: next };
      }),
    );
  }

  return (
    <form
      className="flex flex-col gap-6 font-hub text-hub-ink"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-sm text-hub-ink-muted">{C.behaviourNote}</p>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,720px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <TextField
            id={`${base}-tagline`}
            label={C.tagline}
            value={draft.tagline}
            maxLength={taglineMax}
            placeholder={C.defaultPlaceholder(listing.summary)}
            counter={{ value: draft.tagline.length, max: taglineMax }}
            error={taglineOver ? C.tooLong(taglineMax) : undefined}
            labelExtra={
              draft.tagline !== "" ? (
                <ResetButton
                  onClick={() => setDraft((d) => ({ ...d, tagline: "" }))}
                />
              ) : null
            }
            onChange={(e) =>
              setDraft((d) => ({ ...d, tagline: e.target.value }))
            }
          />
          <TextArea
            id={`${base}-description`}
            label={C.description}
            rows={6}
            value={draft.description}
            maxLength={descriptionMax}
            placeholder={C.defaultPlaceholder(listing.summary)}
            counter={{ value: draft.description.length, max: descriptionMax }}
            error={descriptionOver ? C.tooLong(descriptionMax) : undefined}
            labelExtra={
              draft.description !== "" ? (
                <ResetButton
                  onClick={() => setDraft((d) => ({ ...d, description: "" }))}
                />
              ) : null
            }
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
          />
          <div className="flex flex-col gap-2">
            <RadioCardGroup<ListingAvailability>
              name={`${base}-availability`}
              legend={C.availabilityLegend}
              value={draft.availability}
              onChange={(v) => setDraft((d) => ({ ...d, availability: v }))}
              options={LISTING_AVAILABILITIES.map((v) => ({
                value: v,
                title: C.availability[v],
                description: C.availabilityHelp[v],
                disabled: listing.private,
              }))}
            />
            {listing.private ? (
              <p className="text-sm text-hub-ink-muted">{C.privateHelp}</p>
            ) : draft.availability !== "available" ? (
              <div>
                <ResetButton
                  onClick={() =>
                    setDraft((d) => ({ ...d, availability: "available" }))
                  }
                />
              </div>
            ) : null}
          </div>
          <ScreenshotList
            items={draft.screenshots}
            max={screenshotsMax}
            onChange={(screenshots) => setDraft((d) => ({ ...d, screenshots }))}
            onAppend={(shot) =>
              setDraft((d) => ({ ...d, screenshots: [...d.screenshots, shot] }))
            }
            onUpload={onUpload}
            onRemove={removeShot}
          />
        </div>
        <aside aria-label={C.ownersSee} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-hub-ink-muted">
            {C.ownersSee}
          </h3>
          <div className="max-w-sm">
            <AddonCard
              name={listing.name}
              summary={shown.tagline}
              meta={listing.meta}
              active={false}
              href="#"
              manageHref="#"
              canAdd={false}
              priceLabel={listing.priceLabel}
              paused={false}
              comingSoon={shown.comingSoon}
              onAdd={() => {}}
            />
          </div>
        </aside>
      </div>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <div className="flex flex-col-reverse gap-2 border-t border-hub-border pt-4 sm:flex-row">
        <Button type="submit" disabled={!canSave}>
          {C.saveListing}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setDraft(draftOf(listing));
            setError(null);
            onDiscard?.();
          }}
        >
          {C.discardChanges}
        </Button>
      </div>
    </form>
  );
}
