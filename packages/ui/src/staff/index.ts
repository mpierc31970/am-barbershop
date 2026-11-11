// @cds/ui/staff (13-07; 13-UI-SPEC "New staff components"). Staff console UI only: never
// imported by tenant or hub routes. One sub-barrel per console area; each is owned by the
// plan named in its header (13-EXECUTOR-BRIEF "Module seams"). Owners fill their sub-barrel,
// nobody edits this file. Names must stay unique across sub-barrels (export * collisions).
export * from "./table";
export * from "./shell";
export * from "./dialogs";
export * from "./sites";
export * from "./pipeline";
export * from "./tickets";
export * from "./windows";
export * from "./review";
export * from "./catalog";
export * from "./indexing";
export * from "./health";
export * from "./settings";
export * from "./today";
// P14 exception (14-02, P14-P1): the one line added after P13; filled by 14-38.
export * from "./domain";
