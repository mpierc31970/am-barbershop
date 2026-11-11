// P7 content ports (CONT-28, CONT-33, D255; CONTEXT A1; 07-02 seam).
//
// Maps and stock photos are seams, never concrete services. Stand-in first, config-only
// swap. Types only: the getX() selectors belong to the owning plans (07-24, 07-30).

export type MapQuery = { query: string };

/**
 * Keyless embed frame as the stand-in; the Embed API once `GOOGLE_MAPS_EMBED_KEY` is set
 * (07-24).
 */
export interface MapEmbed {
  readonly keyed: boolean;
  embedUrl(q: MapQuery): string;
  directionsUrl(destination: string): string;
}

export type StockPhoto = {
  id: string;
  source: "unsplash" | "pexels";
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  alt: string;
  creditName: string;
  creditUrl: string;
};

export type StockPhotoPage = {
  photos: readonly StockPhoto[];
  hasMore: boolean;
};

/** No keys means no source, and the picker's stock tab is hidden (CONT-28, 07-30). */
export interface StockPhotoSource {
  readonly name: "unsplash" | "pexels";
  search(query: string, page: number): Promise<StockPhotoPage>;
  /**
   * 07-30: the source's required "photo used" ping (Unsplash download endpoint), called
   * server-side with a validated photo id only (never a client-supplied URL).
   */
  registerUse?(photoId: string): Promise<void>;
}
