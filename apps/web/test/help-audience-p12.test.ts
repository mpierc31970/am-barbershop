// Review IN-B03 (12-REVIEW part B): audienceMap() reads ownerOnly / ownerAdminOnly from the
// P12 training modules as well as P11, so an audience list added to p12/support.ts is honoured
// instead of silently reaching every role. The real P12 module has no list today, so this
// file mocks one in.
import { describe, expect, it, vi } from "vitest";

vi.mock("@cds/core/training", async (importOriginal) => {
  const real = await importOriginal<typeof import("@cds/core/training")>();
  return {
    ...real,
    P12_TRAINING_MODULES: [
      {
        ...real.P12_TRAINING_MODULES[0],
        ownerOnly: ["support.documents"],
        ownerAdminOnly: ["support.ideas"],
      },
    ],
  };
});

const { findHelpEntry, helpAudience } = await import("../lib/help-index");
const who = (role: "owner" | "admin" | "editor" | "viewer") => ({
  role,
  grants: [],
});

describe("P12 module audience lists (IN-B03)", () => {
  it("an ownerOnly id in a P12 module is Owner-only", () => {
    expect(helpAudience("support.documents")).toBe("owner");
    expect(findHelpEntry(who("owner"), [], "support.documents")).not.toBeNull();
    expect(findHelpEntry(who("admin"), [], "support.documents")).toBeNull();
    expect(findHelpEntry(who("viewer"), [], "support.documents")).toBeNull();
  });

  it("an ownerAdminOnly id in a P12 module is Owner and Admin only", () => {
    expect(helpAudience("support.ideas")).toBe("owner-admin");
    expect(findHelpEntry(who("admin"), [], "support.ideas")).not.toBeNull();
    expect(findHelpEntry(who("editor"), [], "support.ideas")).toBeNull();
  });

  it("other P12 articles stay readable by every role", () => {
    expect(findHelpEntry(who("viewer"), [], "support.messages")).not.toBeNull();
  });
});
