// DaySeparator and UnreadDivider (12-09 choice 5; 12-UI-SPEC lines 318-322, 830).
// Day separator: an <h3> (visually Label 600 ink-muted), left-aligned, with a 1px hub-border
// line filling the rest ("Today", "Yesterday", "Thu 9 Oct"). Unread divider: shown once,
// above the first unread line, same line style in Label 600 ink, "New since your last visit".
import { THREAD_COPY } from "./copy";

const RULE = "h-px min-w-4 flex-1 bg-hub-border";

export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <h3 className="font-hub text-sm font-semibold text-hub-ink-muted">
        {label}
      </h3>
      <span aria-hidden className={RULE} />
    </div>
  );
}

export function UnreadDivider({ id }: { id?: string }) {
  return (
    <div id={id} data-unread-divider="" className="flex items-center gap-2">
      <p className="font-hub text-sm font-semibold text-hub-ink">
        {THREAD_COPY.unread}
      </p>
      <span aria-hidden className={RULE} />
    </div>
  );
}
