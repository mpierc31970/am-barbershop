// StockSourceClient: the picker's Free photos reads (07-30 choices 9, 10; CONT-28,
// D-UI-P7-11). Over the session-scoped /hub/api/media/stock route; the org comes from the
// session and the API keys never reach the browser. Availability is asked once per page load
// (memoised); the tab appears only after it answers `available: true`.
// Never throws: failures are HubActionResults with owner-facing copy (or `false`).
import type { HubActionResult } from "../addon-types";
import { MEDIA_COPY, type StockPhotoPageView } from "./copy";

export const MEDIA_STOCK_URL = "/hub/api/media/stock";

export interface StockSourceClient {
  available(): Promise<boolean>;
  search(q: string, page: number): Promise<HubActionResult<StockPhotoPageView>>;
  /** Best effort "photo used" ping; never rejects. */
  use(photoId: string): Promise<void>;
}

let availability: Promise<boolean> | null = null;

/** Tests only: forget the memoised availability. */
export function resetStockAvailabilityForTests(): void {
  availability = null;
}

export const fetchStockSource: StockSourceClient = {
  available() {
    availability ??= fetch(MEDIA_STOCK_URL, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) return false;
        const j = (await res.json()) as { available?: unknown };
        return j.available === true;
      })
      .catch(() => false);
    return availability;
  },
  async search(q, page) {
    const qs = new URLSearchParams({ q, page: String(page) }).toString();
    let res: Response;
    try {
      res = await fetch(`${MEDIA_STOCK_URL}?${qs}`, {
        credentials: "same-origin",
      });
    } catch {
      return { ok: false, code: "network", message: MEDIA_COPY.errLoad };
    }
    let j: Record<string, unknown> = {};
    try {
      const v: unknown = await res.json();
      if (typeof v === "object" && v !== null) j = v as Record<string, unknown>;
    } catch {
      j = {};
    }
    if (!res.ok) {
      const message =
        typeof j.message === "string" && j.message.includes(" ")
          ? j.message
          : res.status === 401
            ? MEDIA_COPY.signedOut
            : MEDIA_COPY.errLoad;
      return { ok: false, code: String(j.error ?? "failed"), message };
    }
    return {
      ok: true,
      data: {
        photos: Array.isArray(j.photos)
          ? (j.photos as StockPhotoPageView["photos"])
          : [],
        hasMore: j.hasMore === true,
      },
    };
  },
  async use(photoId) {
    try {
      await fetch(MEDIA_STOCK_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ use: { id: photoId } }),
      });
    } catch {
      // Best effort.
    }
  },
};
