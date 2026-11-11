// Public media keys and the CONT-33 guard (07-09, D255).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidInput } from "@cds/core";
import type { PublicMediaKind, PublicMediaVariant } from "../media/ports";
import {
  FORM_UPLOAD_MAX_BYTES,
  FORM_UPLOAD_ORG_MAX_BYTES,
  MEDIA_WIDTHS,
  PUBLIC_MEDIA_KINDS,
  PUBLIC_MEDIA_VARIANTS,
  PUBLIC_VARIANTS_BY_KIND,
  SITE_ASSET_FILES,
  assertPublicMediaKey,
  assertPublicMediaPrefix,
  devMailKey,
  isPublicMediaKey,
  platformDbPrefix,
  publicMediaObjectName,
  publicVariantAllowed,
  tenantAddonBackupKey,
  tenantExportKey,
  tenantFormUploadKey,
  tenantFormUploadPrefix,
  tenantCdsDocumentKey,
  tenantSupportFileKey,
  tenantSupportPrefix,
  tenantSupportStagingKey,
  tenantMediaKey,
  tenantPublicMediaKey,
  tenantPublicMediaPrefix,
  tenantPublicSiteAssetKey,
  tenantSiteAssetKey,
  tenantPublishedPageKey,
  tenantSiteManifestKey,
  tenantSiteIndexKey,
  tenantVersionKey,
} from "./index";

const AT = new Date("2026-10-05T04:10:00.000Z");
let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env.CDS_ENV;
  delete process.env.CDS_ENV;
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.CDS_ENV;
  else process.env.CDS_ENV = savedEnv;
});

