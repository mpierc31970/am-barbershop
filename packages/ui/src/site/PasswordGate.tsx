// The themed password gate (CONT-28, D235 #12; 07-UI-SPEC lines 531-533; D-UI-P7-24;
// invariant 7: rendered inside the site theme, theme roles only, no raw colours).
//
// Shown in place of a protected page's content until the visitor's gate cookie matches. Band
// surface, a centered surface-raised panel (400px max, 32px padding, radius-media): Lock icon,
// the page title as the page's one H1 at --site-text-h2, the GATE body, then the form island
// (PasswordGateEnhancer, SSR'd: works without JS). Nothing of the page's content, media or
// meta is passed in. Server component: no hooks, no next/* imports, never the db package.
import { GATE_COPY } from "@cds/core/content";
import { Lock } from "lucide-react";
import {
  PasswordGateEnhancer,
  type GateUiStatus,
} from "./client/PasswordGateEnhancer";
import { BODY_CLASS } from "./types";
import { text } from "./urls";

export interface PasswordGateProps {
  /** The page's title (rendered as text). */
  title: string;
  /** POST target: /api/gate/<pageId>. */
  action: string;
  /** The no-JS status parsed from the URL (gate-status.ts). */
  status?: GateUiStatus;
}

export function PasswordGate({
  title,
  action,
  status = { kind: "idle" },
}: PasswordGateProps) {
  return (
    <main id="content" tabIndex={-1} className="outline-none" data-cds-gate="">
      <div className="bg-site-surface px-6 py-16 md:px-8 md:py-24">
        <div className="mx-auto flex w-full max-w-[400px] flex-col gap-6 rounded-site-media bg-site-surface-raised p-8 text-site-text">
          <div className="flex flex-col gap-3">
            <Lock
              aria-hidden
              size={24}
              strokeWidth={2}
              className="text-site-text-muted"
            />
            <h1 className="text-[length:var(--site-text-h2)] leading-[1.2] font-semibold text-balance">
              {text(title)}
            </h1>
            <p className={`${BODY_CLASS} text-site-text-muted`}>
              {GATE_COPY.body}
            </p>
          </div>
          <PasswordGateEnhancer action={action} initial={status} />
        </div>
      </div>
    </main>
  );
}
