// /hub/gallery (A&M fork): the owner's editor for the public Gallery page. Add a photo
// (straight from the phone), change a photo's description, or remove it. Every change
// publishes the page. Barbers' photos arrive through Alerts (Add to Gallery) and are
// managed here after that.
import {
  isStudioManager,
  listMainGallery,
  type MainGalleryPhoto,
} from "@cds/db";
import { EmptyState, InlineAlert } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  editGalleryPhotoAction,
  removeGalleryPhotoAction,
} from "../../../actions/studio";
import { requireHubSession } from "../../../../lib/session";
import { readStudioNote } from "../../../../lib/studio";
import { GalleryButtons } from "./GalleryButtons";
import { GuardedLink } from "../GuardedLink";
import { SeatUploadForm } from "../photo/SeatUploadForm";

export const metadata: Metadata = { title: "Gallery" };
export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const { ctx } = await requireHubSession();
  if (!isStudioManager(ctx)) notFound();
  const [photos, note] = await Promise.all([
    listMainGallery(ctx).catch(() => null as MainGalleryPhoto[] | null),
    readStudioNote(),
  ]);

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-6 font-hub text-hub-ink">
      <ScreenHeader
        title="Gallery"
        helpId="profile"
        LinkComponent={GuardedLink}
      >
        <a
          href="/gallery"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-hub-ink-muted underline"
        >
          View the Gallery page
        </a>
      </ScreenHeader>
      {note ? (
        <InlineAlert tone={note.tone === "success" ? "success" : "error"}>
          {note.text}
        </InlineAlert>
      ) : null}
      <section className="flex flex-col gap-3 rounded border border-hub-border bg-hub-surface p-4">
        <h2 className="text-lg font-semibold">Add a photo</h2>
        <SeatUploadForm target="main" label="Photo" />
      </section>
      {photos === null ? (
        <InlineAlert tone="error">
          We couldn&apos;t load the Gallery. Refresh to try again.
        </InlineAlert>
      ) : photos.length === 0 ? (
        <EmptyState
          heading="No photos yet"
          body="Add a photo above, or add a barber's photo from Alerts."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {photos.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-3 rounded border border-hub-border bg-hub-surface p-3"
            >
              {p.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- private hub route
                <img
                  src={p.thumbUrl}
                  alt={p.alt}
                  className="aspect-square w-full rounded object-cover"
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded bg-hub-surface-2 text-sm text-hub-ink-muted">
                  Photo unavailable
                </div>
              )}
              <form
                action={editGalleryPhotoAction}
                className="flex flex-col gap-2"
              >
                <input type="hidden" name="id" value={p.id} />
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Description
                  <input
                    name="alt"
                    defaultValue={p.alt}
                    maxLength={250}
                    required
                    className="min-h-11 rounded border border-hub-border-strong px-3 text-base font-normal"
                  />
                </label>
                <GalleryButtons remove={removeGalleryPhotoAction} />
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
