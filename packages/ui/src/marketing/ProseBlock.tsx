// Owner: 15-09 (P15-P1). ProseBlock: the read-mode column (68ch, Body 18/1.55, pretty wrap) for
// hosting rules, privacy and unsubscribe (UI-SPEC components, Typography).
import type { ReactNode } from "react";

export type ProseBlockProps = {
  as?: "div" | "article" | "section";
  className?: string;
  children: ReactNode;
};

export function ProseBlock({
  as: Tag = "div",
  className,
  children,
}: ProseBlockProps) {
  return (
    <Tag
      className={[
        "max-w-[68ch] text-[18px] leading-[1.55] [text-wrap:pretty]",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </Tag>
  );
}
