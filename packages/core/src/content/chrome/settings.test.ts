// 07-26 Task 1: site settings rules (CONT-29, CONT-15 toggle, CONT-34; D237).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../../errors";
import {
  HIDE_TRANSLATE_ATTR,
  PAGE_KIND_FLAGS,
  SITE_LANGUAGES,
  SITE_SETTINGS_COPY,
  SITE_SETTINGS_DEFAULTS,
  hidesTranslate,
  hidesTranslateIn,
  mergeSiteSettings,
  normalizeLanguageTag,
  resolveSiteSettings,
  storedSiteSettings,
  translateUrl,
  validateSiteSettingsPatch,
} from "./settings";

describe("normalizeLanguageTag", () => {
  it.each([
    ["en", "en"],
    [" PT-br ", "pt-BR"],
    ["zh-hans", "zh-Hans"],
    ["zh-Hant-TW", "zh-Hant-TW"],
    ["yue", "yue"],
    ["es-419", "es-419"],
  ])("%j -> %j", (raw, want) => {
    expect(normalizeLanguageTag(raw)).toBe(want);
  });

  it.each([
    "",
    "e",
    "english",
    "en_US",
    "en--US",
    "<script>",
    "en-" + "a".repeat(33),
    5,
    null,
    undefined,
  ])("%j -> null", (raw) => {
    expect(normalizeLanguageTag(raw)).toBeNull();
  });

  it("every select-list code is canonical", () => {
    expect(SITE_LANGUAGES).toHaveLength(11);
    for (const l of SITE_LANGUAGES)
      expect(normalizeLanguageTag(l.code)).toBe(l.code);
  });
});

describe("validateSiteSettingsPatch", () => {
  it("empty in, empty out", () => {
    expect(validateSiteSettingsPatch({})).toEqual({});
  });

  it("normalises the language", () => {
    expect(validateSiteSettingsPatch({ language: "PT-br" })).toEqual({
      language: "pt-BR",
    });
  });

  it("refuses a bad language with the inline copy", () => {
    expect(() => validateSiteSettingsPatch({ language: "nope!" })).toThrow(
      new InvalidInput(SITE_SETTINGS_COPY.invalidLanguage),
    );
  });

  it.each(["true", 1, null])("refuses a non-boolean switch %j", (v) => {
    expect(() => validateSiteSettingsPatch({ show_search: v })).toThrow(
      InvalidInput,
    );
  });

  it("drops unknown, org, held and inherited keys", () => {
    const proto = { show_translate: true };
    const raw = Object.create(proto) as Record<string, unknown>;
    raw.organization = "B";
    raw.held = true;
    raw.junk = 1;
    raw.allow_ai_crawlers = false;
    expect(validateSiteSettingsPatch(raw)).toEqual({
      allow_ai_crawlers: false,
    });
  });

  it("refuses a non-object", () => {
    expect(() => validateSiteSettingsPatch("x")).toThrow(InvalidInput);
  });
});

describe("resolveSiteSettings / mergeSiteSettings / storedSiteSettings", () => {
  it("all missing -> defaults", () => {
    expect(resolveSiteSettings({})).toEqual(SITE_SETTINGS_DEFAULTS);
  });

  it("a bad language falls back alone", () => {
    expect(
      resolveSiteSettings({
        language: "<b>",
        settings: { show_translate: true, show_search: true },
        seo: { allow_ai_crawlers: false },
      }),
    ).toEqual({
      language: "en",
      show_translate: true,
      show_search: true,
      allow_ai_crawlers: false,
      share_image: "",
    });
  });

  it("malformed settings / seo default their own switches", () => {
    expect(
      resolveSiteSettings({
        language: "es",
        settings: "x",
        seo: { allow_ai_crawlers: "no" },
      }),
    ).toEqual({ ...SITE_SETTINGS_DEFAULTS, language: "es" });
    expect(resolveSiteSettings({ seo: {} }).allow_ai_crawlers).toBe(true);
    expect(resolveSiteSettings({ seo: [] }).allow_ai_crawlers).toBe(true);
  });

  it("merges a patch onto the current group", () => {
    expect(
      mergeSiteSettings(
        { ...SITE_SETTINGS_DEFAULTS, language: "es", show_translate: true },
        { show_search: true },
      ),
    ).toEqual({
      language: "es",
      show_translate: true,
      show_search: true,
      allow_ai_crawlers: true,
      share_image: "",
    });
  });

  it("keeps other seo keys when storing", () => {
    const stored = storedSiteSettings(
      { ...SITE_SETTINGS_DEFAULTS, allow_ai_crawlers: false },
      { title_suffix: "x", allow_ai_crawlers: true },
    );
    expect(stored).toEqual({
      language: "en",
      settings: { show_translate: false, show_search: false },
      seo: { title_suffix: "x", allow_ai_crawlers: false },
    });
    expect(storedSiteSettings(SITE_SETTINGS_DEFAULTS, "junk").seo).toEqual({
      allow_ai_crawlers: true,
    });
  });
});

