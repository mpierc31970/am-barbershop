"use client";
// HelpDeflect (12-10 choice 4; COMM-08, D119; 12-UI-SPEC Get help form lines 393-397, a11y
// "Help deflection"). As the subject is typed (≥ 3 characters, 250 ms debounce) a neutral
// panel under the field offers up to three help articles: a case-insensitive word match over
// title + summary of the server-built, grant-filtered list (no search API). Absent when nothing
// matches and for Billing (`disabled`). The polite live region announces the count; the links
// sit after the field in tab order and never take focus. A link opens the article in the
// TrainingDrawer through `onOpen` (the form keeps its state); `href` is the no-JS fallback.
import { CircleHelp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TICKETS_COPY } from "./copy";

export type HelpDeflectArticle = {
  id: string;
  title: string;
  summary: string;
  href: string;
};

export interface HelpDeflectProps {
  /** The subject as typed. */
  query: string;
  articles: readonly HelpDeflectArticle[];
  onOpen?: (id: string) => void;
  /** Billing: no deflection. */
  disabled?: boolean;
  /** Default 250 ms. */
  debounceMs?: number;
}

export const DEFLECT_MIN_CHARS = 3;
export const DEFLECT_MAX = 3;

/** Small words that match nearly everything. */
const STOP = new Set([
  "the",
  "and",
  "for",
  "you",
  "your",
  "can",
  "how",
  "not",
  "with",
  "this",
  "that",
  "but",
  "are",
  "was",
  "isn't",
  "doesn't",
  "dont",
  "don't",
]);

function words(q: string): string[] {
  return Array.from(
    new Set(
      q
        .toLowerCase()
        // Unicode letters, so "café" or "menú" stay one word (12-REVIEW IN-D05).
        .split(/[^\p{L}\p{N}']+/u)
        .filter((w) => w.length >= 3 && !STOP.has(w)),
    ),
  );
}

/**
 * Articles whose title or summary holds any query word (3+ letters, case-insensitive); the
 * most matched words first, ties keep the given order; at most three.
 */
export function filterHelpDeflect(
  articles: readonly HelpDeflectArticle[],
  query: string,
): HelpDeflectArticle[] {
  if (query.trim().length < DEFLECT_MIN_CHARS) return [];
  const ws = words(query);
  if (ws.length === 0) return [];
  const scored: { a: HelpDeflectArticle; score: number; i: number }[] = [];
  articles.forEach((a, i) => {
    const title = a.title.toLowerCase();
    const text = `${title} ${a.summary.toLowerCase()}`;
    let score = 0;
    for (const w of ws) {
      if (title.includes(w)) score += 2;
      else if (text.includes(w)) score += 1;
    }
    if (score > 0) scored.push({ a, score, i });
  });
  scored.sort((x, y) => y.score - x.score || x.i - y.i);
  return scored.map((s) => s.a).slice(0, 3);
}

export function HelpDeflect({
  query,
  articles,
  onOpen,
  disabled = false,
  debounceMs = 250,
}: HelpDeflectProps) {
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSettled(query), debounceMs);
    return () => clearTimeout(t);
  }, [query, debounceMs]);

  const shown = useMemo(
    () => (disabled ? [] : filterHelpDeflect(articles, settled)),
    [articles, settled, disabled],
  );

  return (
    <div className="font-hub" data-help-deflect="">
      <p aria-live="polite" className="sr-only">
        {shown.length > 0 ? TICKETS_COPY.deflectCount(shown.length) : ""}
      </p>
      {shown.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2 rounded-lg bg-hub-surface-2 p-4">
          <p className="text-sm font-semibold text-hub-ink">
            {TICKETS_COPY.deflectHead}
          </p>
          <ul className="flex flex-col gap-1">
            {shown.map((a) => (
              <li key={a.id}>
                <a
                  href={a.href}
                  data-deflect-article={a.id}
                  onClick={(e) => {
                    if (!onOpen) return;
                    e.preventDefault();
                    onOpen(a.id);
                  }}
                  className={
                    "inline-flex min-h-11 items-center gap-2 rounded text-base text-hub-accent " +
                    "underline underline-offset-2 focus-visible:outline-2 " +
                    "focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
                  }
                >
                  <CircleHelp aria-hidden size={16} strokeWidth={2} />
                  {a.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
