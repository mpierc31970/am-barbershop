// Public barber views (Studio Booking). Server components, --site-* tokens only. Barber
// photos are plain rectangles (2:3 portrait, square corners), never the hexagon cut: they
// carry no `rounded-site-media` class, which is what am-barber.css cuts.
import type { PublicSeat } from "@cds/db";
import { siteButtonClasses } from "@cds/ui/site";
import { BOOK_PATH } from "../../../../lib/studio-site";

export function photoUrl(id: string, variant: "web" | "thumb" = "web"): string {
  return `/api/barber-photo/${id}/${variant}`;
}

export function money(cents: number): string {
  if (cents <= 0) return "Ask";
  const d = cents / 100;
  return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
}

export function minutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  return n % 60 ? `${h} hr ${n % 60} min` : `${h} hr`;
}

export const MUTED = "text-site-text-muted";

export function Portrait({
  seat,
  eager = false,
}: {
  seat: PublicSeat;
  eager?: boolean;
}) {
  if (!seat.photo) {
    return (
      <div
        role="img"
        aria-label={`${seat.name}: picture coming soon`}
        className="flex aspect-[2/3] w-full items-center justify-center border border-site-border bg-site-surface-raised p-4 text-center text-site-text-muted"
      >
        <span className="text-lg font-semibold uppercase tracking-wide">
          Picture coming soon
        </span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photoUrl(seat.photo)}
      alt={`${seat.name}, barber`}
      width={1024}
      height={1536}
      loading={eager ? "eager" : "lazy"}
      className="aspect-[2/3] w-full object-cover"
    />
  );
}

export function BookButton({
  seat,
  label = "Book",
}: {
  seat: PublicSeat;
  label?: string;
}) {
  return (
    <a
      href={`${BOOK_PATH}?barber=${encodeURIComponent(seat.slug)}`}
      className={siteButtonClasses("primary")}
    >
      {label}
    </a>
  );
}

export function BarberCard({ seat }: { seat: PublicSeat }) {
  return (
    <li className="flex w-full flex-col gap-4 sm:w-[calc((100%-2rem)/2)] lg:w-[calc((100%-4rem)/3)] border-t-2 border-site-primary bg-site-surface-raised">
      <a href={`/barbers/${seat.slug}`} className="block no-underline">
        <Portrait seat={seat} />
      </a>
      <div className="flex flex-1 flex-col gap-2 px-5 pb-5">
        <h2 className="text-[length:var(--site-text-h3)] font-semibold leading-tight">
          <a
            href={`/barbers/${seat.slug}`}
            className="text-site-text no-underline hover:underline"
          >
            {seat.name}
          </a>
        </h2>
        {seat.headline ? <p className={MUTED}>{seat.headline}</p> : null}
        <div className="mt-auto flex flex-wrap gap-3 pt-2">
          <BookButton seat={seat} />
          <a
            href={`/barbers/${seat.slug}`}
            className={siteButtonClasses("secondary")}
          >
            About
          </a>
        </div>
      </div>
    </li>
  );
}
