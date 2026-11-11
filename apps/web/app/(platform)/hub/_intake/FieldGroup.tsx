// A titled field group inside a setup step or a Settings tab (06-19; 06-UI-SPEC "Stages":
// Heading 20 per group, 48px between groups from the frame's gap-12).
import type { ReactNode } from "react";

export function FieldGroup({
  id,
  title,
  intro,
  titleExtra,
  children,
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  /** Shown after the heading, e.g. the Optional badge. */
  titleExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2
            id={id}
            className="text-xl leading-tight font-semibold text-hub-ink"
          >
            {title}
          </h2>
          {titleExtra}
        </div>
        {intro ? <p className="text-sm text-hub-ink-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}
