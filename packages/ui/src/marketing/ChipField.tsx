// Owner: 15-09 (P15-P1). ChipField: a full-bleed section ground (UI-SPEC components, field scopes).
// It only sets data-mk-field; tokens.css applies the ground and the fg / muted / focus / action vars
// for that field, so everything inside follows the closed colour code.
import type { HTMLAttributes, ReactNode } from "react";

export type MkFieldName =
  | "card"
  | "stock"
  | "cobalt"
  | "berry"
  | "violet"
  | "leaf"
  | "teal"
  | "marigold"
  | "rose"
  | "sky"
  | "tangerine"
  | "ink";

export type ChipFieldProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  field: MkFieldName;
  as?: "section" | "div" | "aside" | "header" | "footer" | "article";
  children?: ReactNode;
};

export function ChipField({
  field,
  as: Tag = "section",
  children,
  ...rest
}: ChipFieldProps) {
  return (
    <Tag data-mk-field={field} {...rest}>
      {children}
    </Tag>
  );
}
