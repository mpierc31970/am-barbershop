// Countdown item, server half (CONT-10, D122, D-UI-12; RESEARCH Pitfall 8).
//
// countdownState(target, now) is computed here, at request time, so the server HTML is
// already correct: a past target renders the message only, with no island and no JS.
// A future target hands the same state to the client island as `initial`, so the
// island's first render equals this markup and the page never flashes or shifts.
import {
  countdownAriaLabel,
  countdownState,
  formatLongUtc,
} from "@cds/core/content";
import { CountdownIsland } from "./client/CountdownIsland";
import { CountdownView } from "./client/CountdownView";

export interface CountdownProps {
  targetIso: string;
  zeroMessage: string;
  now: Date;
  locale?: string;
}

export function Countdown({
  targetIso,
  zeroMessage,
  now,
  locale,
}: CountdownProps) {
  const initial = countdownState(targetIso, now);
  const label = countdownAriaLabel(targetIso, locale);
  const when = formatLongUtc(targetIso, locale) || label;
  if (initial.done) {
    return (
      <CountdownView
        state={initial}
        targetIso={targetIso}
        zeroMessage={zeroMessage}
        label={label}
        when={when}
      />
    );
  }
  return (
    <CountdownIsland
      targetIso={targetIso}
      zeroMessage={zeroMessage}
      initial={initial}
      label={label}
      when={when}
    />
  );
}
