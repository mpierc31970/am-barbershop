// /hub/studio-booking/seats/<id>: one barber's seat. The owner edits everything; the barber
// edits their own page (name, headline, bio, shop name, logo, socials, license, photos,
// menu). getSeat (@cds/db) answers NotFound for another barber's seat, so a barber can
// never open one by changing the URL.
import {
  getSchedule,
  getSeat,
  GALLERY_MAX,
  type ScheduleView,
  type SeatView,
} from "@cds/db";
import {
  Badge,
  Button,
  InlineAlert,
  Select,
  TextArea,
  TextField,
} from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import { EmailForm } from "../../../profile/EmailForm";
import { PasswordForm } from "../../../profile/PasswordForm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  inviteSeatAction,
  removePhotoAction,
  removeSeatAction,
  updateSeatAction,
} from "../../../../../actions/studio";
import { requireHubSession } from "../../../../../../lib/session";
import { readStudioNote, STUDIO_BASE } from "../../../../../../lib/studio";
import { GuardedLink } from "../../../GuardedLink";
import { PHONE_APP_HELP_HREF } from "../../../nav";
import { StudioTabs } from "../../StudioTabs";
import { SeatUploadForm } from "../../../photo/SeatUploadForm";
import { ScheduleSection } from "./ScheduleSection";

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
  const { ctx, org, email } = await requireHubSession();
  let seat: SeatView;
  let schedule: ScheduleView;
  try {
    [seat, schedule] = await Promise.all([
      getSeat(ctx, id),
      getSchedule(ctx, id),
    ]);
  } catch {
    notFound();
  }
  const note = await readStudioNote();
  const site = org.primaryHost ? `https://${org.primaryHost}` : "";
  const owner = ctx.role === "owner";
  // Your own seat: your sign-in email and password come first, so everything about you is here.
  const mine =
    !ctx.impersonator &&
    seat.email !== "" &&
    seat.email.toLowerCase() === email.toLowerCase();

  return (
    <div className="flex w-full max-w-[1120px] flex-col gap-8 font-hub text-hub-ink">
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
      {seat.canManage ? null : <StudioTabs active="barbers" manager={false} />}
      <Link href={PHONE_APP_HELP_HREF} className="text-sm underline">
        Set up the app on your phone
      </Link>
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

      {mine ? (
        <div className="grid grid-cols-1 items-start gap-8 rounded border border-hub-border bg-hub-surface p-4 md:grid-cols-2">
          <EmailForm email={email} />
          <PasswordForm />
          <Link href="/hub/profile#alerts" className="text-sm underline">
            Alert settings
          </Link>
        </div>
      ) : null}

      {/* A&M fork: info on the left, the profile picture on the right (stacked on phones). */}
      <div className="grid grid-cols-1 items-start gap-8 md:grid-cols-2">
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
            <TextField
              id="s-brand"
              name="brandName"
              label="Shop or chair name"
              helper="Your own brand, if you have one. Shows on your page only."
              defaultValue={seat.brandName}
              maxLength={80}
            />
            <TextField
              id="s-license"
              name="licenseNumber"
              label="Texas barber license number"
              helper="Optional. Shows on your page so clients can look you up with TDLR."
              defaultValue={seat.licenseNumber}
              maxLength={20}
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
          id="portrait"
          aria-labelledby="portrait-h"
          className="flex flex-col gap-3"
        >
          <h2 id="portrait-h" className={H2}>
            Profile picture
          </h2>
          <div className={CARD}>
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
              <p className="text-hub-ink-muted">No profile picture yet.</p>
            )}
            <SeatUploadForm
              seatId={seat.id}
              target="photo"
              label={
                seat.photo ? "Replace profile picture" : "Add a profile picture"
              }
            />
          </div>
        </section>
      </div>

      <section
        id="photos"
        aria-labelledby="photos-h"
        className="flex flex-col gap-3"
      >
        <h2 id="photos-h" className={H2}>
          Photos
        </h2>
        <div className={CARD}>
          <h3 className="font-semibold">Logo</h3>
          {seat.logo ? (
            <div className="flex items-end gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoSrc(seat, seat.logo)}
                alt=""
                width={120}
                height={120}
                className="h-[120px] w-[120px] object-contain"
              />
              <RemovePhoto seat={seat} mediaId={seat.logo} />
            </div>
          ) : (
            <p className="text-hub-ink-muted">
              Your own shop or chair logo, shown on your page only.
            </p>
          )}
          <SeatUploadForm
            seatId={seat.id}
            target="logo"
            label={seat.logo ? "Replace logo" : "Add a logo"}
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
            <SeatUploadForm
              seatId={seat.id}
              target="gallery"
              label="Add a gallery photo"
            />
          ) : null}
        </div>
      </section>

      <section aria-labelledby="menu-h" className="flex flex-col gap-3">
        <h2 id="menu-h" className={H2}>
          Services &amp; Pricing
        </h2>
        <p className="text-hub-ink-muted">
          {seat.services.length === 0
            ? "No services yet."
            : `${seat.services.length} service${seat.services.length === 1 ? "" : "s"} on this page.`}{" "}
          <Link
            className="underline"
            href={`${STUDIO_BASE}/services?seat=${seat.id}`}
          >
            Edit services &amp; pricing
          </Link>
        </p>
      </section>

      <ScheduleSection seatId={seat.id} schedule={schedule} />

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
