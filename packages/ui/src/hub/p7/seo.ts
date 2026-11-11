// @cds/ui/hub P7 SEO (owner 07-30; CONT-14, CONT-28, CONT-35).
// Hub area barrel. hub/index.ts `export *`s every p7 barrel, so names here carry a SEO / stock
// prefix where a generic name could collide.
export { ChecklistPanel, type ChecklistPanelProps } from "../ChecklistPanel";
export {
  SearchResultPreview,
  ellipsize as seoEllipsize,
  type SearchResultPreviewProps,
} from "../SearchResultPreview";
export {
  MEDIA_STOCK_URL,
  fetchStockSource,
  resetStockAvailabilityForTests,
  type StockSourceClient,
} from "../media/stock-source";
export {
  photoByLabel as stockPhotoByLabel,
  pickedOfStock,
  type PickedStock,
  type StockPhotoPageView,
  type StockPhotoView,
} from "../media/copy";
