// Icon list ids map to lucide-react exports (07-07; CONT-27, CONTEXT decision 5). 07-21's
// IconPicker turns each kebab-case id into its PascalCase component name.
import { ICON_LIST_ICON_IDS } from "@cds/core/content";
import * as lucide from "lucide-react";
import { describe, expect, it } from "vitest";

function pascal(id: string): string {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

describe("ICON_LIST_ICON_IDS", () => {
  it("has 60 unique ids", () => {
    expect(ICON_LIST_ICON_IDS).toHaveLength(60);
    expect(new Set(ICON_LIST_ICON_IDS).size).toBe(60);
  });

  it("every id is a lucide-react export", () => {
    const exports = lucide as unknown as Record<string, unknown>;
    const missing = ICON_LIST_ICON_IDS.filter(
      (id) => exports[pascal(id)] === undefined,
    );
    expect(missing).toEqual([]);
    expect(pascal("flower-2")).toBe("Flower2");
  });
});