describe("translateUrl", () => {
  it("builds the public Google Translate link", () => {
    expect(translateUrl("https://rivera.com/menu", "es-MX")).toBe(
      "https://translate.google.com/translate?sl=auto&tl=es-MX&u=https%3A%2F%2Frivera.com%2Fmenu",
    );
  });

  it("an unusable visitor language -> en", () => {
    expect(translateUrl("https://rivera.com/", "xx_bad")).toContain("tl=en&");
    expect(translateUrl("https://rivera.com/", "")).toContain("tl=en&");
  });

  it.each(["javascript:alert(1)", "ftp://x", "not a url"])(
    "%j -> null",
    (u) => {
      expect(translateUrl(u, "en")).toBeNull();
    },
  );
});

describe("hidesTranslate", () => {
  it("core kinds and unknown kinds show Translate", () => {
    expect(hidesTranslate("builder")).toBe(false);
    expect(hidesTranslate("system-404")).toBe(false);
    expect(hidesTranslate("nope")).toBe(false);
    expect(hidesTranslate("__proto__")).toBe(false);
    expect(hidesTranslate(undefined)).toBe(false);
  });

  it("a flagged kind hides it", () => {
    const flags = {
      ...PAGE_KIND_FLAGS,
      checkout: { hideTranslate: true as const },
    };
    expect(hidesTranslateIn(flags, "checkout")).toBe(true);
    expect(hidesTranslateIn(flags, "builder")).toBe(false);
  });

  it("marker attribute name", () => {
    expect(HIDE_TRANSLATE_ATTR).toBe("data-cds-hide-translate");
  });
});

describe("site share image (07-30, CONT-28)", () => {
  it("validates the id", () => {
    expect(
      validateSiteSettingsPatch({ share_image: "abc123def456ghi" }),
    ).toEqual({
      share_image: "abc123def456ghi",
    });
    expect(validateSiteSettingsPatch({ share_image: "" })).toEqual({
      share_image: "",
    });
    for (const bad of ["../x", "ABC123DEF456GHI", "abc", 5, null]) {
      expect(() => validateSiteSettingsPatch({ share_image: bad })).toThrow(
        InvalidInput,
      );
    }
    expect(SITE_SETTINGS_COPY.shareImageInvalid).toBe(
      "Choose a photo from your media.",
    );
  });

  it("a malformed stored value resolves to empty", () => {
    expect(
      resolveSiteSettings({ seo: { share_image: "../etc" } }).share_image,
    ).toBe("");
    expect(
      resolveSiteSettings({ seo: { share_image: "abc123def456ghi" } })
        .share_image,
    ).toBe("abc123def456ghi");
  });

  it("stores share_image beside allow_ai_crawlers, keeping other seo keys", () => {
    const stored = storedSiteSettings(
      {
        ...SITE_SETTINGS_DEFAULTS,
        allow_ai_crawlers: false,
        share_image: "abc123def456ghi",
      },
      {
        title_suffix: "x",
        allow_ai_crawlers: false,
        share_image: "old000000000000",
      },
    );
    expect(stored.seo).toEqual({
      title_suffix: "x",
      allow_ai_crawlers: false,
      share_image: "abc123def456ghi",
    });
    const cleared = storedSiteSettings(SITE_SETTINGS_DEFAULTS, stored.seo);
    expect(cleared.seo).toEqual({ title_suffix: "x", allow_ai_crawlers: true });
  });
});
