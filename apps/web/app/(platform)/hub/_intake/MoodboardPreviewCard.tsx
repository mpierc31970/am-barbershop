// The mood board's first look (06-21; 06-UI-SPEC "Mood board" items 3-6; ONB-05, D47
// constraint 3, CONTEXT A4-Q3, D-UI-P6-28, D-UI-P6-29).
//
//   MoodboardPreviewCard  the P4 Hero + primary button, nothing invented, painted from the
//                         proposal's eight roles in the chosen pairing's faces, inside its own
//                         [data-site][data-theme="proposal"] scope with a 1px
//                         --hub-border-strong outline. The scope's CSS comes from
//                         proposalToPreviewDesign -> designToCssVars, the P4 grammar, so only
//                         the known --site-* tokens with checked values reach it (T-06-99).
//                         "proposal" is not an 8-hex tenant hash, so it never collides with a
//                         real theme scope.
//   ColourRoles           the eight roles with owner names and hex (<dl>).
//   solverNotes           the solver's adjustments as plain sentences, never ratios.
//
// A proposal only: nothing here applies it, and there is no "apply" control (D47).
import {
  ROLES,
  designToCssVars,
  proposalToPreviewDesign,
  type MoodboardProposal,
  type Role,
} from "@cds/core/theme";

export const PREVIEW_CAPTION =
  "This is a first look. Support designs your full theme from your mood board.";
export const PREVIEW_FALLBACK_TAGLINE = "Welcome in";
export const PREVIEW_BUTTON = "Book a visit";
export const PREVIEW_STRIP_LINE =
  "Here's a taste of how your pages could feel.";

/** Owner-facing role names (06-UI-SPEC "Mood board" item 5). */
export const ROLE_NAMES: Record<Role, string> = {
  surface: "Page background",
  "surface-raised": "Section background",
  text: "Text",
  "text-muted": "Soft text",
  primary: "Buttons and links",
  "primary-contrast": "Button text",
  accent: "Highlight",
  border: "Lines",
};

/** The role as it reads inside a sentence ("your highlight colour"). */
const ROLE_IN_SENTENCE: Record<Role, string> = {
  surface: "page background",
  "surface-raised": "section background",
  text: "text colour",
  "text-muted": "soft text colour",
  primary: "button and link colour",
  "primary-contrast": "button text colour",
  accent: "highlight colour",
  border: "line colour",
};

type AdjustmentLike = { role: string; fromL?: number; toL?: number };

/** One owner sentence per adjusted role, in order, no repeats, never a ratio. */
export function solverNotes(adjustments: readonly AdjustmentLike[]): string[] {
  const out: string[] = [];
  for (const a of adjustments) {
    const role = a.role as Role;
    const noun =
      ROLE_IN_SENTENCE[role] ?? `${String(a.role).replace(/-/g, " ")} colour`;
    const from = typeof a.fromL === "number" ? a.fromL : null;
    const to = typeof a.toL === "number" ? a.toL : null;
    const line =
      from !== null && to !== null && to < from
        ? `We darkened your ${noun} a little so it's easy to read.`
        : from !== null && to !== null && to > from
          ? `We lightened your ${noun} a little so it's easy to read.`
          : `We adjusted your ${noun} a little so it's easy to read.`;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

/** The proposal-only scope rule: [data-site][data-theme="proposal"]{--site-*…}. */
export function proposalCss(
  proposal: MoodboardProposal,
  pairingId: string,
  name: string,
): string {
  const design = proposalToPreviewDesign(proposal, pairingId, name);
  return `[data-site][data-theme="proposal"]{${designToCssVars(design)}}`;
}

export interface MoodboardPreviewCardProps {
  proposal: MoodboardProposal;
  pairingId: string;
  businessName: string;
  tagline: string;
}

export function MoodboardPreviewCard({
  proposal,
  pairingId,
  businessName,
  tagline,
}: MoodboardPreviewCardProps) {
  const name = businessName.trim() || "Your business";
  const line = tagline.trim() || PREVIEW_FALLBACK_TAGLINE;
  const css = proposalCss(proposal, pairingId, name);
  return (
    <figure className="flex w-full max-w-[480px] flex-col gap-2">
      <div
        data-site=""
        data-theme="proposal"
        role="img"
        aria-label={`A first look at ${name} in your mood board's colours`}
        className="overflow-hidden rounded-site-media outline outline-1 outline-hub-border-strong"
      >
        <style>{css}</style>
        <div
          aria-hidden="true"
          className="flex aspect-[16/10] flex-col items-start justify-center gap-4 bg-site-surface p-8"
        >
          <p
            data-preview-heading=""
            className="font-site-heading text-[length:var(--site-text-h2)] leading-tight text-site-text"
          >
            {name}
          </p>
          <p className="font-site-body text-[length:var(--site-text-body)] text-site-text-muted">
            {line}
          </p>
          <span
            data-preview-button=""
            className="inline-flex min-h-11 items-center rounded-site-button bg-site-primary px-5 font-site-body text-base font-semibold text-site-primary-contrast"
          >
            {PREVIEW_BUTTON}
          </span>
        </div>
        <div
          aria-hidden="true"
          data-preview-strip=""
          className="border-t border-site-border bg-site-surface-raised px-8 py-4 font-site-body text-base text-site-text"
        >
          {PREVIEW_STRIP_LINE}
        </div>
      </div>
      <figcaption className="text-sm text-hub-ink-muted">
        {PREVIEW_CAPTION}
      </figcaption>
    </figure>
  );
}

export function ColourRoles({ proposal }: { proposal: MoodboardProposal }) {
  const notes = solverNotes(proposal.adjustments ?? []);
  return (
    <div className="flex flex-col gap-3">
      <dl
        aria-label="Your first-look colours"
        className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2"
      >
        {ROLES.map((role) => {
          const hex = proposal.roles[role];
          return (
            <div
              key={role}
              data-role={role}
              className="flex items-center gap-3"
            >
              <span
                aria-hidden="true"
                className="h-6 w-6 shrink-0 rounded outline outline-1 outline-hub-border"
                style={{ backgroundColor: hex }}
              />
              <dt className="text-base text-hub-ink">{ROLE_NAMES[role]}</dt>
              <dd className="ml-auto text-sm text-hub-ink-muted tabular-nums">
                {hex}
              </dd>
            </div>
          );
        })}
      </dl>
      {notes.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {notes.map((n) => (
            <li key={n} className="text-sm text-hub-ink-muted">
              {n}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
