// /barbers/<slug> on tenant hosts: one published barber's page (Studio Booking): portrait,
// bio, gallery, services with prices and a Book button. Their own shop name, logo, social
// links and license number show here only (never in the site chrome). Unknown or hidden
// barber = 404.
import { getPublicSeat, socialName, type PublicSeat } from "@cds/db";
import { BrandIcon, brandForPlatform, HEADING_CLASSES } from "@cds/ui/site";
import { ArrowLeft, Globe } from "lucide-react";
import Link from "next/link";
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

// Launch TODO: filler boxes so "My Work" shows before barbers add photos.
const PLACEHOLDERS = [1, 2, 3, 4, 5];

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
    title: seat.brandName
      ? `${seat.name}, ${seat.brandName}`
      : `${seat.name}, barber`,
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
      <div className="mx-auto max-w-[1120px] px-6 pt-8 md:px-8">
        <Link
          href="/barbers"
          className="inline-flex min-h-11 items-center gap-2 font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus)]"
        >
          <ArrowLeft size={20} aria-hidden="true" focusable="false" />
          Back to list
        </Link>
      </div>
      <div className="mx-auto grid max-w-[1120px] gap-10 px-6 py-12 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:px-8 md:py-16">
        <div className="w-full max-w-[420px]">
          <Portrait seat={seat} eager />
        </div>
        <div className="flex flex-col gap-6">
          {seat.logo || seat.brandName ? (
            <div className="flex items-center gap-4">
              {seat.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl(seat.logo, "thumb")}
                  alt={`${seat.brandName || seat.name} logo`}
                  width={80}
                  height={80}
                  className="h-20 w-20 object-contain"
                />
              ) : null}
              {seat.brandName ? (
                <p className="font-semibold tracking-wide uppercase">
                  {seat.brandName}
                </p>
              ) : null}
            </div>
          ) : null}
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
          {seat.socials.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Social links">
              {seat.socials.map((s) => {
                const brand = brandForPlatform(s.platform);
                return (
                  <li key={s.platform}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${seat.name} on ${socialName(s.platform)}`}
                      className="inline-flex size-11 items-center justify-center rounded-site-button text-site-text transition-colors duration-150 hover:text-site-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus)]"
                    >
                      {brand ? (
                        <BrandIcon id={brand} size={24} />
                      ) : (
                        <Globe size={24} aria-hidden="true" focusable="false" />
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
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
          {seat.licenseNumber ? (
            <p className={`text-sm ${MUTED}`}>
              Texas barber license {seat.licenseNumber}.{" "}
              <a
                href="https://www.tdlr.texas.gov/LicenseSearch/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                Look it up with TDLR
              </a>
            </p>
          ) : null}
        </div>
      </div>
      {/* Launch TODO: drop PLACEHOLDERS and the always-on section (show it only when
          seat.gallery.length) before the site goes live. */}
      {seat.gallery.length || PLACEHOLDERS.length ? (
        <section
          aria-labelledby="work-h"
          className="mx-auto max-w-[1120px] px-6 pb-16 md:px-8"
        >
          <h2 id="work-h" className={HEADING_CLASSES[2] + " mb-6"}>
            My Work
          </h2>
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {seat.gallery.map((g) => (
              <li key={g}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl(g)}
                  alt={`A cut by ${seat.name}`}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              </li>
            ))}
            {PLACEHOLDERS.map((n) => (
              <li
                key={`ph-${n}`}
                aria-hidden="true"
                className="flex aspect-square w-full items-center justify-center border border-site-border text-[length:var(--site-text-h2)] font-semibold"
              >
                {n}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
