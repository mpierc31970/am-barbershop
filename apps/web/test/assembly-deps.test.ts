// assemblyDeps() (08-17 choice 6): the templates, the composed section registry (core plus
// add-on blocks such as Services and Our Team), a CopyWriter and the server add-on registry.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { TEMPLATES } from "@cds/templates";
import { describe, expect, it } from "vitest";
import { assemblyDeps } from "../lib/assembly-deps";
import { nextInvalidator } from "../lib/invalidator";
import { SECTION_REGISTRY } from "../lib/section-registry";

describe("assemblyDeps (08-17)", () => {
  it("wires the templates, registries, copy writer and invalidator", () => {
    const d = assemblyDeps();
    expect(d.templates).toBe(TEMPLATES);
    expect(d.sections).toBe(SECTION_REGISTRY);
    expect(d.sections.get("services")).toBeDefined();
    expect(d.sections.get("team")).toBeDefined();
    expect(typeof d.copy.heroSubtitle).toBe("function");
    expect(d.invalidator).toBe(nextInvalidator);
    expect(d.registry).toBe(ADDON_REGISTRY);
    expect(d.scanner).toBeDefined();
    expect(d.pinger).toBeDefined();
  });

  it("builds a fresh object per call", () => {
    expect(assemblyDeps()).not.toBe(assemblyDeps());
  });
});
