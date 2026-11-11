"use client";
// Block picker for the page builder (03-13; CONT-05; D183, D71, D119, invariant 6;
// 03-UI-SPEC "BlockTemplatePicker"; donor admin/BlockTemplatePicker.tsx L11-350).
//
// Two groups in the right pane: "Blocks" (the five core types, each with one line of what
// it is for) and "Suggested" (five presets (07-24: any section type, multi-block), each drawn
// with its LayoutThumb). Choosing
// one hands back fresh starting content; the route inserts it after the selected block.
// P5 (05-UI-SPEC "Builder integration"): a third group, below Blocks, lists the block
// types of the org's active add-ons, passed in by the route (this package never imports
// an add-on). The group is absent when none are active.
// P7 (07-05; 07-UI-SPEC "Block picker"): Hero is hidden once the page has one (one Hero
// per page, CONT-35, D280), and the core block group maps (07-06, 07-07) fill "Photos and
// video" and "Information" between Blocks and add-ons; an empty group is not rendered.
// Tenants build within the theme (invariant 7): no styling choice appears here.
import {
  BadgeCheck,
  ChevronLeft,
  MessageSquareQuote,
  Puzzle,
  type LucideIcon,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import {
  CORE_SECTIONS,
  type SectionRegistry,
  type SectionTypeDefinition,
} from "@cds/core/content";
import { LayoutThumb } from "../hub/LayoutThumb";
import { BUILDER_BLOCKS_A } from "./blocks/group-a";
import { BUILDER_BLOCKS_B } from "./blocks/group-b";
import type { BuilderBlockEntry, BuilderPickerGroup } from "./blocks/types";
import { SUGGESTED_PRESETS, type PresetContext } from "./presets";
import { PICKER_ORDER, blockLabel } from "./section-form-logic";

export interface BlockChoice {
  section_type: string;
  row_layout: string;
  content: unknown;
}

/** One block type of an active add-on, as the route lists it. */
export interface AddonBlockOption {
  type: string;
  label: string;
  description: string;
  /** Lucide icon name from the add-on manifest ("MessageSquareQuote", "BadgeCheck"). */
  icon?: string;
}

export interface BlockTemplatePickerProps {
  /**
   * The chosen block. 07-24: a multi-block preset passes its further blocks as `more`, in
   * insert order (each goes after the one before it); single-block picks omit it.
   */
  onPick: (choice: BlockChoice, more?: readonly BlockChoice[]) => void;
  onExit: () => void;
  /** Disables the tiles while a new block is being created. */
  busy?: boolean;
  /** Block types of the org's active add-ons. */
  addonBlocks?: readonly AddonBlockOption[];
  /** The composed registry, for an add-on block's default content and layout. */
  registry?: Pick<SectionRegistry, "get">;
  /**
   * True once the page has a Hero, visible or hidden: one Hero per page (CONT-35), so the
   * Hero tile is not offered. `saveSection` refuses a second one server-side (07-04).
   */
  hasHero?: boolean;
  /** 07-24: business details the Suggested presets fill in (address, phone, type). */
  presetContext?: PresetContext;
}

const ADDON_ICONS: Readonly<Record<string, LucideIcon>> = {
  MessageSquareQuote,
  BadgeCheck,
};

function addonIcon(name: string | undefined): LucideIcon {
  return name && Object.prototype.hasOwnProperty.call(ADDON_ICONS, name)
    ? ADDON_ICONS[name]!
    : Puzzle;
}

const TILE =
  "flex min-h-[72px] w-full items-start gap-4 rounded-lg border border-hub-border bg-hub-surface p-4 " +
  "text-left transition-colors duration-150 hover:border-hub-border-strong hover:bg-hub-surface-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const byType = new Map<string, SectionTypeDefinition>(
  CORE_SECTIONS.map((d) => [d.type, d]),
);

const CORE_GROUPS: readonly { id: BuilderPickerGroup; title: string }[] = [
  { id: "photos-video", title: "Photos and video" },
  { id: "information", title: "Information" },
];

/** Group-map entries with a core definition, for one picker group, in tile order. */
function groupTiles(
  group: BuilderPickerGroup,
): { type: string; def: SectionTypeDefinition }[] {
  const entries: [string, BuilderBlockEntry][] = [
    ...Object.entries(BUILDER_BLOCKS_A),
    ...Object.entries(BUILDER_BLOCKS_B),
  ];
  return entries
    .filter(([, e]) => e.picker === group)
    .sort(([, a], [, b]) => a.order - b.order)
    .flatMap(([type]) => {
      const def = byType.get(type);
      return def ? [{ type, def }] : [];
    });
}

