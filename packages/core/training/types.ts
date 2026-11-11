// Training types (CONT-32, D110). Kept apart from entries.ts so the training/p7/* modules
// import only this file, never entries.ts (no import cycle; 07-02).

/** No recorded video yet: videos are made once the system is built (D110). */
type NoVideo = null;

export type TrainingEntry = {
  id: string;
  title: string;
  requirement: string;
  kind: "block" | "item" | "feature";
  /** Repo-relative path: docs/how-to/<file>.md */
  howTo: string;
  video: NoVideo;
};

/** One P7 training module: its entries, and which of them are features. */
export type TrainingModule = {
  readonly entries: readonly TrainingEntry[];
  readonly features: readonly string[];
};
