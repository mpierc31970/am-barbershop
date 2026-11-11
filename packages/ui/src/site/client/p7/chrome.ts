// @cds/ui/site/client P7 chrome (owner 07-25; 07-02 seam).
// Site client area barrel: client islands; never import the rich-text sanitizer
// (edge-boundary test).
export {
  NavDisclosure,
  type ChromeLayout,
  type NavDisclosureProps,
} from "../NavDisclosure";
// SiteHeader / SiteFooter are hook-free, server-safe markup; re-exported here so the hub's
// Navigation and Footer previews render the exact public chrome from a client component.
export { SiteHeader, type SiteHeaderProps } from "../../SiteHeader";
export { SiteFooter, type SiteFooterProps } from "../../SiteFooter";
// Translate link island (07-26; D237, D-UI-P7-29): header utility slot and the hub preview.
export { TranslateLink, type TranslateLinkProps } from "../TranslateLink";
