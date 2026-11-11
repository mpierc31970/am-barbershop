// /hub/studio-booking/seats/<id>: one barber's seat. The owner edits everything; the barber
// edits their own page (name, headline, bio, photos, menu). getSeat (@cds/db) answers
// NotFound for another barber's seat, so a barber can never open one by changing the URL.
import { getSeat, GALLERY_MAX, type SeatView } from "@cds/db";
import {
  Badge,
  Button,
  InlineAlert,
  Select,
  TextArea,
  TextField,
} from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  inviteSeatAction,
  removePhotoAction,
  removeSeatAction,
  removeServiceAction,
  saveServiceAction,
  updateSeatAction,
} from "../../../../../actions/studio";
import { requireHubSession } from "../../../../../../lib/session";
import {
  duration,
  money,
  priceField,
  readStudioNote,
  STUDIO_BASE,
} from "../../../../../../lib/studio";
import { GuardedLink } from "../../../GuardedLink";

export const metadata: Metadata = { title: "Barber" };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const KIND_OPTIONS = [
  { value: "renter", label: "Chair renter (pays rent)" },
  { value: "staff", label: "Employee" },
];

const H2 = "text-xl font-semibold";
const CARD =
  "flex flex-col gap-4 rounded border border-hub-border bg-hub-surface p-4";

function photoSrc(seat: SeatView, id: string): string {
  return `/hub/api/studio/photo/${seat.id}/${id}`;
}

function UploadForm({
  seat,
  target,
  label,
}: {
  seat: SeatView;
  target: "photo" | "gallery";
  label: string;
}) {
  return (
    <form
      method="post"
      action="/hub/api/studio/photo"
      encType="multipart/form-data"
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="seatId" value={seat.id} />
      <input type="hidden" name="target" value={target} />
      <label className="flex flex-col gap-2 text-sm font-semibold">
        {label}
        <input
          type="file"
          name="file"
          required
          accept="image/jpeg,image/png,image/webp,image/heic"
          className="text-base font-normal"
        />
      </label>
      <Button type="submit" size="sm">
        Upload
      </Button>
    </form>
  );
}

function RemovePhoto({ seat, mediaId }: { seat: SeatView; mediaId: string }) {
  return (
    <form action={removePhotoAction}>
      <input type="hidden" name="seatId" value={seat.id} />
      <input type="hidden" name="mediaId" value={mediaId} />
      <Button type="submit" size="sm" variant="ghost">
        Remove
      </Button>
    </form>
  );
}

