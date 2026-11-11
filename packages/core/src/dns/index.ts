// packages/core/src/dns/index.ts: @cds/core/dns barrel.
// Owner: 14-02 (P14-P1, 14-EXECUTOR-BRIEF "Module seams"). Fixed: module owners fill bodies, never this file.
// Names must stay unique across modules (export * collisions fail typecheck).
export * from "./record";
export * from "./classify";
export * from "./bind";
export * from "./gate";
export * from "./providers";
export * from "./selectors";
export * from "./registrar";
export * from "./presets";
export * from "./domain-input";
export * from "./copy";
