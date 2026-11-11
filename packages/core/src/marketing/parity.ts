// Owner: 15-06 (P15-P1). Old-site parity inventory (HUB-03, D62, CONTEXT A1-Q4/Q5).
// Mirrors `.planning/phases/15-cds-hub-site-and-cutover/15-PARITY-INVENTORY.md` row for row
// (tests/hub-parity.test.ts checks the count, statuses, reasons and covering routes).
// Topics only: no archived code, markup or prose is carried.

export type ParityStatus = "covered" | "retired";

export type ParityRow = {
  readonly oldPath: string;
  readonly topic: string;
  readonly status: ParityStatus;
  /** The covering hub route (`covered`), or null (`retired`). */
  readonly route: string | null;
  readonly reason: string;
};

const covered = (
  oldPath: string,
  topic: string,
  route: string,
  reason = "",
): ParityRow => ({
  oldPath,
  topic,
  status: "covered",
  route,
  reason,
});

const retired = (
  oldPath: string,
  topic: string,
  reason: string,
): ParityRow => ({
  oldPath,
  topic,
  status: "retired",
  route: null,
  reason,
});

const NO_LIBRARY = "A resource library is out of v1.0 scope; CDS blog deferred";
const PLATFORM_ONLY = "CDS v1.0 sells the website platform only";
const NO_SCHEDULER_API =
  "Old consult scheduler removed; an API with no inbound links, so no redirect (404)";

export const PARITY: readonly ParityRow[] = Object.freeze([
  covered("/", "What CDS is (home introduction)", "/"),
  covered("/", "What we do (overview of services)", "/"),
  covered("/", "Recent work strip", "/work"),
  covered("/", "About teaser", "/about"),
  covered("/", "What clients say strip", "/work"),
  retired("/", "Free guides teaser", NO_LIBRARY),
  retired(
    "/",
    "Newsletter signup",
    "The old CDS newsletter has ended; its list lives in pocketbase-cds, which the platform never touches",
  ),
  covered("/", "Closing call to action (talk to us)", "/contact"),
  covered(
    "/about",
    "Who runs CDS",
    "/about",
    "Facts only (business name, service area, contact)",
  ),
  covered("/about", "How we work (working values)", "/about"),
  covered("/services", "Web and online presence", "/add-ons"),
  covered("/services", "Websites", "/standard"),
  retired(
    "/services",
    "Online teaching and courses",
    "The LMS is a later phase (not in milestone v1.0); nothing to sell yet",
  ),
  covered(
    "/services",
    "Booking, store and SEO",
    "/add-ons",
    "Booking and Shop show as coming soon (v1.1)",
  ),
  covered("/services", "Care Plans", "/pricing"),
  covered(
    "/services",
    "Pricing (live picker)",
    "/pricing",
    "Prices come from the one catalog (D264)",
  ),
  covered("/services", "How it works (steps)", "/"),
  retired(
    "/services",
    "Print and design",
    `${PLATFORM_ONLY}; print work is not offered on the hub`,
  ),
  retired(
    "/services",
    "AI and automation",
    `${PLATFORM_ONLY}; custom AI work is not offered on the hub`,
  ),
  covered(
    "/work",
    "Client websites",
    "/work",
    "confirmed: false until the user confirms (A1-Q6)",
  ),
  retired(
    "/work",
    "Print and AI portfolio cards",
    "Those services are retired and the cards had no public link",
  ),
  covered(
    "/testimonials",
    "Client testimonials",
    "/work",
    "Old list was empty; the section hides",
  ),
  retired(
    "/resources",
    "White paper library (email-gated PDF downloads)",
    `${NO_LIBRARY}. Four guide titles, PDFs never published, no product facts; 301 to /`,
  ),
  covered("/contact", "Contact form", "/contact"),
  covered("/contact", "Direct contact details (email, phone)", "/contact"),
  covered("/contact", "Social profile links", "/about"),
  covered(
    "/book",
    "Free consult booking",
    "/contact",
    "I'd like a call topic; 301 to /contact?topic=call",
  ),
  covered("/privacy", "Privacy policy", "/privacy"),
  covered("/terms", "Terms of service", "/legal/terms-of-service"),
  covered("/unsubscribe", "Newsletter unsubscribe", "/unsubscribe"),
  retired(
    "/admin/login",
    "Old site admin sign-in",
    "The old admin is replaced by the platform; 301 to /sign-in",
  ),
  retired(
    "/admin/schedule",
    "Old consult schedule admin",
    "The old consult scheduler is gone; 301 to /sign-in",
  ),
  retired(
    "/api/newsletter/subscribe",
    "Newsletter signup endpoint",
    "Newsletter ended; GET 301 to /, POST 410 Gone",
  ),
  covered(
    "/api/newsletter/unsubscribe",
    "One-click unsubscribe endpoint",
    "/unsubscribe",
    "GET 301 to /unsubscribe; POST answers 200 (RFC 8058)",
  ),
  retired(
    "/api/booking/slots",
    "Consult slot lookup endpoint",
    NO_SCHEDULER_API,
  ),
  retired("/api/booking/create", "Consult booking endpoint", NO_SCHEDULER_API),
]);
