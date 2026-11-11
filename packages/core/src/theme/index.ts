// @cds/core/theme: the Edge-safe, dependency-free theming model (THEME-01..06, D44-D48,
// CONTEXT A2-Q1, D-UI-P4-1): the role vocabulary, the contrast pair table, the design types,
// the colour maths, the solver, the validator, the font catalog, the neutral preset and the
// render-time emitter. The Node-only importer (yaml, node:fs) lives on
// "@cds/core/theme/import" and must never be re-exported here, so it never reaches the Edge
// bundle. The @cds/core root does not re-export this subpath either.
export * from "./types";
export * from "./roles";
export * from "./color";
export * from "./contrast";
export * from "./fonts";
export * from "./grammar";
export * from "./neutral";
export * from "./validate";
export * from "./solver";
export * from "./emit";
export * from "./palette";
export * from "./pairings";
export * from "./propose";
