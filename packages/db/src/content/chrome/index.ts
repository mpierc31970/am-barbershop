// @cds/db P7 area barrel: Site chrome: nav, footer, site settings (owner 07-25, 07-26, 07-29).
// Named exports only; never export a PocketBase client, a context minter or an internal
// writer helper (invariant 1). Wired into src/index.ts with `export *` (07-02).
// Not exported: the site_settings part writers (write.ts), assertNavRefsOwned (refs.ts).
export {
  addAddonPageToNav,
  addPageToNav,
  removePageFromNav,
  getNav,
  saveNav,
  type AddToNavResult,
} from "./nav";
export { getFooter, saveFooter } from "./footer";
export { readPublicLogoId } from "./public";
export { getSiteSettings, saveSiteSettings } from "./settings";
