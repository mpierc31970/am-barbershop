// P8 (08-11 choice 1): the preview host suffix. ensurePreviewHost itself runs against the
// real PocketBase in test/assembly-parts.integration.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { previewHostSuffix } from "./preview-host";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("previewHostSuffix", () => {
  it("defaults to sites.localhost outside production", () => {
    vi.stubEnv("CDS_PREVIEW_HOST_SUFFIX", "");
    vi.stubEnv("CDS_ENV", "dev");
    expect(previewHostSuffix()).toBe("sites.localhost");
  });

  it("defaults to the CDS preview domain in production", () => {
    vi.stubEnv("CDS_PREVIEW_HOST_SUFFIX", "");
    vi.stubEnv("CDS_ENV", "production");
    expect(previewHostSuffix()).toBe("sites.connectionsdesignstudios.com");
  });

  it("normalises a set value", () => {
    vi.stubEnv("CDS_PREVIEW_HOST_SUFFIX", " Preview.Example.COM. ");
    expect(previewHostSuffix()).toBe("preview.example.com");
  });

  it.each(["bad host", "1.2.3.4", "-x.example.com", "a..b", "*.example.com"])(
    "%s throws naming the variable",
    (v) => {
      vi.stubEnv("CDS_PREVIEW_HOST_SUFFIX", v);
      expect(() => previewHostSuffix()).toThrow(/CDS_PREVIEW_HOST_SUFFIX/);
    },
  );
});
