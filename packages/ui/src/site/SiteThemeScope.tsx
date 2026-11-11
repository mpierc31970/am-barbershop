// The tenant theme scope (THEME-02, D46, D-UI-P4-10; RESEARCH Patterns 3 and 4). One wrapper
// carries data-site (the --site-* token contract) and data-theme=<hash8>; its first child is
// the org's theme <style>, whose [data-site][data-theme="<hash>"] rule beats the neutral
// [data-site] fallbacks in globals.css by specificity. Changing organization.design changes
// the page at the next render, no deploy.
//
// T-04-34: css must come from resolveTheme (@cds/core/theme), whose per-token grammar lets
// nothing outside the --site-* value grammar through. The hash is re-checked here, and React
// escapes the style text as a backstop. Server component: no hooks, no next/*.
import type { ReactNode } from "react";

const HASH8 = /^[0-9a-f]{8}$/;
const NEUTRAL = "00000000";

export type SiteThemeScopeProps = {
  theme: { hash: string; css: string };
  as?: "div" | "span";
  className?: string;
  lang?: string;
  inert?: boolean;
  children?: ReactNode;
};

export function SiteThemeScope({
  theme,
  as = "div",
  className,
  lang,
  inert,
  children,
}: SiteThemeScopeProps) {
  const As = as;
  const hash = HASH8.test(theme.hash) ? theme.hash : NEUTRAL;
  return (
    <As
      data-site=""
      data-theme={hash}
      className={className}
      lang={lang}
      inert={inert}
    >
      <style>{theme.css}</style>
      {children}
    </As>
  );
}
