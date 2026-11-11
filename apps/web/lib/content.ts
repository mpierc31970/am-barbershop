// Content dependencies for every @cds/db writer called from apps/web (CONT-02, CONT-31;
// RESEARCH Pattern 3). One place wires the composed registry, the Next invalidator and the
// stand-in scanner and pinger (GO-LIVE rows P6/P13 and P14 swap them by env, not code).
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { getContentScanner, getSearchPinger, type PublishDeps } from "@cds/db";
import { nextInvalidator } from "./invalidator";
import { SECTION_REGISTRY } from "./section-registry";

export function contentDeps(): PublishDeps {
  return {
    sections: SECTION_REGISTRY,
    invalidator: nextInvalidator,
    scanner: getContentScanner(),
    pinger: getSearchPinger(),
    // 07-31: the site index calls active add-ons' publicIndex hooks (CONT-37).
    addons: ADDON_REGISTRY,
  };
}
