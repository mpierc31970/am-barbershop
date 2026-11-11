// Gallery and logo strip editor logic (07-22; CONT-22, CONT-27, D-UI-P7-5, D119/D120;
// 07-22 decision 6). Pure, named exports.
//
// Description pre-fill for bulk adds: a pick the library already describes gets alt "" (use
// the library description) and alt_reviewed true; a pick that needs a description gets a
// sentence from its file name, or "Photo N" (its 1-based position after adding), and stays
// amber (alt_reviewed false) until the owner edits it.
// altFromFileName mirrors @cds/db altSuggestionFromName (07-12; @cds/ui cannot import
// @cds/db); pinned by apps/web/test/gallery-alt-drift.test.ts.
// Limits come from @cds/core/content and are never re-typed.
import {
  GALLERY_LIMITS,
  LOGO_STRIP_LIMITS,
  type GalleryImage,
  type LogoStripLogo,
} from "@cds/core/content";
import type { PickedMedia } from "../../hub/media/copy";

const SUGGESTION_MAX = 250;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

// Names a camera, phone or screenshot tool gives: they say nothing about the photo.
const CAMERA_RES: readonly RegExp[] = [
  /^(img|dsc|dscn|dscf|dcim|pxl|mvimg|gopr|gp|dji|vid|photo|image|pic|scan|wp|sam|p)[\s_-]*\d/i,
  /^screen\s?shot\b/i,
  /^screenshot/i,
  /^\d[\d\s_.-]*$/,
];

/** "loaves-cooling_on-rack.jpg" -> "Loaves cooling on rack"; camera-style names -> "". */
export function altFromFileName(name: unknown): string {
  if (typeof name !== "string") return "";
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(CONTROL_RE, "")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .trim();
  if (base === "") return "";
  if (CAMERA_RES.some((re) => re.test(base))) return "";
  const words = base
    .split(/[-_.\s]+/)
    .filter((w) => w !== "")
    .join(" ")
    .toLowerCase();
  if (!/[a-z]/.test(words)) return "";
  const text = words.charAt(0).toUpperCase() + words.slice(1);
  return text.slice(0, SUGGESTION_MAX).trim();
}

/** Picks a list can take: images only, each asset once (already there or repeated). */
function freshPicks(
  taken: ReadonlySet<string>,
  picks: readonly PickedMedia[],
): PickedMedia[] {
  const seen = new Set(taken);
  const out: PickedMedia[] = [];
  for (const p of picks) {
    if (!p || p.kind !== "image" || typeof p.id !== "string" || p.id === "")
      continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

export type GalleryAddResult = {
  images: GalleryImage[];
  /** Images this call appended (in order). */
  added: GalleryImage[];
  /** True when some picks did not fit under GALLERY_LIMITS.maxImages. */
  overflow: boolean;
};

/** Append picks in order with the description pre-fill rule (decision 6). */
export function galleryImagesFromPicks(
  existing: readonly GalleryImage[],
  picks: readonly PickedMedia[],
  newId: () => string,
): GalleryAddResult {
  const fresh = freshPicks(new Set(existing.map((i) => i.asset)), picks);
  const room = Math.max(0, GALLERY_LIMITS.maxImages - existing.length);
  const fitting = fresh.slice(0, room);
  const added = fitting.map((p, k): GalleryImage => {
    const position = existing.length + k + 1;
    return p.needsDescription
      ? {
          id: newId(),
          asset: p.id,
          alt: (altFromFileName(p.name) || `Photo ${position}`).slice(
            0,
            GALLERY_LIMITS.altMax,
          ),
          alt_reviewed: false,
          caption: "",
        }
      : {
          id: newId(),
          asset: p.id,
          alt: "",
          alt_reviewed: true,
          caption: "",
        };
  });
  return {
    images: [...existing, ...added],
    added,
    overflow: fresh.length > fitting.length,
  };
}

export type LogoAddResult = { logos: LogoStripLogo[]; overflow: boolean };

/** Append logo picks: name = library description, else a file-name sentence, else "". */
export function logosFromPicks(
  existing: readonly LogoStripLogo[],
  picks: readonly PickedMedia[],
  newId: () => string,
): LogoAddResult {
  const fresh = freshPicks(new Set(existing.map((l) => l.asset)), picks);
  const room = Math.max(0, LOGO_STRIP_LIMITS.maxLogos - existing.length);
  const fitting = fresh.slice(0, room);
  const added = fitting.map((p): LogoStripLogo => ({
    id: newId(),
    asset: p.id,
    name: (
      (p.needsDescription ? "" : p.alt.trim()) ||
      altFromFileName(p.name) ||
      ""
    ).slice(0, LOGO_STRIP_LIMITS.nameMax),
    link: "",
  }));
  return {
    logos: [...existing, ...added],
    overflow: fresh.length > fitting.length,
  };
}

/** Move one entry; out-of-range moves return an unchanged copy. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length ||
    from === to
  ) {
    return next;
  }
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** The next amber photo after `fromIndex` (wrapping), never `fromIndex` itself; -1 if none. */
export function nextNeedingDescription(
  images: readonly Pick<GalleryImage, "alt_reviewed">[],
  fromIndex: number,
): number {
  const n = images.length;
  for (let step = 1; step <= n; step++) {
    const i = (((fromIndex + step) % n) + n) % n;
    if (i === fromIndex) continue;
    if (images[i] && images[i].alt_reviewed === false) return i;
  }
  return -1;
}

/** How many photos are still amber. */
export function countNeedingDescription(
  images: readonly Pick<GalleryImage, "alt_reviewed">[],
): number {
  return images.filter((i) => i.alt_reviewed === false).length;
}
