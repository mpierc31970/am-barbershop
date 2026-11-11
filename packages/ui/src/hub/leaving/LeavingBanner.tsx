// LeavingBanner (14-42 choice 2; LIFE-01, D282; 14-UI-SPEC "LeavingBanner", copy BANNER).
// A static 40px strip under the hub top bar during the 30-day notice: DoorOpen 16 +
// "Leaving CDS · 23 days left · Next: move your DNS" (the number bold) + Open checklist.
// Not a ticking timer (the layout renders it per request), not dismissible, a named region
// (`role="region"`, "Leaving CDS"). Owners and Admins only: the layout decides who gets it.
import { P14_COPY } from "@cds/core/dns";
import { DoorOpen } from "lucide-react";
import type { HubLinkComponent } from "../AddonCard";
import { LEAVING_UI_COPY as C } from "./copy";

export const LEAVING_HREF = "/hub/leaving";

export interface LeavingBannerProps {
  /** Whole days left in the notice. */
  days: number;
  /** The first open step in banner words ("move your DNS"). */
  next: string;
  /** Hide Open checklist (on /hub/leaving itself). */
  hideLink?: boolean;
  /** next/link from the app; a plain <a> by default. */
  LinkComponent?: HubLinkComponent;
}

const LINK =
  "font-semibold text-hub-accent underline underline-offset-2 hover:no-underline";

export function LeavingBanner({
  days,
  next,
  hideLink = false,
  LinkComponent,
}: LeavingBannerProps) {
  const text = P14_COPY.BANNER({ days: Math.max(0, days), next });
  const parts = text.split(" · ");
  const Link = LinkComponent;
  return (
    <section
      role="region"
      aria-label={C.region}
      data-leaving-banner=""
      className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hub-border bg-hub-surface-2 px-4 py-2 font-hub text-sm text-hub-ink lg:px-8"
    >
      <DoorOpen
        aria-hidden
        size={16}
        strokeWidth={2}
        className="shrink-0 text-hub-ink-muted"
      />
      <p className="min-w-0 flex-1">
        {parts.map((part, i) => {
          const m = /^(\d+)( .*)$/.exec(part);
          return (
            <span key={i}>
              {i > 0 ? " · " : null}
              {m ? (
                <>
                  <strong className="font-semibold tabular-nums">{m[1]}</strong>
                  {m[2]}
                </>
              ) : (
                part
              )}
            </span>
          );
        })}
      </p>
      {hideLink ? null : Link ? (
        <Link href={LEAVING_HREF} className={LINK}>
          {P14_COPY.BTN_OPEN_CHECKLIST}
        </Link>
      ) : (
        <a href={LEAVING_HREF} className={LINK}>
          {P14_COPY.BTN_OPEN_CHECKLIST}
        </a>
      )}
    </section>
  );
}