export default async function SeatPage({ params }: Props) {
  const { id } = await params;
  const { ctx, org } = await requireHubSession();
  let seat: SeatView;
  try {
    seat = await getSeat(ctx, id);
  } catch {
    notFound();
  }
  const note = await readStudioNote();
  const site = org.primaryHost ? `https://${org.primaryHost}` : "";
  const owner = ctx.role === "owner";

  return (
    <div className="flex w-full max-w-[880px] flex-col gap-8 font-hub text-hub-ink">
      {seat.canManage ? (
        <Link href={STUDIO_BASE} className="text-sm underline">
          ← All barbers
        </Link>
      ) : null}
      <ScreenHeader
        title={seat.name}
        helpId="addon-studio-booking"
        LinkComponent={GuardedLink}
      >
        <Badge tone={seat.isPublished ? "published" : "draft"}>
          {seat.isPublished ? "On the site" : "Hidden"}
        </Badge>
      </ScreenHeader>
      {note ? (
        <InlineAlert tone={note.tone === "success" ? "success" : "error"}>
          {note.text}
        </InlineAlert>
      ) : null}
      {site && seat.isPublished ? (
        <p className="text-sm text-hub-ink-muted">
          Public page:{" "}
          <a
            className="underline"
            href={`${site}/barbers/${seat.slug}`}
            target="_blank"
            rel="noreferrer"
          >
            {org.primaryHost}/barbers/{seat.slug}
          </a>
        </p>
      ) : null}

      <section aria-labelledby="page-h" className="flex flex-col gap-3">
        <h2 id="page-h" className={H2}>
          Page
        </h2>
        <form action={updateSeatAction} className={CARD}>
          <input type="hidden" name="seatId" value={seat.id} />
          <TextField
            id="s-name"
            name="name"
            label="Name"
            defaultValue={seat.name}
            required
            maxLength={80}
          />
          <TextField
            id="s-headline"
            name="headline"
            label="Headline"
            helper="One line under your name, for example: Fades, tapers and beard work."
            defaultValue={seat.headline}
            maxLength={120}
          />
          <TextArea
            id="s-bio"
            name="bio"
            label="Bio"
            rows={6}
            defaultValue={seat.bio}
            maxLength={2000}
          />
          {seat.canManage ? (
            <>
              <TextField
                id="s-email"
                name="email"
                type="email"
                label="Sign-in email"
                defaultValue={seat.email}
                maxLength={254}
              />
              <Select
                id="s-kind"
                name="kind"
                label="Seat"
                options={KIND_OPTIONS}
                defaultValue={seat.kind}
              />
              <TextField
                id="s-slug"
                name="slug"
                label="Web address"
                helper={`Lowercase letters, numbers and dashes: /barbers/${seat.slug}`}
                defaultValue={seat.slug}
                maxLength={60}
              />
              <label className="flex items-center gap-2 text-base">
                <input
                  type="checkbox"
                  name="isPublished"
                  defaultChecked={seat.isPublished}
                  className="h-5 w-5"
                />
                Show this barber on the site
              </label>
            </>
          ) : null}
          <div>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </section>

      <section
        id="photos"
        aria-labelledby="photos-h"
        className="flex flex-col gap-3"
      >
        <h2 id="photos-h" className={H2}>
          Photos
        </h2>
        <div className={CARD}>
          <h3 className="font-semibold">Portrait</h3>
          {seat.photo ? (
            <div className="flex items-end gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoSrc(seat, seat.photo)}
                alt=""
                width={120}
                height={180}
                className="h-[180px] w-[120px] object-cover"
              />
              <RemovePhoto seat={seat} mediaId={seat.photo} />
            </div>
          ) : (
            <p className="text-hub-ink-muted">No portrait yet.</p>
          )}
          <UploadForm
            seat={seat}
            target="photo"
            label={seat.photo ? "Replace portrait" : "Add a portrait"}
          />
          <h3 className="font-semibold">
            Gallery ({seat.gallery.length} of {GALLERY_MAX})
          </h3>
          {seat.gallery.length ? (
            <ul className="flex flex-wrap gap-3">
              {seat.gallery.map((g) => (
                <li key={g} className="flex flex-col items-start gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoSrc(seat, g)}
                    alt=""
                    width={120}
                    height={120}
                    className="h-[120px] w-[120px] object-cover"
                  />
                  <RemovePhoto seat={seat} mediaId={g} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-hub-ink-muted">Show your best cuts here.</p>
          )}
          {seat.gallery.length < GALLERY_MAX ? (
            <UploadForm
              seat={seat}
              target="gallery"
              label="Add a gallery photo"
            />
          ) : null}
        </div>
      </section>

      <section
        id="menu"
        aria-labelledby="menu-h"
        className="flex flex-col gap-3"
      >
        <h2 id="menu-h" className={H2}>
          Services and prices
        </h2>
        {seat.services.map((s) => (
          <form
            key={s.id}
            action={saveServiceAction}
            className={`${CARD} sm:grid sm:grid-cols-[2fr_1fr_1fr]`}
          >
            <input type="hidden" name="seatId" value={seat.id} />
            <input type="hidden" name="serviceId" value={s.id} />
            <TextField
              id={`n-${s.id}`}
              name="name"
              label="Service"
              defaultValue={s.name}
              required
              maxLength={80}
            />
            <TextField
              id={`d-${s.id}`}
              name="duration"
              label="Minutes"
              type="number"
              min={5}
              max={480}
              step={5}
              defaultValue={s.durationMinutes}
              required
            />
            <TextField
              id={`p-${s.id}`}
              name="price"
              label="Price ($)"
              inputMode="decimal"
              defaultValue={priceField(s.priceCents)}
              helper="Blank: ask for a price"
            />
            <div className="sm:col-span-3">
              <TextField
                id={`x-${s.id}`}
                name="description"
                label="Description"
                defaultValue={s.description}
                maxLength={300}
              />
            </div>
            <div className="flex gap-2 sm:col-span-3">
              <Button type="submit" size="sm">
                Save
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                formAction={removeServiceAction}
              >
                Remove
              </Button>
              <span className="self-center text-sm text-hub-ink-muted">
                {duration(s.durationMinutes)} · {money(s.priceCents)}
              </span>
            </div>
          </form>
        ))}
        <form
          action={saveServiceAction}
          className={`${CARD} sm:grid sm:grid-cols-[2fr_1fr_1fr]`}
        >
          <input type="hidden" name="seatId" value={seat.id} />
          <TextField
            id="n-new"
            name="name"
            label="New service"
            required
            maxLength={80}
          />
          <TextField
            id="d-new"
            name="duration"
            label="Minutes"
            type="number"
            min={5}
            max={480}
            step={5}
            defaultValue={30}
            required
          />
          <TextField
            id="p-new"
            name="price"
            label="Price ($)"
            inputMode="decimal"
            helper="Blank: ask for a price"
          />
          <div className="sm:col-span-3">
            <TextField
              id="x-new"
              name="description"
              label="Description"
              maxLength={300}
            />
          </div>
          <div>
            <Button type="submit" size="sm" variant="primary">
              Add service
            </Button>
          </div>
        </form>
      </section>

      {seat.canManage ? (
        <section aria-labelledby="access-h" className="flex flex-col gap-3">
          <h2 id="access-h" className={H2}>
            Sign-in and removal
          </h2>
          <div className={CARD}>
            <p>
              {seat.linked
                ? "This barber has signed in and can edit their own page."
                : "Send the invite so they can sign in and edit their own page. They only see their own seat."}
            </p>
            <div className="flex flex-wrap gap-2">
              {owner && !seat.linked ? (
                <form action={inviteSeatAction}>
                  <input type="hidden" name="seatId" value={seat.id} />
                  <Button type="submit" disabled={!seat.email}>
                    Send invite
                  </Button>
                </form>
              ) : null}
              <details className="flex flex-col gap-2">
                <summary className="cursor-pointer py-2 underline">
                  Remove barber…
                </summary>
                <form
                  action={removeSeatAction}
                  className="flex flex-col items-start gap-2"
                >
                  <input type="hidden" name="seatId" value={seat.id} />
                  <p className="text-sm">
                    Their page, menu and sign-in to this site go. This
                    can&apos;t be undone.
                  </p>
                  <Button type="submit" variant="destructive">
                    Remove {seat.name}
                  </Button>
                </form>
              </details>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
