// Types for the plain-ESM generator so TS tests import it without allowJs (05-03 pattern).
export declare const HEADER: string;
export declare const DEFAULT_ROOT: string;
export type DiscoveredAddon = { slug: string; name: string };
export type HowToDoc = { path: string; text: string };
export type RenderInput = {
  addons: readonly DiscoveredAddon[];
  howtos: readonly HowToDoc[];
  runbooks: readonly string[];
  /** 11-46: every tenant how-to, baked into help.ts. */
  helpHowtos?: readonly HowToDoc[];
  /** 13-01: staff console how-tos (route starts /staff), baked into staff-help.ts. */
  staffHowtos?: readonly HowToDoc[];
};
export type StepRow = { screen: string; action: string; expected: string };
export declare const HELP_SKIP: readonly string[];
export declare const STAFF_ROUTE: RegExp;
export declare const CONSOLE_ROUTE: RegExp;
export declare const SUMMARY_MAX: number;
export declare function discover(repoRoot?: string): DiscoveredAddon[];
export declare function readHowtos(repoRoot?: string): HowToDoc[];
export declare function readHelpHowtos(repoRoot?: string): HowToDoc[];
export declare function readStaffHowtos(repoRoot?: string): HowToDoc[];
export declare function isStaffHowto(text: string): boolean;
export declare function isConsoleHowto(text: string): boolean;
export declare function partitionHowtos(items: readonly HowToDoc[]): {
  help: HowToDoc[];
  staff: HowToDoc[];
};
export declare function parseTitle(md: string): string;
export declare function readRunbooks(repoRoot?: string): string[];
export declare function parseStepTable(md: string, heading: string): StepRow[];
export declare function parseUseSteps(md: string): StepRow[];
export declare function parseFrontMatter(md: string): Record<string, string>;
export declare function plainText(s: string): string;
export declare function parseSummary(md: string): string;
export declare function render(input: RenderInput): Record<string, string>;
export declare function collect(repoRoot?: string): RenderInput;
export declare function staleFiles(
  files: Record<string, string>,
  read: (rel: string) => string | null,
): string[];
