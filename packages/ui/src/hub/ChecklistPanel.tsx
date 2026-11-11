// ChecklistPanel: the SEO & accessibility checks in the SEO & sharing drawer (07-30; CONT-14,
// CONT-35, D188, D280; 07-UI-SPEC "SEO & sharing drawer" section 3). Presentational: the
// items come from core `pageChecklist`, the Fix target goes back through `onFix`.
// Header Label says the checks never block Publish. Two groups, Search then Accessibility;
// amber rows show TriangleAlert (warning) + text + a Fix link-styled button; fine rows sit
// under a native <details> "N checks look good" with CircleCheck (success). Text is always
// React text (never HTML), so a hostile block name renders as text.
import type { ChecklistItem, FixTarget } from "@cds/core/seo";
import { CHECKLIST_COPY } from "@cds/core/seo";
import { CircleCheck, TriangleAlert } from "lucide-react";

export interface ChecklistPanelProps {
  items: readonly ChecklistItem[];
  onFix(target: FixTarget): void;
}

const GROUPS = [
  { id: "search", label: CHECKLIST_COPY.groupSearch },
  { id: "accessibility", label: CHECKLIST_COPY.groupAccessibility },
] as const;

export function ChecklistPanel({ items, onFix }: ChecklistPanelProps) {
  const fine = items.filter((i) => i.status === "fine");
  return (
    <div className="flex flex-col gap-6 font-hub" data-checklist="">
      <p className="text-sm text-hub-ink-muted">{CHECKLIST_COPY.header}</p>
      {GROUPS.map((g) => {
        const amber = items.filter(
          (i) => i.group === g.id && i.status === "check",
        );
        return (
          <section
            key={g.id}
            aria-label={g.label}
            className="flex flex-col gap-2"
            data-checklist-group={g.id}
          >
            <h4 className="text-sm font-semibold text-hub-ink">{g.label}</h4>
            {amber.length === 0 ? null : (
              <ul className="flex flex-col gap-2">
                {amber.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start gap-2"
                    data-check={item.id}
                  >
                    <TriangleAlert
                      aria-hidden
                      size={20}
                      strokeWidth={2}
                      className="mt-0.5 shrink-0 text-hub-warning"
                    />
                    <span className="flex-1 text-base text-hub-ink">
                      {item.text}
                    </span>
                    {item.fix ? (
                      <button
                        type="button"
                        className={
                          "min-h-11 shrink-0 px-1 text-sm font-semibold text-hub-accent underline " +
                          "underline-offset-2 hover:no-underline focus-visible:outline-2 " +
                          "focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
                        }
                        aria-label={`${CHECKLIST_COPY.fix}: ${item.text}`}
                        onClick={() => onFix(item.fix!)}
                      >
                        {CHECKLIST_COPY.fix}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {fine.length > 0 ? (
        <details className="group" data-checklist-fine="">
          <summary
            className={
              "cursor-pointer rounded text-sm font-semibold text-hub-ink " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
            }
          >
            {CHECKLIST_COPY.fineCount(fine.length)}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {fine.map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-2"
                data-check={item.id}
              >
                <CircleCheck
                  aria-hidden
                  size={20}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 text-hub-success"
                />
                <span className="text-base text-hub-ink">{item.text}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
