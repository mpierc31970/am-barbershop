"use client";
// Tabs island (07-20; CONT-27; WAI-ARIA APG tabs with automatic activation; 07-UI-SPEC
// row "Tabs" line 359, colour roles line 176, a11y contract line 678, <768px rule 699).
//
// Panels arrive as server-rendered nodes (07-20 decision 1). Arrow keys (wrapping), Home
// and End move focus and selection together; the selected tab is the only one in the tab
// order. Each panel starts with its label heading, hidden here and shown only by the
// block's no-JS style (decision 2), so without JavaScript every panel reads under its
// label. Inactive panels use the `hidden` utility class, not the attribute: Tailwind's
// preflight makes [hidden] display:none !important inside a layer, which the unlayered
// no-JS style could never undo. One tab renders its panel alone (no tablist, no label). Theme token classes only.
// Never imports the sanitizer.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { HEADING_CLASSES } from "../types";
import { stopHiddenMedia } from "./popup-media";

export interface TabsControllerProps {
  tabs: readonly { id: string; label: string; node: ReactNode }[];
  /** Id of the visible block heading (names the tablist); none otherwise. */
  labelledBy?: string;
  /** Level of each panel's no-JS label heading: 3 under a block heading, else 2. */
  labelLevel: 2 | 3;
}

const tabId = (id: string) => `cds-tab-${id}`;
const panelId = (id: string) => `cds-tabpanel-${id}`;

const TAB =
  "relative inline-flex min-h-11 shrink-0 cursor-pointer items-center whitespace-nowrap " +
  "bg-transparent px-4 text-[length:var(--site-text-body)] leading-[1.6] transition-colors duration-150";
const TAB_ACTIVE =
  "font-semibold text-site-text after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-site-primary";
const TAB_IDLE = "text-site-text-muted hover:text-site-text";

export function TabsController({
  tabs,
  labelledBy,
  labelLevel,
}: TabsControllerProps) {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Media in a panel the visitor switched away from stops playing: video, audio and loaded
  // provider frames (WR-D03).
  useEffect(() => {
    panelRefs.current.forEach((el, i) => {
      if (el && i !== active) stopHiddenMedia(el);
    });
  }, [active]);

  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <div>{tabs[0].node}</div>;

  const select = (index: number) => {
    setActive(index);
    const el = tabRefs.current[index];
    if (!el) return;
    el.focus();
    if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = tabs.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = active === last ? 0 : active + 1;
    else if (e.key === "ArrowLeft") next = active === 0 ? last : active - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    select(next);
  };

  const Label = labelLevel === 3 ? "h3" : "h2";

  return (
    <div data-cds-tabs="">
      <div
        role="tablist"
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
        className="flex overflow-x-auto border-b border-site-border [mask-image:linear-gradient(to_right,currentColor_85%,transparent)] md:[mask-image:none]"
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(tab.id)}
            aria-controls={panelId(tab.id)}
            aria-selected={i === active}
            tabIndex={i === active ? 0 : -1}
            className={`${TAB} ${i === active ? TAB_ACTIVE : TAB_IDLE}`}
            onClick={() => select(i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          ref={(el) => {
            panelRefs.current[i] = el;
          }}
          role="tabpanel"
          id={panelId(tab.id)}
          aria-labelledby={tabId(tab.id)}
          tabIndex={0}
          className={i === active ? "mt-8" : "mt-8 hidden"}
        >
          <Label
            data-tab-label=""
            className={`hidden mb-6 ${HEADING_CLASSES[labelLevel]}`}
          >
            {tab.label}
          </Label>
          {tab.node}
        </div>
      ))}
    </div>
  );
}
