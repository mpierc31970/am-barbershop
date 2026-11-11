"use client";
// "How this works" drawer (05-06; ADDON-11, D110, D-UI-P5-15; 05-UI-SPEC "Training").
// Right Drawer, 480px. Title = the add-on's training entry title. Body = the how-to "Use"
// steps as an ordered list (Body 16, 16px apart), each with its expected result beneath
// in Label ink-muted. No video area while video is null, and no "Open the full how-to"
// link (Help center is P11). The route passes steps only for installed add-ons, so a
// removed add-on's drawer is unreachable.
// 11-47: optional `footer` (1px top border, 16px padding; 11-UI-SPEC "\"?\" on every
// screen"): the hub help drawer passes "Open in Help center" (and, from 11-48, "Show the
// tour").
import { X } from "lucide-react";
import { useId, type ReactNode } from "react";
import type { HowToStepView } from "./addon-types";
import { Drawer } from "./Drawer";
import { IconButton } from "./IconButton";

export interface TrainingDrawerProps {
  open: boolean;
  onClose: () => void;
  /** "How Testimonials works" */
  title: string;
  steps: readonly HowToStepView[];
  footer?: ReactNode;
}

export function TrainingDrawer({
  open,
  onClose,
  title,
  steps,
  footer,
}: TrainingDrawerProps) {
  const titleId = useId();
  return (
    <Drawer open={open} onClose={onClose} label={title} side="right">
      <div className="flex items-center justify-between gap-2 border-b border-hub-border px-6 py-4">
        <h2 id={titleId} className="text-xl leading-tight font-semibold">
          {title}
        </h2>
        <IconButton
          label="Close"
          tooltipAlign="end"
          onClick={onClose}
          icon={<X aria-hidden size={20} strokeWidth={2} />}
        />
      </div>
      <ol
        aria-labelledby={titleId}
        className="flex list-decimal flex-col gap-4 py-6 pr-6 pl-12 marker:font-semibold"
      >
        {steps.map((step, i) => (
          <li key={i} className="text-base">
            <p>
              <span className="font-semibold">{step.screen}</span>
              {step.screen ? ": " : ""}
              {step.action}
            </p>
            <p className="mt-1 text-sm text-hub-ink-muted">{step.expected}</p>
          </li>
        ))}
      </ol>
      {footer ? (
        <div className="flex flex-wrap items-center gap-4 border-t border-hub-border p-4">
          {footer}
        </div>
      ) : null}
    </Drawer>
  );
}
