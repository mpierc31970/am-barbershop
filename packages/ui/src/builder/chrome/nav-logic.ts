// Menu editor transforms (07-25 choice 11; CONT-13; UI-SPEC "Navigation" line 475).
//
// The editor works on a flattened list of rows with depth 0 (top level) or 1 (inside the
// dropdown of the nearest top-level row above), the dnd-kit sortable-tree pattern. Every
// transform is pure and returns new rows, or { error } with the NAV-LIMIT / child-limit
// copy when the result would break a menu rule. buildNav inverts flattenNav; a depth-1 row
// with no top-level row above becomes top-level. Keyboard and screen-reader users reach
// every transform through the row's overflow menu (Move up / Move down / Put under /
// Move out of / Remove), so drag is never the only path.
import {
  NAV_CHILD_MAX,
  NAV_COPY,
  NAV_TOP_MAX,
  type NavItem,
  type NavLink,
} from "@cds/core/content";

export type NavRow = { id: string; depth: 0 | 1; link: NavLink };
export type NavRowsResult = { rows: NavRow[] } | { error: string };

export const NAV_NEST_PARENT_COPY =
  "A link with its own dropdown can't go inside another dropdown.";

/** Max top-level rows (menu 8, footer 6) and whether nesting is allowed. */
export type NavLimits = { top: number; children: number };
export const MENU_LIMITS: NavLimits = {
  top: NAV_TOP_MAX,
  children: NAV_CHILD_MAX,
};

function linkOf(i: NavLink): NavLink {
  return { id: i.id, label: i.label, target: i.target, new_tab: i.new_tab };
}

export function flattenNav(items: readonly NavItem[]): NavRow[] {
  const rows: NavRow[] = [];
  for (const item of items) {
    rows.push({ id: item.id, depth: 0, link: linkOf(item) });
    for (const c of item.children) {
      rows.push({ id: c.id, depth: 1, link: linkOf(c) });
    }
  }
  return rows;
}

export function buildNav(rows: readonly NavRow[]): NavItem[] {
  const items: NavItem[] = [];
  for (const row of rows) {
    const parent = items[items.length - 1];
    if (row.depth === 1 && parent) {
      parent.children.push(linkOf(row.link));
    } else {
      items.push({ ...linkOf(row.link), children: [] });
    }
  }
  return items;
}

/** End (exclusive) of the block that starts at top-level row `i`. */
function blockEnd(rows: readonly NavRow[], i: number): number {
  if (rows[i]?.depth === 1) return i + 1;
  let j = i + 1;
  while (j < rows.length && rows[j]!.depth === 1) j += 1;
  return j;
}

/** Index of the top-level row that owns row `i` (itself when top-level), or -1. */
export function parentIndex(rows: readonly NavRow[], i: number): number {
  for (let j = i; j >= 0; j -= 1) if (rows[j]!.depth === 0) return j;
  return -1;
}

export function hasChildren(rows: readonly NavRow[], i: number): boolean {
  return rows[i]?.depth === 0 && rows[i + 1]?.depth === 1;
}

/** Normalise (orphans to top level) and check the limits. */
export function checkRows(
  rows: readonly NavRow[],
  limits: NavLimits = MENU_LIMITS,
): NavRowsResult {
  const norm: NavRow[] = rows.map((r, i) =>
    r.depth === 1 && parentIndex(rows, i) === -1 ? { ...r, depth: 0 } : r,
  );
  const items = buildNav(norm);
  if (items.length > limits.top) return { error: NAV_COPY.limit };
  if (items.some((i) => i.children.length > limits.children)) {
    return { error: NAV_COPY.childLimit };
  }
  return { rows: norm };
}

export function topCount(rows: readonly NavRow[]): number {
  return rows.filter((r) => r.depth === 0).length;
}

/** Keyboard Move up / Move down: blocks among top-level rows, children among siblings. */
export function moveStep(
  rows: readonly NavRow[],
  i: number,
  dir: -1 | 1,
): NavRow[] | null {
  const row = rows[i];
  if (!row) return null;
  if (row.depth === 1) {
    const j = i + dir;
    if (rows[j]?.depth !== 1) return null;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  }
  const end = blockEnd(rows, i);
  const block = rows.slice(i, end);
  if (dir === -1) {
    if (i === 0) return null;
    const prev = parentIndex(rows, i - 1);
    return [
      ...rows.slice(0, prev),
      ...block,
      ...rows.slice(prev, i),
      ...rows.slice(end),
    ];
  }
  if (end >= rows.length) return null;
  const nextEnd = blockEnd(rows, end);
  return [
    ...rows.slice(0, i),
    ...rows.slice(end, nextEnd),
    ...block,
    ...rows.slice(nextEnd),
  ];
}

