// Form upload scanner port (CONT-20, D255; CONTEXT A1 row 4; 07-02 seam).
//
// Stand-in first, config-only swap: with no clamd configured the "unavailable" scanner
// answers "error". Types only: the selector belongs to 07-15.

export type FileScanVerdict = "clean" | "infected" | "error";

export interface FileScanner {
  readonly name: "clamd" | "unavailable";
  /** "error" means fail closed: upload fields are hidden (07-15). */
  scan(input: AsyncIterable<Uint8Array>): Promise<FileScanVerdict>;
}
