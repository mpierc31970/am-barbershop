// Link cover capture, client side (07-23 choices 1-2; CONT-34, D119). No React. The builder's
// video editor calls this once a YouTube link parses and the cover is empty (or was captured
// for another link). POST /hub/api/media/link-cover takes the org from the session; nothing
// here names a tenant. Never throws: any network or non-200 answer is `unavailable`.
// Imported by path (no barrel edit).

export const LINK_COVER_URL = "/hub/api/media/link-cover";

export type LinkCoverCaptureResult =
  { asset: string; thumbUrl: string } | { asset: null; reason: string };

export type LinkCoverCapture = (input: {
  provider: string;
  providerId: string;
  title: string;
}) => Promise<LinkCoverCaptureResult>;

const UNAVAILABLE: LinkCoverCaptureResult = {
  asset: null,
  reason: "unavailable",
};

export const fetchLinkCover: LinkCoverCapture = async ({
  provider,
  providerId,
  title,
}) => {
  try {
    const res = await fetch(LINK_COVER_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, provider_id: providerId, title }),
    });
    if (res.status !== 200) return UNAVAILABLE;
    const json: unknown = await res.json();
    if (typeof json !== "object" || json === null) return UNAVAILABLE;
    const { asset, thumbUrl, reason } = json as Record<string, unknown>;
    if (typeof asset === "string" && asset !== "") {
      return { asset, thumbUrl: typeof thumbUrl === "string" ? thumbUrl : "" };
    }
    return {
      asset: null,
      reason: typeof reason === "string" ? reason : "unavailable",
    };
  } catch {
    return UNAVAILABLE;
  }
};
