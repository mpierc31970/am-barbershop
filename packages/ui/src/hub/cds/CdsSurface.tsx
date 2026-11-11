// CdsSurface (12-06 choice 3; 12-UI-SPEC lines 228-231; COMM-05, D83). The container for
// anything CDS says: --cds-tint ground, 1px --cds-border, 4px left rule in --cds-mark, 8px
// radius (the rule follows it), and the `data-cds-identity` marker the neutral-chrome test
// allows. Padding 16px (messages) or 24px (panels). `flush` drops the radius for full-width
// strips (the service notice strip). Buttons and links inside keep the hub roles: --cds-* is
// identity, never action.
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type SurfaceElement = "div" | "section" | "article" | "aside" | "li";

export type CdsSurfaceProps<E extends SurfaceElement = "div"> = {
  as?: E;
  padding?: "md" | "lg";
  flush?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<E>, "as" | "className" | "children">;

export function CdsSurface<E extends SurfaceElement = "div">({
  as,
  padding = "md",
  flush = false,
  className,
  children,
  ...rest
}: CdsSurfaceProps<E>) {
  const Tag = (as ?? "div") as ElementType;
  const cls =
    "border border-cds-border border-l-4 border-l-cds-mark bg-cds-tint text-hub-ink " +
    (padding === "lg" ? "p-6" : "p-4") +
    (flush ? "" : " rounded-lg") +
    (className ? ` ${className}` : "");
  return (
    <Tag {...rest} data-cds-identity="" className={cls}>
      {children}
    </Tag>
  );
}
