// LegalProse: the hub reading styles for policy text (09-UI-SPEC "Typography": Body 16/1.6,
// `##` -> 20/600, `###` -> 16/600, list items 8px apart, paragraphs 16px apart, 68ch,
// links underlined; no italics for emphasis).
//
// SECURITY (T-09-04-01): `html` MUST be the output of `renderLegalMarkdown` followed by
// `sanitizeLegalHtml` (09-17, 09-09, 09-23 callers). This component never parses markdown
// and never sanitises; it only injects what it is given. Never pass tenant input here.

export interface LegalProseProps {
  /** Pre-rendered, already sanitised HTML (renderLegalMarkdown + sanitizeLegalHtml). */
  html: string;
  className?: string;
}

const PROSE =
  "max-w-[68ch] font-hub text-base leading-[1.6] text-hub-ink " +
  "[&>*+*]:mt-4 " +
  "[&_h2]:text-xl [&_h2]:leading-tight [&_h2]:font-semibold " +
  "[&_h3]:text-base [&_h3]:font-semibold " +
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 " +
  "[&_li+li]:mt-2 [&_li::marker]:text-hub-ink-muted " +
  "[&_strong]:font-semibold [&_em]:not-italic [&_em]:font-semibold " +
  "[&_a]:text-hub-accent [&_a]:underline [&_a]:underline-offset-2 " +
  "[&_a:hover]:text-hub-accent-hover";

export function LegalProse({ html, className }: LegalProseProps) {
  return (
    <div
      className={`${PROSE}${className ? ` ${className}` : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
