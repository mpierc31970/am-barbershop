// Media ports (CONT-19, CONT-20, CONT-33, D255; CONTEXT A1 rows 2 and 4; 07-02 seam).
//
// Media delivery and video transcoding are seams, never concrete services. Stand-in first,
// config-only swap: the app serves media itself until Bunny is configured (07-09, 07-10),
// and a fake transcoder stands in for ffmpeg in tests (07-13). Types only: the getX()
// selectors belong to the owning plans.

export type PublicMediaKind = "image" | "video" | "audio";

/** Every file name a public media asset can expose (07-09 builds its key allowlist from this). */
export type PublicMediaVariant =
  | "w480"
  | "w960"
  | "w1600"
  | "w2560"
  | "thumb"
  | "video.mp4"
  | "poster.jpg"
  | "poster.webp"
  | "captions.vtt"
  | "audio.mp3";

export type DeliveryAssetRef = {
  id: string;
  orgId: string;
  kind: PublicMediaKind;
};

export type MediaUrlOptions = {
  width?: number;
  /** Media on a password-protected page gets a page-scoped URL (07-32). */
  protected?: { pageId: string };
};

export interface MediaDelivery {
  readonly name: "app" | "bunny";
  urlFor(
    asset: DeliveryAssetRef,
    variant: PublicMediaVariant,
    opts?: MediaUrlOptions,
  ): string;
  purge(keys: readonly string[]): Promise<void>;
  /**
   * Bytes delivered for an org in a month (`YYYY-MM`). The app stand-in cannot measure
   * this and returns null (D221, D278).
   */
  deliveryBytes(orgId: string, month: string): Promise<number | null>;
}

export type VideoProbe = {
  hasVideoStream: boolean;
  durationS: number;
  width: number;
  height: number;
};

export type TranscodeJob = {
  inputPath: string;
  outputPath: string;
  timeoutMs: number;
};

export type TranscodeResult = {
  durationS: number;
  width: number;
  height: number;
  bytes: number;
};

export type FrameJob = {
  inputPath: string;
  outputPath: string;
  atSeconds: number;
  timeoutMs: number;
};

/**
 * Implementations spawn with an args array, never a shell; the ffmpeg flags live in 07-13.
 */
export interface VideoTranscoder {
  readonly name: "ffmpeg" | "fake";
  probe(inputPath: string): Promise<VideoProbe>;
  transcode(job: TranscodeJob): Promise<TranscodeResult>;
  extractFrame(job: FrameJob): Promise<void>;
}
