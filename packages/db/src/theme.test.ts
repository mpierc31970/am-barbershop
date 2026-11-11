// Theme chokepoint unit cases (THEME-01..03). The DB paths are proven in
// packages/db/test/theme.integration.test.ts.
import { describe, expect, it } from "vitest";
import * as root from "./index";
import { themeTag } from "./theme";

describe("theme chokepoint surface", () => {
  it("themeTag is the org's theme cache tag", () => {
    expect(themeTag("abc")).toBe("org:abc:theme");
  });

  it("exports the writer, both readers and the tag from the @cds/db root", () => {
    const names = Object.keys(root);
    for (const n of [
      "setOrganizationDesign",
      "readPublicDesign",
      "readOrganizationDesign",
      "themeTag",
      "ORGANIZATION_PUBLIC_FIELDS",
    ]) {
      expect(names).toContain(n);
    }
  });
});
