// Staff CLI output helpers (A-WR-10): tenant-written text never reaches the terminal with
// control characters, so an ANSI/OSC sequence cannot rewrite or hide what staff read.
import { describe, expect, it } from "vitest";
import { safeText, table } from "./staff-cli";

describe("safeText", () => {
  it("shows every C0/C1 control character as ?", () => {
    expect(safeText("Bakery\u001b[2K\u001b[1A")).toBe("Bakery?[2K?[1A");
    expect(safeText("a\u0007b\u009bc\u007fd")).toBe("a?b?c?d");
    expect(safeText("line\nbreak\ttab\r")).toBe("line?break?tab?");
  });

  it("leaves plain text alone", () => {
    expect(safeText("Rivera Bakery, Austin (TX) - 100%")).toBe(
      "Rivera Bakery, Austin (TX) - 100%",
    );
  });
});

describe("table", () => {
  it("prints cells through safeText", () => {
    const out = table(
      ["NAME", "TYPE"],
      [["Evil\u001b]0;pwned\u0007", "bakery"]],
    );
    for (const line of out.split("\n")) {
      expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    }
    expect(out).toContain("Evil?]0;pwned?");
  });
});
