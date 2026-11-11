// @cds/core/content: the Edge-safe, dependency-free page-builder content model (CONT-01..07,
// CONT-32). The Node-only rich-text cleaner is deliberately NOT re-exported here; import it
// from its own subpath so it never reaches the Edge bundle (RESEARCH Pitfall 1). Test-only
// add-on definitions are never exported either.
export * from "./types";
export * from "./layouts";
export * from "./columns";
export * from "./validate";
export * from "./registry";
export * from "./headings";
export * from "./plain-text";
export * from "./countdown";
export * from "./banner";
export * from "./popup-rules";
export * from "./tel";
// P7 seams (07-02). Validator helpers are a namespace: their names are too generic for the
// flat barrel. Block, item and chrome public exports each come from their own barrel.
export * as contentValidators from "./validate-helpers";
export * from "./blocks";
export * from "./items";
export * from "./chrome";
export * from "./gate-copy";
export * from "./views";
// P11 page allowance (11-07; DASH-08, D185, D273).
export * from "./allowance";
