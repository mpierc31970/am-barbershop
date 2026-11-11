// Assembly dependencies for the Send-to-CDS enqueue and the hourly sweep route (08-17
// choice 6; TMPL-02). One place wires the templates, the composed section registry, the copy
// writer (template stand-in until the GO-LIVE AI polish), the Next invalidator, the stand-in
// scanner and pinger, and the server add-on registry. Built per call: no module-level state.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import {
  getContentScanner,
  getCopyWriter,
  getSearchPinger,
  type AssemblyRunDeps,
} from "@cds/db";
import { TEMPLATES } from "@cds/templates";
import { nextInvalidator } from "./invalidator";
import { SECTION_REGISTRY } from "./section-registry";

export function assemblyDeps(): AssemblyRunDeps {
  return {
    templates: TEMPLATES,
    sections: SECTION_REGISTRY,
    copy: getCopyWriter(),
    invalidator: nextInvalidator,
    scanner: getContentScanner(),
    pinger: getSearchPinger(),
    registry: ADDON_REGISTRY,
  };
}
