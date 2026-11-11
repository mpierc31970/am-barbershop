// Brand icon (07-24; D-UI-P7-6): one vendored Simple Icons path, monochrome in currentColor.
// Server-safe (no hooks), decorative (aria-hidden): the link or button carries the name.
import { BRAND_ICONS, type BrandId } from "./brands";

export interface BrandIconProps {
  id: BrandId | string;
  size?: number;
  className?: string;
}

export function BrandIcon({ id, size = 24, className }: BrandIconProps) {
  const icon = Object.prototype.hasOwnProperty.call(BRAND_ICONS, id)
    ? BRAND_ICONS[id as BrandId]
    : undefined;
  if (!icon) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={icon.path} />
    </svg>
  );
}
