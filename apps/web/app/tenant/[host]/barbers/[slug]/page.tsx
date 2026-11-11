// /barbers/<slug> on tenant hosts: one published barber's page (Studio Booking): portrait,
// bio, gallery, services with prices and a Book button. Unknown or hidden barber = 404.
import { getPublicSeat, type PublicSeat } from "@cds/db";
import { HEADING_CLASSES } from "@cds/ui/site";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { siteForRequest } from "../../../../../lib/tenant";
import {
  BookButton,
  MUTED,
  money,
  minutes,
  photoUrl,
  Portrait,
} from "../BarberViews";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ host: string; slug: string }> };

async function load(host: string, slug: string): Promise<PublicSeat | null> {
  const site = await siteForRequest(host);
  try {
    return await getPublicSeat(site, slug);
  } catch {
    console.error("[barbers] read failed");
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { host, slug } = await params;
  const seat = await load(host, slug);
  if (!seat) return { title: "Barber not found" };
  return {
    title: `${seat.name}, barber`,
    description: seat.headline || `Book with ${seat.name}.`,
  };
}

export default async function BarberPage({ params }: Props) {
  const { host, slug } = await params;
  const seat = await load(host, slug);
  if (!seat) notFound();
  return (
    <main
      id="content"
      tabIndex={-1}
      className="outline-none"
      data-barber-page=""
    >
      <div className="mx-auto grid max-w-[1120px] gap-10 px-6 py-12 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:px-8 md:py-16">
        <div className="w-full max-w-[420px]">
          <Portrait seat={seat} eager />
        </div>
        <div className="flex flex-col gap-6">
          <h1 className={HEADING_CLASSES[1] + " text-balance"}>{seat.name}</h1>
          {seat.headline ? (
            <p className="text-[length:var(--site-text-h3)]">{seat.headline}</p>
          ) : null}
          {seat.bio ? (
            <div className="flex flex-col gap-3 leading-[1.6]">
              {seat.bio.split(/\n{2,}/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          ) : null}
          <div>
            <BookButton seat={seat} label={`Book with ${seat.name}`} />
          </div>
          {seat.services.length ? (
            <section aria-labelledby="menu-h" className="flex flex-col gap-3">
              <h2 id="menu-h" className={HEADING_CLASSES[2]}>
                Services
              </h2>
              <ul className="divide-y divide-site-border border-y border-site-border">
                {seat.services.map((s) => (
                  <li key={s.id} className="flex items-baseline gap-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{s.name}</span>
                      {s.description ? (
                        <span className={`block text-sm ${MUTED}`}>
                          {s.description}
                        </span>
                      ) : null}
                    </span>
                    <span className={`text-sm ${MUTED}`}>
                      {minutes(s.durationMinutes)}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {money(s.priceCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
      {seat.gallery.length ? (
        <section
          aria-labelledby="work-h"
          className="mx-auto max-w-[1120px] px-6 pb-16 md:px-8"
        >
          <h2 id="work-h" className={HEADING_CLASSES[2] + " mb-6"}>
            Work
          </h2>
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {seat.gallery.map((g) => (
              <li key={g}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl(g)}
                  alt={`A cut by ${seat.name}`}
                  loading="lazy"
                  className="aspect-[4/5] w-full object-cover"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
