"use client";
// You're live wiring (11-17; D-UI-P11-26). Shows the one-time screen and swaps to the
// normal Today status line (rendered on the server, passed as children) the moment the
// person presses Show my Today; the seen flag is saved through markSeenAction, then the
// page refreshes. Following any step link also saves the flag (fire and forget), so a
// refresh or an accidental navigation never loses the screen. Focus moves to the new H1.
import { YoureLive, type YoureLiveStep } from "@cds/ui/hub/today";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { markSeenAction } from "../../../actions/today";
import { GuardedLink } from "../GuardedLink";

const FLAG = "youre_live";

export function YoureLivePanel({
  host,
  steps,
  children,
}: {
  host: string;
  steps: readonly YoureLiveStep[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [shown, setShown] = useState(true);
  const after = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shown) return;
    const h1 = after.current?.querySelector("h1");
    if (h1) {
      h1.setAttribute("tabindex", "-1");
      h1.focus();
    }
  }, [shown]);

  if (!shown) return <div ref={after}>{children}</div>;
  return (
    <YoureLive
      host={host}
      steps={steps}
      LinkComponent={GuardedLink}
      onShowToday={() => {
        setShown(false);
        void markSeenAction(FLAG)
          .then((r) => {
            if (r.ok) router.refresh();
          })
          .catch(() => {});
      }}
      onStep={() => {
        void markSeenAction(FLAG).catch(() => {});
      }}
    />
  );
}
