// Root layout. The curated font catalog (CONTEXT A2-Q4; UI-SPEC "Font catalog"; RESEARCH
// "Alternatives Considered", Pitfall 11) is declared here, once, app-wide. Choosing among
// catalog families is data (organization.design); adding a family is a deploy. The woff2
// files are self-hosted through Next's asset pipeline: no third-party font CDN, and a
// browser only downloads a face's @font-face src when a rendered element uses that family,
// so a page pays only for the fonts its theme names. The hub stays on the system stack.
// Fraunces ships opsz (optical size) and no italic; Bricolage Grotesque ships no italic;
// the other eight ship roman + italic (wght axis).
//
// <html lang> (CONT-29; 07-26 choice 5; T-07-26-02, T-07-26-03): Next allows <html> only
// here, shared with the hub. TENANT_HOST_HEADER is trusted because the middleware deletes
// any client copy and sets it only from the validated host (WR-02). Present -> that site's
// language (BCP 47, validated at save and again at read); absent (hub, platform pages),
// unresolved or any failure -> "en". Reading headers() makes this layout dynamic; every hub
// and tenant route already is.
import { TENANT_HOST_HEADER } from "@cds/core";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { getSiteLanguage } from "../lib/site-cache";
import { siteForRoute } from "../lib/tenant";
import "./globals.css";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/newsreader/index.css";
import "@fontsource-variable/newsreader/wght-italic.css";
import "@fontsource-variable/source-serif-4/index.css";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "@fontsource-variable/literata/index.css";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource-variable/bricolage-grotesque/index.css";
import "@fontsource-variable/archivo/index.css";
import "@fontsource-variable/archivo/wght-italic.css";
import "@fontsource-variable/public-sans/index.css";
import "@fontsource-variable/public-sans/wght-italic.css";
import "@fontsource-variable/figtree/index.css";
import "@fontsource-variable/figtree/wght-italic.css";
import "@fontsource-variable/work-sans/index.css";
import "@fontsource-variable/work-sans/wght-italic.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/instrument-sans/wght-italic.css";

export const metadata: Metadata = {
  title: "A&M Barber Studio",
};

async function languageFor(host: string): Promise<string> {
  try {
    const site = await siteForRoute(host);
    return site ? await getSiteLanguage(site) : "en";
  } catch {
    return "en";
  }
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const host = (await headers()).get(TENANT_HOST_HEADER);
  const lang = host ? await languageFor(host) : "en";
  return (
    <html lang={lang}>
      <body>{children}</body>
    </html>
  );
}
