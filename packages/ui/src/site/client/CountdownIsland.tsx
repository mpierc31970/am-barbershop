"use client";
// Ticking countdown island (CONT-10, D122, D-UI-12; RESEARCH Pitfall 8; 03-UI-SPEC
// "Countdown item", "Motion contract").
//
// Starts from the server-computed state (`initial`) so its first render matches the
// server markup exactly; ticking begins in an effect. Once a second, or once a minute
// with Seconds hidden when the visitor prefers reduced motion. Stops at zero and swaps
// to the message inside the same min-height box. Never imports the sanitizer.
import { useEffect, useState } from "react";
import { countdownState, type CountdownState } from "@cds/core/content";
import { CountdownView } from "./CountdownView";

export interface CountdownIslandProps {
  targetIso: string;
  zeroMessage: string;
  initial: CountdownState;
  /** Accessible name from countdownAriaLabel. */
  label: string;
  /** Visible text of the hidden <time> (defaults to the label). */
  when?: string;
}

const REDUCED = "(prefers-reduced-motion: reduce)";

export function CountdownIsland({
  targetIso,
  zeroMessage,
  initial,
  label,
  when,
}: CountdownIslandProps) {
  const [state, setState] = useState<CountdownState>(initial);
  const [hideSeconds, setHideSeconds] = useState(false);

  useEffect(() => {
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia(REDUCED).matches;
    const tick = () => {
      const next = countdownState(targetIso, new Date());
      setState(next);
      if (next.done) clearInterval(interval);
    };
    const interval = setInterval(tick, reduced ? 60_000 : 1_000);
    // Deferred so no state is set synchronously during the effect.
    const first = setTimeout(() => {
      setHideSeconds(reduced);
      tick();
    }, 0);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [targetIso]);

  return (
    <CountdownView
      state={state}
      targetIso={targetIso}
      zeroMessage={zeroMessage}
      label={label}
      when={when ?? label}
      hideSeconds={hideSeconds}
    />
  );
}
