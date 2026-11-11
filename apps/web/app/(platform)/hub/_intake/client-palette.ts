// The browser half of the mood board palette (06-21; ONB-05, D47, CONTEXT A4-Q2; 06-UI-SPEC
// "Mood board" states). On pick, before the upload finishes, the photo is decoded with its
// camera orientation applied, drawn at <= 128px on the long side (downsampleSize, the same
// size the server samples), read back as sRGB pixels and run through the SAME pure
// extractPalette + proposeRoles the server runs after upload. The server's result replaces
// this one silently (usually identical). Nothing here writes anywhere: a proposal is data for
// the preview only and never touches the live theme (D47).
// T-06-101: a file over 20 MB is refused before any decode, and only the small sample is
// ever read back.
import {
  downsampleSize,
  extractPalette,
  proposeRoles,
  type MoodboardProposal,
} from "@cds/core/theme";

export const CLIENT_PALETTE_MAX_BYTES = 20 * 1024 * 1024;

type Ctx2d = {
  drawImage(
    img: CanvasImageSource,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void;
  getImageData(
    x: number,
    y: number,
    w: number,
    h: number,
    settings?: { colorSpace?: "srgb" | "display-p3" },
  ): ImageData;
};

function canvas2d(width: number, height: number): Ctx2d | null {
  if (typeof OffscreenCanvas === "function") {
    const c = new OffscreenCanvas(width, height);
    return c.getContext("2d", { willReadFrequently: true }) as Ctx2d | null;
  }
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c.getContext("2d", { willReadFrequently: true }) as Ctx2d | null;
  }
  return null;
}

/** Pick -> proposal. Throws when the browser can't decode or read the image. */
export async function paletteFromFile(file: File): Promise<MoodboardProposal> {
  if (!file || file.size > CLIENT_PALETTE_MAX_BYTES) {
    throw new Error("palette: file too large");
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error("palette: no image decoder");
  }
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const { width, height } = downsampleSize(bitmap.width, bitmap.height);
    if (width < 1 || height < 1) throw new Error("palette: empty image");
    const ctx = canvas2d(width, height);
    if (!ctx) throw new Error("palette: no canvas");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const img = ctx.getImageData(0, 0, width, height, { colorSpace: "srgb" });
    const swatches = extractPalette({
      data: img.data,
      width: img.width,
      height: img.height,
    });
    return proposeRoles(swatches);
  } finally {
    bitmap.close?.();
  }
}

const HEX = /^#[0-9a-f]{6}$/;
const ROLE_KEYS = [
  "surface",
  "surface-raised",
  "text",
  "text-muted",
  "primary",
  "primary-contrast",
  "accent",
  "border",
] as const;

/** A server or stored proposal is shaped right (eight #rrggbb roles, a swatch list). */
export function isProposal(v: unknown): v is MoodboardProposal {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  const roles = p.roles as Record<string, unknown> | undefined;
  if (typeof roles !== "object" || roles === null) return false;
  if (
    !ROLE_KEYS.every(
      (k) => typeof roles[k] === "string" && HEX.test(roles[k] as string),
    )
  ) {
    return false;
  }
  return Array.isArray(p.swatches) && Array.isArray(p.adjustments ?? []);
}