function Tile({
  title,
  description,
  adornment,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  adornment?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={TILE}
        disabled={disabled}
        onClick={onClick}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-base font-semibold text-hub-ink">{title}</span>
          <span className="text-sm text-hub-ink-muted">{description}</span>
        </span>
        {adornment ? <span className="shrink-0 pt-1">{adornment}</span> : null}
      </button>
    </li>
  );
}

export function BlockTemplatePicker({
  onPick,
  onExit,
  busy = false,
  addonBlocks = [],
  registry,
  hasHero = false,
  presetContext,
}: BlockTemplatePickerProps) {
  const headingId = useId();
  const blocksId = useId();
  const groupIdBase = useId();
  const addonsId = useId();
  const suggestedId = useId();
  const addonTiles = registry
    ? addonBlocks.flatMap((b) => {
        const def = registry.get(b.type);
        return def ? [{ option: b, def }] : [];
      })
    : [];
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-8 font-hub"
    >
      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={onExit}
          className="inline-flex min-h-10 items-center gap-1 rounded text-sm font-semibold text-hub-accent hover:underline"
        >
          <ChevronLeft aria-hidden size={16} strokeWidth={2} />
          Back to page
        </button>
        <h2
          id={headingId}
          className="text-xl leading-tight font-semibold text-hub-ink"
        >
          Add a block
        </h2>
      </div>

      <div className="flex flex-col gap-4">
        <h3 id={blocksId} className="text-sm font-semibold text-hub-ink">
          Blocks
        </h3>
        <ul aria-labelledby={blocksId} className="grid gap-2 sm:grid-cols-2">
          {PICKER_ORDER.map((type) => {
            const def = byType.get(type);
            if (!def) return null;
            if (hasHero && type === "hero") return null;
            return (
              <Tile
                key={type}
                title={blockLabel(type)}
                description={def.description}
                disabled={busy}
                onClick={() =>
                  onPick({
                    section_type: def.type,
                    row_layout: def.layouts[0] ?? "full",
                    content: def.defaultContent(),
                  })
                }
              />
            );
          })}
        </ul>
      </div>

      {CORE_GROUPS.map((g) => {
        const tiles = groupTiles(g.id);
        if (tiles.length === 0) return null;
        const gid = `${groupIdBase}-${g.id}`;
        return (
          <div key={g.id} className="flex flex-col gap-4">
            <h3 id={gid} className="text-sm font-semibold text-hub-ink">
              {g.title}
            </h3>
            <ul aria-labelledby={gid} className="grid gap-2 sm:grid-cols-2">
              {tiles.map(({ type, def }) => (
                <Tile
                  key={type}
                  title={blockLabel(type, registry ?? byType)}
                  description={def.description}
                  disabled={busy}
                  onClick={() =>
                    onPick({
                      section_type: def.type,
                      row_layout: def.layouts[0] ?? "full",
                      content: def.defaultContent(),
                    })
                  }
                />
              ))}
            </ul>
          </div>
        );
      })}

      {addonTiles.length > 0 ? (
        <div className="flex flex-col gap-4">
          <h3 id={addonsId} className="text-sm font-semibold text-hub-ink">
            From your add-ons
          </h3>
          <ul aria-labelledby={addonsId} className="grid gap-2 sm:grid-cols-2">
            {addonTiles.map(({ option, def }) => {
              const Icon = addonIcon(option.icon);
              return (
                <Tile
                  key={option.type}
                  title={option.label}
                  description={option.description}
                  adornment={
                    <Icon
                      aria-hidden
                      size={20}
                      strokeWidth={2}
                      className="text-hub-ink-muted"
                    />
                  }
                  disabled={busy}
                  onClick={() =>
                    onPick({
                      section_type: def.type,
                      row_layout: def.layouts[0] ?? "full",
                      content: def.defaultContent(),
                    })
                  }
                />
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        <h3 id={suggestedId} className="text-sm font-semibold text-hub-ink">
          Suggested
        </h3>
        <ul aria-labelledby={suggestedId} className="grid gap-2 sm:grid-cols-2">
          {SUGGESTED_PRESETS.map((p) => (
            <Tile
              key={p.id}
              title={p.title}
              description={p.description}
              adornment={<LayoutThumb layout={p.thumb} />}
              disabled={busy}
              onClick={() => {
                const [first, ...rest] = p.build(presetContext);
                if (!first) return;
                onPick(first, rest.length > 0 ? rest : undefined);
              }}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
