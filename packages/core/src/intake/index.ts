// @cds/core/intake: the seven stages, the typed intake schema with compile-time fallbacks,
// the snapshot the chokepoint fills, and "what's still needed" (ONB-01, ONB-02, ONB-03, D29,
// D312, CONTEXT A3). Pure and Edge/browser-safe; never re-exported from the @cds/core root.
export * from "./stages";
export * from "./snapshot";
export * from "./schema";
export * from "./fallbacks";
export * from "./still-needed";
export * from "./hours";
export * from "./validate";
export { TEAM_CSV, SERVICES_CSV } from "./csv-specs";