describe("public media key builders (07-09, CONT-33)", () => {
  it("builds kind/asset/file keys under dev/ and none in production", () => {
    expect(tenantPublicMediaKey("orga", "image", "abc123", "w960")).toBe(
      "dev/tenants/orga/media/image/abc123/w960.webp",
    );
    expect(tenantPublicMediaKey("orga", "image", "abc123", "thumb")).toBe(
      "dev/tenants/orga/media/image/abc123/thumb.webp",
    );
    expect(tenantPublicMediaKey("orga", "video", "v1", "video.mp4")).toBe(
      "dev/tenants/orga/media/video/v1/video.mp4",
    );
    expect(tenantPublicMediaKey("orga", "video", "v1", "poster.jpg")).toBe(
      "dev/tenants/orga/media/video/v1/poster.jpg",
    );
    expect(tenantPublicMediaKey("orga", "video", "v1", "poster.webp")).toBe(
      "dev/tenants/orga/media/video/v1/poster.webp",
    );
    expect(tenantPublicMediaKey("orga", "video", "v1", "captions.vtt")).toBe(
      "dev/tenants/orga/media/video/v1/captions.vtt",
    );
    expect(tenantPublicMediaKey("orga", "audio", "a1", "audio.mp3")).toBe(
      "dev/tenants/orga/media/audio/a1/audio.mp3",
    );
    expect(tenantPublicMediaPrefix("orga", "image", "abc123")).toBe(
      "dev/tenants/orga/media/image/abc123/",
    );
    process.env.CDS_ENV = "production";
    expect(tenantPublicMediaKey("orga", "image", "abc123", "w960")).toBe(
      "tenants/orga/media/image/abc123/w960.webp",
    );
  });

  it("maps object names", () => {
    expect(publicMediaObjectName("w480")).toBe("w480.webp");
    expect(publicMediaObjectName("w2560")).toBe("w2560.webp");
    expect(publicMediaObjectName("thumb")).toBe("thumb.webp");
    expect(publicMediaObjectName("audio.mp3")).toBe("audio.mp3");
    expect(MEDIA_WIDTHS).toEqual([480, 960, 1600, 2560]);
  });

  it("refuses variants not allowed for the kind, unknown kinds/variants and unsafe ids", () => {
    const bad: [string, string, string][] = [
      ["image", "abc", "video.mp4"],
      ["audio", "abc", "w960"],
      ["video", "abc", "audio.mp3"],
      ["image", "abc", "original.jpg"],
      ["image", "abc", "web"],
      ["file", "abc", "w960"],
      ["image", "../x", "w960"],
      ["image", "a/b", "w960"],
      ["image", "", "w960"],
      ["image", "ABC", "w960"],
      ["image", "a".repeat(65), "w960"],
    ];
    for (const [kind, id, variant] of bad) {
      expect(
        () =>
          tenantPublicMediaKey(
            "orga",
            kind as PublicMediaKind,
            id,
            variant as PublicMediaVariant,
          ),
        `${kind}/${id}/${variant}`,
      ).toThrow(InvalidInput);
    }
    expect(publicVariantAllowed("image", "w960")).toBe(true);
    expect(publicVariantAllowed("image", "video.mp4")).toBe(false);
    expect(publicVariantAllowed("nope", "w960")).toBe(false);
  });

  it("never emits a key outside tenants/<org>/media/ for any kind x variant x hostile id", () => {
    const hostile = [
      "versions",
      "exports",
      "backups",
      "published",
      "forms",
      "store",
      "media",
      "site",
    ];
    const shape =
      /^(dev\/)?tenants\/[a-z0-9_-]{1,64}\/media\/(image|video|audio)\/[a-z0-9_-]{1,64}\/[^/]+$/;
    for (const env of [undefined, "production"]) {
      if (env) process.env.CDS_ENV = env;
      else delete process.env.CDS_ENV;
      for (const kind of PUBLIC_MEDIA_KINDS) {
        for (const variant of PUBLIC_VARIANTS_BY_KIND[kind]) {
          for (const org of hostile) {
            for (const id of hostile) {
              const key = tenantPublicMediaKey(org, kind, id, variant);
              expect(key).toMatch(shape);
              const afterOrg = key.replace(/^(dev\/)?tenants\/[^/]+\//, "");
              expect(afterOrg.split("/")[0]).toBe("media");
              expect(isPublicMediaKey(key)).toBe(true);
            }
          }
        }
      }
      for (const org of hostile) {
        for (const file of SITE_ASSET_FILES) {
          const key = tenantPublicSiteAssetKey(org, file);
          expect(key).toMatch(
            /^(dev\/)?tenants\/[a-z0-9_-]{1,64}\/media\/site\/[^/]+$/,
          );
          expect(isPublicMediaKey(key)).toBe(true);
        }
      }
    }
  });

  it("covers every port variant", () => {
    const all = new Set(Object.values(PUBLIC_VARIANTS_BY_KIND).flat());
    expect([...all].sort()).toEqual([...PUBLIC_MEDIA_VARIANTS].sort());
  });

  it("builds site asset keys and refuses unknown files", () => {
    expect(tenantPublicSiteAssetKey("orga", "icon-32.png")).toBe(
      "dev/tenants/orga/media/site/icon-32.png",
    );
    expect(tenantPublicSiteAssetKey("orga", "share.png")).toBe(
      "dev/tenants/orga/media/site/share.png",
    );
    expect(() =>
      tenantPublicSiteAssetKey("orga", "favicon.ico" as "share.png"),
    ).toThrow(InvalidInput);
  });

  it("07-30: tenantSiteAssetKey covers the manifest and refuses traversal", () => {
    expect(tenantSiteAssetKey("orga", "manifest.json")).toBe(
      "dev/tenants/orga/media/site/manifest.json",
    );
    expect(isPublicMediaKey(tenantSiteAssetKey("orga", "icon-512.png"))).toBe(
      true,
    );
    for (const bad of ["../x", "icon-64.png", "manifest.json/../x", ""]) {
      expect(() => tenantSiteAssetKey("orga", bad as "share.png")).toThrow(
        InvalidInput,
      );
    }
    expect(() => tenantSiteAssetKey("../orgb", "share.png")).toThrow(
      InvalidInput,
    );
  });
});

describe("assertPublicMediaKey (CONT-33 guard)", () => {
  function privateKeys(): string[] {
    return [
      tenantExportKey("orga", AT),
      tenantVersionKey("orga", "page1", AT),
      tenantPublishedPageKey("orga", "page1"),
      tenantSiteManifestKey("orga"),
      tenantSiteIndexKey("orga"),
      tenantAddonBackupKey("orga", "events", AT),
      tenantFormUploadKey("orga", "form1", "sub1", "file1", "pdf"),
      tenantSupportFileKey("orga", "thr1", "msg1", "file1", "png"),
      tenantSupportStagingKey("orga", "user1", "up1", "pdf"),
      tenantCdsDocumentKey("orga", "doc1", "pdf"),
      tenantMediaKey("orga", "abc123", "original.jpg"),
      tenantMediaKey("orga", "image", "web.webp"),
      devMailKey(AT, "welcome", "message.html"),
      `${platformDbPrefix()}x`,
    ];
  }

  it("rejects every private builder's key in both envs", () => {
    for (const env of [undefined, "production"]) {
      if (env) process.env.CDS_ENV = env;
      else delete process.env.CDS_ENV;
      for (const key of privateKeys()) {
        expect(() => assertPublicMediaKey(key), key).toThrow(InvalidInput);
        expect(isPublicMediaKey(key)).toBe(false);
      }
    }
  });

  it("rejects hostile shapes", () => {
    const bad = [
      "dev/tenants/o/store/x",
      "dev/tenants/o/media/image/../w960.webp",
      "dev/tenants/o/media/image/a/../../versions/x.json",
      "dev/tenants/o/media/image/abc/w960.webp/extra",
      "dev/tenants/o/media/image/abc/x/w960.webp",
      "dev/tenants/o/media/image/abc/video.mp4",
      "dev/tenants/o/media/audio/abc/w960.webp",
      "dev/tenants/o/media/image/abc/w999.webp",
      "dev/tenants/o/media/image/abc/original.jpg",
      "dev/tenants/o/media/site/evil.png",
      "dev/tenants/O/media/image/abc/w960.webp",
      "tenants/o/media/image/abc/w960.webp", // wrong env prefix for dev
      "",
    ];
    for (const key of bad) {
      expect(() => assertPublicMediaKey(key), key).toThrow(InvalidInput);
    }
    process.env.CDS_ENV = "production";
    expect(() =>
      assertPublicMediaKey("dev/tenants/o/media/image/abc/w960.webp"),
    ).toThrow(InvalidInput);
    expect(() =>
      assertPublicMediaKey("tenants/o/media/image/abc/w960.webp"),
    ).not.toThrow();
  });

  it("guards list prefixes", () => {
    expect(() => assertPublicMediaPrefix("dev/tenants/o/media/")).not.toThrow();
    expect(() =>
      assertPublicMediaPrefix("dev/tenants/o/media/image/abc/"),
    ).not.toThrow();
    for (const p of [
      "",
      "dev/",
      "dev/tenants/",
      "dev/tenants/o/",
      "dev/tenants/o/versions/",
      "dev/tenants/o/medi",
      "tenants/o/media/",
    ]) {
      expect(() => assertPublicMediaPrefix(p), p).toThrow(InvalidInput);
    }
  });
});

describe("private form upload keys", () => {
  it("builds keys under forms/ and validates the extension", () => {
    expect(tenantFormUploadKey("orga", "form1", "sub1", "file1", "pdf")).toBe(
      "dev/tenants/orga/forms/form1/sub1/file1.pdf",
    );
    expect(tenantFormUploadPrefix("orga")).toBe("dev/tenants/orga/forms/");
    for (const ext of ["", "PDF", "p.f", "abcdefghi", "../x"]) {
      expect(
        () => tenantFormUploadKey("orga", "f", "s", "x", ext),
        ext,
      ).toThrow(InvalidInput);
    }
    expect(() => tenantFormUploadKey("orga", "../f", "s", "x", "pdf")).toThrow(
      InvalidInput,
    );
    expect(FORM_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(FORM_UPLOAD_ORG_MAX_BYTES).toBe(1024 ** 3);
  });
});

describe("private support keys (12-01; T-12-01-04)", () => {
  it("builds keys under tenants/<org>/support/", () => {
    expect(tenantSupportPrefix("orga")).toBe("dev/tenants/orga/support/");
    expect(tenantSupportFileKey("orga", "thr1", "msg1", "file1", "png")).toBe(
      "dev/tenants/orga/support/threads/thr1/msg1/file1.png",
    );
    expect(tenantSupportStagingKey("orga", "user1", "up1", "pdf")).toBe(
      "dev/tenants/orga/support/staging/user1/up1.pdf",
    );
    expect(tenantCdsDocumentKey("orga", "doc1", "docx")).toBe(
      "dev/tenants/orga/support/documents/doc1.docx",
    );
    process.env.CDS_ENV = "production";
    expect(tenantCdsDocumentKey("orga", "doc1", "pdf")).toBe(
      "tenants/orga/support/documents/doc1.pdf",
    );
  });

  it("rejects traversal and bad extensions", () => {
    for (const bad of ["../x", "a/b", "..", "", "A"]) {
      expect(
        () => tenantSupportFileKey("orga", bad, "m", "f", "png"),
        bad,
      ).toThrow(InvalidInput);
      expect(
        () => tenantSupportFileKey("orga", "t", bad, "f", "png"),
        bad,
      ).toThrow(InvalidInput);
      expect(
        () => tenantSupportFileKey("orga", "t", "m", bad, "png"),
        bad,
      ).toThrow(InvalidInput);
      expect(() => tenantSupportStagingKey(bad, "u", "x", "pdf"), bad).toThrow(
        InvalidInput,
      );
      expect(
        () => tenantSupportStagingKey("orga", bad, "x", "pdf"),
        bad,
      ).toThrow(InvalidInput);
      expect(() => tenantCdsDocumentKey("orga", bad, "pdf"), bad).toThrow(
        InvalidInput,
      );
    }
    for (const ext of ["", "PDF", "p.f", "abcdefghi", "../x", "a/b"]) {
      expect(
        () => tenantSupportFileKey("orga", "t", "m", "f", ext),
        ext,
      ).toThrow(InvalidInput);
      expect(() => tenantSupportStagingKey("orga", "u", "x", ext), ext).toThrow(
        InvalidInput,
      );
      expect(() => tenantCdsDocumentKey("orga", "d", ext), ext).toThrow(
        InvalidInput,
      );
    }
  });
});
