// Email env helpers (EMAIL-01, ONB-10; PD-13, T-06-23). Signed links fail closed in
// production: no CDS_LINK_SECRET or CDS_PLATFORM_URL there is a thrown error, never a default.
// Outside production a fixed dev-only secret and localhost base keep dev and tests simple.
// GO-LIVE: CDS_LINK_SECRET, CDS_PLATFORM_URL, CDS_MAIL_DOMAIN, CDS_SUPPORT_EMAIL, CDS_POSTAL_ADDRESS.

const DEV_LINK_SECRET = "cds-dev-only-link-secret-never-used-in-production";
const DEV_PLATFORM_URL = "http://localhost:3000";
const DEV_MAIL_DOMAIN = "send.cds.needtobeedgy.com";
const MIN_SECRET = 32;

function isProduction(): boolean {
  return process.env.CDS_ENV === "production";
}

/** The HMAC key for signed email links (PD-13). */
export function linkSecret(): string {
  const s = process.env.CDS_LINK_SECRET;
  if (s !== undefined && s !== "") {
    if (isProduction() && s.length < MIN_SECRET) {
      throw new Error(
        `CDS_LINK_SECRET must be at least ${MIN_SECRET} characters in production`,
      );
    }
    return s;
  }
  if (isProduction()) {
    throw new Error("CDS_LINK_SECRET must be set in production");
  }
  return DEV_LINK_SECRET;
}

function baseUrl(): string {
  const raw = process.env.CDS_PLATFORM_URL;
  if (raw === undefined || raw === "") {
    if (isProduction()) {
      throw new Error("CDS_PLATFORM_URL must be set in production");
    }
    return DEV_PLATFORM_URL;
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("CDS_PLATFORM_URL is not a URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("CDS_PLATFORM_URL must be http(s)");
  }
  if (isProduction() && u.protocol !== "https:") {
    throw new Error("CDS_PLATFORM_URL must be https in production");
  }
  return u.origin + u.pathname.replace(/\/+$/, "");
}

/** Absolute platform URL for a root-relative path ("/start/q/x"). */
export function platformUrl(path: string): string {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\s\\]/.test(path)
  ) {
    throw new Error("platformUrl needs a root-relative path");
  }
  return baseUrl() + path;
}

/** The platform mail domain senders use (<slug>@ / hello@). */
export function mailDomain(): string {
  const d = process.env.CDS_MAIL_DOMAIN?.trim().toLowerCase();
  return d ? d : DEV_MAIL_DOMAIN;
}

/** CDS support address (Reply-To on CDS mail), or null until set (GO-LIVE). */
export function supportEmail(): string | null {
  const s = process.env.CDS_SUPPORT_EMAIL?.trim();
  return s ? s : null;
}

/** CDS postal address for email footers; DRAFT until set (GO-LIVE). */
export function postalAddress(): string {
  const s = process.env.CDS_POSTAL_ADDRESS?.trim();
  return s ? s : "DRAFT: address pending";
}
