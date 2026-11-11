// Keyboard hint (13-07; 13-UI-SPEC "Key hints"): 20px tall, 4px 8px padding, 1px
// border-strong, 4px radius, Label size. A real <kbd>. Server-safe.
import type { ReactNode } from "react";

export function KeyHint({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={
        "inline-flex h-5 items-center rounded border border-hub-border-strong bg-hub-surface " +
        "px-2 py-1 font-hub text-sm leading-none font-normal whitespace-nowrap text-hub-ink" +
        (className ? ` ${className}` : "")
      }
    >
      {children}
    </kbd>
  );
}
