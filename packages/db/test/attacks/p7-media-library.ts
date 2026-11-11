// P7 media library attacks. Owner 07-12: real writer attacks (TEN-03, invariant 1,
// T-07-12-01). Org A gets one library row (and a private object and a chunk upload); every
// library function is then driven with org B's context and org A's ids: reads and writes are
// NotFound (or empty), and A's row, alt and object are unchanged afterwards. The read-only
// half stays: the generic repo has no create/update/delete for media_assets.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { expect } from "vitest";
import { recordingInvalidator } from "../../src/content/ports";
import { siteContextForHost } from "../../src/content/site-context";
import {
  abortChunkedUpload,
  appendChunk,
  deleteMediaAsset,
  describeMedia,
  getLibraryItem,
  listLibrary,
  mediaUsedOn,
  openHubMediaObject,
  readPublicMedia,
  resolveHubMedia,
  startChunkedUpload,
} from "../../src/media/library";
import { clearResolverCache } from "../../src/resolve";
import { tenantMediaDerivativeKey } from "../../src/storage/keys";
import { LocalDiskStore } from "../../src/storage/local-disk";
import { readOnlyAttack, type AttackEnv, type AttackMap } from "./env";

const registry = composeSectionRegistry(CORE_SECTIONS, []);

export function attacks(env: AttackEnv): AttackMap {
  return {
    "media_assets:media-library": async () => {
      await readOnlyAttack(env, "media_assets")();
      const seed = env.seed();
      const pb = env.pb();
      const A = seed.ctxA;
      const B = seed.ctxB;
      const dir = mkdtempSync(join(tmpdir(), "cds-attack-media-"));
      const store = new LocalDiskStore(dir);
      try {
        const id = (
          await pb.collection("media_assets").create({
            organization: seed.A.org,
            kind: "library",
            status: "ready",
            source: "library",
            original_ext: "png",
            storage_dir: `tenants/${seed.A.org}/media/attack`,
            width: 100,
            height: 100,
            web_width: 100,
            web_height: 100,
            alt: "Org A photo",
            name: "a.png",
          })
        ).id;
        const key = tenantMediaDerivativeKey(seed.A.org, id, "w480");
        await store.put(key, new TextEncoder().encode("org A bytes"));
        const { uploadId } = await startChunkedUpload(A, {
          purpose: "audio",
          size: 10,
        });

        await expect(describeMedia(B, [{ id, alt: "pwned" }])).rejects.toThrow(
          NotFound,
        );
        await expect(
          deleteMediaAsset(B, id, {
            sections: registry,
            invalidator: recordingInvalidator(),
            store,
            publicStore: store,
          }),
        ).rejects.toThrow(NotFound);
        await expect(getLibraryItem(B, id)).rejects.toThrow(NotFound);
        await expect(mediaUsedOn(B, id, registry, { store })).rejects.toThrow(
          NotFound,
        );
        await expect(
          openHubMediaObject(B, id, "w480", { store }),
        ).rejects.toThrow(NotFound);
        await expect(
          appendChunk(B, uploadId, 0, new Uint8Array(10)),
        ).rejects.toThrow(NotFound);
        expect(await resolveHubMedia(B, [id])).toEqual({});
        expect((await listLibrary(B)).items.map((i) => i.id)).not.toContain(id);
        clearResolverCache();
        const siteB = await siteContextForHost("b.example.com");
        expect(siteB).not.toBeNull();
        expect(await readPublicMedia(siteB!, [id])).toEqual([]);

        const row = await pb.collection("media_assets").getOne(id);
        expect(row.organization).toBe(seed.A.org);
        expect(row.alt).toBe("Org A photo");
        expect(row.deleted_at).toBe("");
        expect(await store.get(key)).not.toBeNull();
        await abortChunkedUpload(A, uploadId);
        await pb.collection("media_assets").delete(id);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
