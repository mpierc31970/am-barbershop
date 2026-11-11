// P7 soft delete attacks. Owner 07-28: writer attacks live (CONT-36, D275; TEN-03, invariant 1;
// T-07-28-01, T-07-28-02). Org B's context is driven against org A's soft-deleted pop-up, form
// and media rows: deletePopup, deleteForm, popupUsage, restorePageVersion and deleteMediaAsset
// are NotFound, deletedRefsAmong reports A's ids as missing (no hint they exist) and
// undeleteOps scoped to B returns nothing. A's rows and deleted_at values are unchanged after.
// Each key keeps its read-only half (the generic repo has no writers for these collections).
import { NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { expect } from "vitest";
import { deletePopup, popupUsage } from "../../src/content/popups";
import {
  recordingInvalidator,
  type ContentDeps,
} from "../../src/content/ports";
import { restorePageVersion } from "../../src/content/publish";
import { deletedRefsAmong, undeleteOps } from "../../src/content/soft-delete";
import { deleteForm } from "../../src/forms";
import { deleteMediaAsset } from "../../src/media/library";
import { tenantVersionPrefix } from "../../src/storage";
import { readOnlyAttack, type AttackEnv, type AttackMap } from "./env";

const registry = composeSectionRegistry(CORE_SECTIONS, []);

function deps(): ContentDeps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict: "clean", reasons: [] }) },
  };
}

const STAMP = "2026-10-01 10:00:00.000Z";

type SoftKind = "popups" | "forms" | "media_assets";

/** Create org A's soft-deleted row of `collection` directly (env.pb()). */
async function softRowOfA(
  env: AttackEnv,
  collection: SoftKind,
): Promise<string> {
  const pb = env.pb();
  const org = env.seed().A.org;
  const body: Record<string, Record<string, unknown>> = {
    popups: {
      name: "Soft offer",
      trigger: "delay",
      frequency: "once-per-visitor",
      show_on: "all-pages",
      enabled: true,
      content: { items: [] },
    },
    forms: {
      name: "Soft form",
      template: "contact",
      layout: "1",
      fields: [],
      notify_route: "inquiries",
    },
    media_assets: {
      kind: "library",
      status: "ready",
      source: "library",
      original_ext: "png",
      storage_dir: `tenants/${org}/media/soft`,
    },
  };
  return (
    await pb.collection(collection).create({
      ...body[collection],
      organization: org,
      deleted_at: STAMP,
    })
  ).id;
}

/**
 * Run `fn` against a fresh soft-deleted row of org A, then remove the row, so the suite's
 * "left every org A row unchanged" snapshot still matches (the row is the attack's fixture).
 */
async function withSoftRow(
  env: AttackEnv,
  collection: SoftKind,
  fn: (id: string) => Promise<void>,
): Promise<void> {
  const id = await softRowOfA(env, collection);
  try {
    await fn(id);
  } finally {
    await env.pb().collection(collection).delete(id);
  }
}

async function deletedAtOf(
  env: AttackEnv,
  collection: string,
  id: string,
): Promise<string> {
  return String((await env.pb().collection(collection).getOne(id)).deleted_at);
}

export function attacks(env: AttackEnv): AttackMap {
  return {
    "popups:soft-delete": async () => {
      await readOnlyAttack(env, "popups")();
      const seed = env.seed();
      const B = seed.ctxB;
      await withSoftRow(env, "popups", async (popup) => {
        const before = await deletedAtOf(env, "popups", popup);
        await expect(deletePopup(B, deps(), popup)).rejects.toThrow(NotFound);
        await expect(popupUsage(B, deps(), popup)).rejects.toThrow(NotFound);
        const among = await deletedRefsAmong(B, {
          popups: [popup, seed.A.popup],
          forms: [],
          media: [],
        });
        // A's live and soft-deleted ids both read as missing for B: no oracle.
        expect(among.popups.sort()).toEqual([popup, seed.A.popup].sort());
        expect(
          await undeleteOps(
            env.pb(),
            { orgId: seed.B.org },
            {
              popups: [popup],
              forms: [],
              media: [],
            },
          ),
        ).toEqual([]);
        const key =
          tenantVersionPrefix(seed.A.org, seed.A.page) +
          "2026-10-01T10-00-00-000Z.json";
        await expect(
          restorePageVersion(B, seed.A.page, key, deps()),
        ).rejects.toThrow(NotFound);
        expect(await deletedAtOf(env, "popups", popup)).toBe(before);
        expect(
          (await env.pb().collection("popups").getOne(seed.A.popup))
            .organization,
        ).toBe(seed.A.org);
      });
    },
    "forms:soft-delete": async () => {
      await readOnlyAttack(env, "forms")();
      const seed = env.seed();
      const B = seed.ctxB;
      await withSoftRow(env, "forms", async (form) => {
        const before = await deletedAtOf(env, "forms", form);
        await expect(deleteForm(B, deps(), form)).rejects.toThrow(NotFound);
        const among = await deletedRefsAmong(B, {
          popups: [],
          forms: [form],
          media: [],
        });
        expect(among.forms).toEqual([form]);
        expect(
          await undeleteOps(
            env.pb(),
            { orgId: seed.B.org },
            {
              popups: [],
              forms: [form],
              media: [],
            },
          ),
        ).toEqual([]);
        expect(await deletedAtOf(env, "forms", form)).toBe(before);
      });
    },
    "media_assets:soft-delete": async () => {
      await readOnlyAttack(env, "media_assets")();
      const seed = env.seed();
      const B = seed.ctxB;
      await withSoftRow(env, "media_assets", async (media) => {
        const before = await deletedAtOf(env, "media_assets", media);
        await expect(
          deleteMediaAsset(B, media, {
            sections: registry,
            invalidator: recordingInvalidator(),
          }),
        ).rejects.toThrow(NotFound);
        const among = await deletedRefsAmong(B, {
          popups: [],
          forms: [],
          media: [media],
        });
        expect(among.media).toEqual([media]);
        expect(
          await undeleteOps(
            env.pb(),
            { orgId: seed.B.org },
            {
              popups: [],
              forms: [],
              media: [media],
            },
          ),
        ).toEqual([]);
        expect(await deletedAtOf(env, "media_assets", media)).toBe(before);
      });
    },
  };
}
