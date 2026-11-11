// FrameTitle (11 verification, DASH-17, D-UI-P11-16): the H1 of a hub frame that draws its
// own header (checkout, agreement, the signed copy, a setup step) with the screen's one "?"
// right after it, as ScreenHeader does. Inside the hub shell the "?" opens the how-to in the
// help drawer in place, so a half-filled step or form is never left. `help={false}` drops
// the "?" where there is no drawer (the focused re-accept frame).
import { ScreenHelp } from "@cds/ui/hub/shell";
import type { ReactNode } from "react";

export function FrameTitle({
  className,
  helpId,
  name,
  help = true,
  children,
}: {
  className: string;
  helpId: string;
  /** "How {name} works". */
  name: string;
  help?: boolean;
  children: ReactNode;
}) {
  if (!help) return <h1 className={className}>{children}</h1>;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <h1 className={className}>{children}</h1>
      <ScreenHelp helpId={helpId} name={name} />
    </div>
  );
}
