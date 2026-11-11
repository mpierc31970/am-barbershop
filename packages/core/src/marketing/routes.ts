// Owner: 15-06 (P15-P1). Marketing route list (HUB-01, HUB-03).
// `dir` is the folder under `apps/web/app/(platform)/(marketing)/` ("" = home). 15-22 checks each dir
// exists on disk and builds robots/sitemap from `indexed`/`sitemap`.

export type MarketingRoute = {
  readonly path: string;
  readonly dir: string;
  readonly indexed: boolean;
  readonly sitemap: boolean;
};

const route = (path: string, dir: string, indexed = true): MarketingRoute =>
  Object.freeze({ path, dir, indexed, sitemap: indexed });

export const MARKETING_ROUTES: readonly MarketingRoute[] = Object.freeze([
  route("/", ""),
  route("/standard", "standard"),
  route("/studio", "studio"),
  route("/add-ons", "add-ons"),
  route("/pricing", "pricing"),
  route("/work", "work"),
  route("/about", "about"),
  route("/contact", "contact"),
  route("/independent-pros", "independent-pros"),
  route("/hosting-rules", "hosting-rules"),
  route("/privacy", "privacy"),
  route("/unsubscribe", "unsubscribe", false),
  route("/report", "report", false),
]);

/** Routes outside the `(marketing)` group that may cover a parity row. */
export const EXTERNAL_COVERING: readonly string[] = Object.freeze([
  "/legal/terms-of-service",
  "/sign-in",
]);
