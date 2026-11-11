// Owner: 15-09 (P15-P1). RivetMark: the 12px rivet ring (2px stroke in the field fg) used by the
// wordmark, blades and the pitch line (leaf fill there; UI-SPEC components). Decorative only.

export type RivetMarkProps = {
  /** "leaf" fills the ring: money that stays yours (pitch line only). */
  fill?: "leaf";
  className?: string;
};

export function RivetMark({ fill, className }: RivetMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={[
        "inline-block size-3 shrink-0 rounded-mk-round border-2 border-current",
        fill === "leaf" ? "bg-mk-leaf" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