/** The top-level row a "Put under" would nest row `i` under, or -1. */
export function indentTarget(rows: readonly NavRow[], i: number): number {
  if (rows[i]?.depth !== 0 || i === 0) return -1;
  return parentIndex(rows, i - 1);
}

/** Put a top-level row (never one with children) under the previous top-level row. */
export function indent(
  rows: readonly NavRow[],
  i: number,
  limits: NavLimits = MENU_LIMITS,
): NavRowsResult {
  const parent = indentTarget(rows, i);
  if (parent === -1) return { error: NAV_COPY.limit };
  if (hasChildren(rows, i)) return { error: NAV_NEST_PARENT_COPY };
  const next = rows.map((r, k) => (k === i ? { ...r, depth: 1 as const } : r));
  return checkRows(next, limits);
}

/** Move a child out of its dropdown, to just after its parent's block. */
export function outdent(
  rows: readonly NavRow[],
  i: number,
  limits: NavLimits = MENU_LIMITS,
): NavRowsResult {
  const row = rows[i];
  if (row?.depth !== 1) return { rows: [...rows] };
  const parent = parentIndex(rows, i);
  const end = blockEnd(rows, parent);
  const without = [...rows.slice(0, i), ...rows.slice(i + 1)];
  const at = end - 1;
  const next = [
    ...without.slice(0, at),
    { ...row, depth: 0 as const },
    ...without.slice(at),
  ];
  return checkRows(next, limits);
}

/** Remove a row; a top-level row takes its dropdown links with it. */
export function removeRow(
  rows: readonly NavRow[],
  i: number,
): { rows: NavRow[]; removed: NavRow[] } {
  const end = blockEnd(rows, i);
  return {
    rows: [...rows.slice(0, i), ...rows.slice(end)],
    removed: rows.slice(i, end),
  };
}

/**
 * Undo of a removal: put the removed rows back at `index` (clamped). A top-level block
 * never lands inside another dropdown, so it can't take over that dropdown's later links.
 * The caller runs the result through checkRows: the list may have changed since (WR-E01).
 */
export function restoreRows(
  rows: readonly NavRow[],
  removed: readonly NavRow[],
  index: number,
): NavRow[] {
  const ids = new Set(rows.map((r) => r.id));
  const back = removed.filter((r) => !ids.has(r.id));
  let at = Math.max(0, Math.min(index, rows.length));
  if (back[0]?.depth === 0) while (rows[at]?.depth === 1) at += 1;
  return [...rows.slice(0, at), ...back, ...rows.slice(at)];
}

/**
 * A drag drop: move the dragged row's block to the drop row's place. `depthIntent` comes
 * from the horizontal drag offset (>= 24px nests under the row above, <= -24px moves out).
 */
export function moveRow(
  rows: readonly NavRow[],
  from: number,
  to: number,
  depthIntent: 0 | 1 | null,
  limits: NavLimits = MENU_LIMITS,
): NavRowsResult {
  const row = rows[from];
  if (!row || to < 0 || to >= rows.length) return { rows: [...rows] };
  const end = blockEnd(rows, from);
  const block = rows.slice(from, end);
  if (to >= from && to < end && depthIntent === null)
    return { rows: [...rows] };
  const rest = [...rows.slice(0, from), ...rows.slice(end)];
  let at: number;
  if (to < from) at = to;
  else if (to < end) at = from;
  else at = to - block.length + 1;
  at = Math.max(0, Math.min(at, rest.length));
  let depth: 0 | 1 = depthIntent ?? row.depth;
  if (block.length > 1) {
    if (depthIntent === 1) return { error: NAV_NEST_PARENT_COPY };
    depth = 0;
  }
  if (depth === 1 && at === 0) depth = 0;
  // A top-level drop inside another dropdown goes after that dropdown's links, so it
  // never takes them over (WR-E02).
  if (depth === 0) while (rest[at]?.depth === 1) at += 1;
  const moved = block.map((r, k) => (k === 0 ? { ...r, depth } : r));
  return checkRows([...rest.slice(0, at), ...moved, ...rest.slice(at)], limits);
}

/** Replace one row's link (Edit). */
export function updateRow(
  rows: readonly NavRow[],
  id: string,
  link: NavLink,
): NavRow[] {
  return rows.map((r) => (r.id === id ? { ...r, link: { ...link, id } } : r));
}
