"use client";
// Settings › Domain status poller (14-31 choice 4; 14-UI-SPEC "S1 · Checking", "S4 · Waiting",
// "Accessibility contract", "Performance"; T-14-31-03). Mounted at one fixed place in the panel
// for every state, so it survives `router.refresh()` and can announce the result: while the
// state is `checking` or `waiting` (`active`) it calls `domainStatusAction` every 5 s, only when
// `document.visibilityState === "visible"` (the interval stops on `visibilitychange` hidden).
// When the fingerprint changes it refreshes the server panel and announces the final result
// once in an `aria-live="polite"` region; an unchanged state never re-announces.
// `CheckNowButton` (S4) runs the check now and then stays disabled for 60 s with
// "You can check again in 40s" (tabular figures); the server limits it too (P14-P15).
import { P14_COPY } from "@cds/core/dns";
import { Button } from "@cds/ui/hub";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  checkNameserversAction,
  domainStatusAction,
} from "../../../actions/domain";
import type { DomainViewModel } from "./domain-view";

/** Client modules never import @cds/db, not even its types (tests/browser-boundary). */
type OwnerDomainState = DomainViewModel["state"];

export const DOMAIN_POLL_MS = 5000;
export const CHECK_NOW_WAIT_S = 60;

/** The one announcement for a state the poll lands on (null: nothing to say). */
export function pollAnnouncement(
  from: OwnerDomainState,
  to: OwnerDomainState,
): string | null {
  if (from === to) return null;
  if (to === "nameservers") return P14_COPY.GATE_PASS;
  if (to === "findings") return "Your check results are ready.";
  if (to === "connected" || to === "finishing" || to === "live") {
    return "Your nameservers changed.";
  }
  return null;
}

export function DomainStatusPoller({
  active,
  state,
  mark,
}: {
  /** True in S1 / S4 only. */
  active: boolean;
  state: OwnerDomainState;
  mark: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const markRef = useRef(mark);
  const stateRef = useRef(state);
  const busy = useRef(false);

  useEffect(() => {
    markRef.current = mark;
    stateRef.current = state;
  }, [mark, state]);

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      if (busy.current || document.visibilityState !== "visible") return;
      busy.current = true;
      try {
        const res = await domainStatusAction();
        if (!res.ok || res.data.mark === markRef.current) return;
        const said = pollAnnouncement(stateRef.current, res.data.state);
        markRef.current = res.data.mark;
        stateRef.current = res.data.state;
        if (said) setMessage(said);
        router.refresh();
      } catch {
        // A failed poll is silent; the next tick tries again.
      } finally {
        busy.current = false;
      }
    }

    function start() {
      if (timer || document.visibilityState !== "visible") return;
      timer = setInterval(() => void tick(), DOMAIN_POLL_MS);
    }
    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
    function onVisibility() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, router]);

  return (
    <p
      aria-live="polite"
      data-domain-poller={active ? "on" : "off"}
      className="sr-only"
    >
      {message}
    </p>
  );
}

/** S4 ghost sm "Check now": at most once a minute, then a tabular countdown. */
export function CheckNowButton() {
  const router = useRouter();
  const [left, setLeft] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(t);
  }, [left]);

  async function onClick() {
    if (pending || left > 0) return;
    setPending(true);
    try {
      const res = await checkNameserversAction();
      setLeft(CHECK_NOW_WAIT_S);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setError(null);
      router.refresh();
    } catch {
      // WR-D05: a rejected action still starts the 60 s wait and says so.
      setLeft(CHECK_NOW_WAIT_S);
      setError(P14_COPY.ERR_GENERIC);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={left > 0}
        loading={pending}
        loadingLabel={P14_COPY.BTN_CHECKING}
        icon={<RefreshCw aria-hidden size={16} />}
        onClick={() => void onClick()}
      >
        {P14_COPY.BTN_CHECK_NOW}
      </Button>
      {left > 0 ? (
        <span className="text-sm text-hub-ink-muted tabular-nums">
          You can check again in {left}s
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-sm text-hub-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
