// Queue map (STAFF-26, D292; P13-P9). Pure and browser-safe: which staff queue a ticket type
// or review item kind lands in. Today and the queue read models use this one constant; the
// ticket inbox uses the real P12 ticket types (migration 850), not CONTEXT's "help".
import { InvalidInput } from "../errors";

export const QUEUE_MAP = {
  ticket_inbox: ["problem", "change", "question", "billing", "suggestion"],
  review_queue: [
    "scan_flag",
    "scan_hold",
    "fit_hold",
    "spot_check",
    "report",
    "dmca",
  ],
  staff_tooling: ["polish"],
} as const;

export type QueueKind = keyof typeof QUEUE_MAP;
export type QueueItemKind = (typeof QUEUE_MAP)[QueueKind][number];

const LOOKUP: ReadonlyMap<string, QueueKind> = new Map(
  (Object.keys(QUEUE_MAP) as QueueKind[]).flatMap((queue) =>
    QUEUE_MAP[queue].map((kind) => [kind, queue] as const),
  ),
);

/** The queue a kind belongs to. Unknown kinds throw, never silently route (T-13-02-03). */
export function queueFor(kind: string): QueueKind {
  const queue = LOOKUP.get(kind);
  if (!queue) throw new InvalidInput("unknown queue kind");
  return queue;
}
