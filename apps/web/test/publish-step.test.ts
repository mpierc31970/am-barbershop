// WR-B04: a Publish click checks unsaved block edits before "no changes".
import type { HeaderPage } from "@cds/ui/builder";
import { describe, expect, it } from "vitest";
import {
  publishLooksDisabled,
  publishStep,
} from "../app/(platform)/hub/website/pages/[pageId]/publish-step";

const PUBLISHED_CLEAN: HeaderPage = {
  status: "published",
  published_at: "2026-09-20 10:00:00.000Z",
  has_unpublished_changes: false,
};
const PUBLISHED_PENDING: HeaderPage = {
  ...PUBLISHED_CLEAN,
  has_unpublished_changes: true,
};

describe("publishStep (WR-B04)", () => {
  it("opens the save dialog for unsaved edits on a clean published page", () => {
    expect(
      publishStep({
        publishing: false,
        formDirty: true,
        page: PUBLISHED_CLEAN,
      }),
    ).toBe("guard");
  });

  it("does nothing on a clean published page with no open edits", () => {
    expect(
      publishStep({
        publishing: false,
        formDirty: false,
        page: PUBLISHED_CLEAN,
      }),
    ).toBe("no_changes");
  });

  it("publishes after Save and continue marked the page changed", () => {
    expect(
      publishStep({
        publishing: false,
        formDirty: false,
        page: PUBLISHED_PENDING,
      }),
    ).toBe("publish");
  });

  it("ignores clicks while a publish is running", () => {
    expect(
      publishStep({ publishing: true, formDirty: true, page: PUBLISHED_CLEAN }),
    ).toBe("busy");
  });

  it("keeps the button enabled while the form is dirty", () => {
    expect(publishLooksDisabled(true, true)).toBe(false);
    expect(publishLooksDisabled(true, false)).toBe(true);
    expect(publishLooksDisabled(false, false)).toBe(false);
  });
});
