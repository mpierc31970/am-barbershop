// P7 forms attacks. Owner 07-15: real writer attacks. Every forms and Inbox function is driven
// with org B's context (or org B's visitor SiteContext) and org A's ids (TEN-03, invariant 1,
// T-07-15-01/02): reads and writes are NotFound, a foreign organization or page in the input
// is InvalidInput, and org A's rows are unchanged afterwards. Each key keeps its read-only
// half: the generic repo has no create/update/delete for these collections.
import { createHash, randomBytes } from "node:crypto";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { InvalidInput, NotFound } from "@cds/core";
import { expect } from "vitest";
import {
  recordingInvalidator,
  type ContentDeps,
} from "../../src/content/ports";
import { siteContextForHost } from "../../src/content/site-context";
import {
  deleteForm,
  deleteSubmission,
  duplicateForm,
  exportSubmissionsCsv,
  formUsedOn,
  getForm,
  getSubmission,
  listSubmissions,
  markNotSpam,
  readPublicForms,
  saveForm,
  setSubmissionRead,
  submitForm,
} from "../../src/forms";
import {
  deleteFormDraft,
  resumeFormDraft,
  saveFormDraft,
} from "../../src/forms/drafts";
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

export function attacks(env: AttackEnv): AttackMap {
  return {
    forms: async () => {
      await readOnlyAttack(env, "forms")();
      const seed = env.seed();
      const pb = env.pb();
      const B = seed.ctxB;
      const a = seed.A.form;
      const before = await pb.collection("forms").getOne(a);
      await expect(getForm(B, a)).rejects.toThrow(NotFound);
      await expect(
        saveForm(B, deps(), { id: a, name: "pwned", fields: [] }),
      ).rejects.toThrow(NotFound);
      await expect(duplicateForm(B, deps(), a)).rejects.toThrow(NotFound);
      await expect(deleteForm(B, deps(), a)).rejects.toThrow(NotFound);
      await expect(formUsedOn(B, registry, a)).rejects.toThrow(NotFound);
      await expect(
        saveForm(B, deps(), {
          id: seed.B.form,
          name: "x",
          organization: seed.A.org,
        }),
      ).rejects.toThrow(InvalidInput);
      await expect(
        saveForm(B, deps(), {
          id: seed.B.form,
          name: "x",
          after_submit: { kind: "page", page: seed.A.page },
        }),
      ).rejects.toThrow(InvalidInput);

      const siteB = await siteContextForHost("b.example.com");
      if (!siteB) throw new Error("no site for b.example.com");
      expect(await readPublicForms(siteB, [a])).toEqual({});
      const count = async () =>
        (
          await pb.collection("form_submissions").getFullList({
            filter: pb.filter("organization = {:org}", { org: seed.A.org }),
            fields: "id",
          })
        ).length;
      const subsBefore = await count();
      await expect(
        submitForm(
          siteB,
          a,
          { _started: String(Date.now() - 10_000), website_url: "" },
          { ip: "203.0.113.9" },
        ),
      ).rejects.toThrow(NotFound);
      expect(await count()).toBe(subsBefore);

      const after = await pb.collection("forms").getOne(a);
      expect(after.name).toBe(before.name);
      expect(after.deleted_at).toBe(before.deleted_at);
      expect(after.organization).toBe(seed.A.org);
    },
    form_submissions: async () => {
      await readOnlyAttack(env, "form_submissions")();
      const seed = env.seed();
      const pb = env.pb();
      const B = seed.ctxB;
      const s = seed.A.formSubmission;
      const before = await pb.collection("form_submissions").getOne(s);
      await expect(getSubmission(B, s)).rejects.toThrow(NotFound);
      await expect(setSubmissionRead(B, s, true)).rejects.toThrow(NotFound);
      await expect(markNotSpam(B, s)).rejects.toThrow(NotFound);
      await expect(deleteSubmission(B, s)).rejects.toThrow(NotFound);
      await expect(listSubmissions(B, { form: seed.A.form })).rejects.toThrow(
        NotFound,
      );
      await expect(exportSubmissionsCsv(B, seed.A.form)).rejects.toThrow(
        NotFound,
      );
      const page = await listSubmissions(B);
      expect(page.items.map((r) => r.id)).not.toContain(s);
      const after = await pb.collection("form_submissions").getOne(s);
      expect(after.read_at).toBe(before.read_at);
      expect(after.spam).toBe(before.spam);
      expect(after.organization).toBe(seed.A.org);
    },
    // 10-37: Forms Pro drafts. The generic repo is read-only for them.
    form_drafts: async () => {
      await readOnlyAttack(env, "form_drafts")();
      const seed = env.seed();
      const pb = env.pb();
      const token = randomBytes(32).toString("base64url");
      const row = await pb.collection("form_drafts").create({
        organization: seed.A.org,
        form: seed.A.form,
        email: "draft-attack@cds.test",
        data: { q: "secret" },
        token_hash: createHash("sha256").update(token).digest("hex"),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      });
      const siteB = await siteContextForHost("b.example.com");
      if (!siteB) throw new Error("no site for b.example.com");
      expect(await resumeFormDraft(siteB, seed.A.form, token)).toBeNull();
      expect(await deleteFormDraft(siteB, seed.A.form, token)).toBe(false);
      await expect(
        saveFormDraft(
          siteB,
          seed.A.form,
          { email: "evil@cds.test", answers: {} },
          { ip: "203.0.113.10" },
        ),
      ).rejects.toThrow(NotFound);
      const after = await pb.collection("form_drafts").getOne(row.id);
      expect(after.organization).toBe(seed.A.org);
      expect(after.data).toEqual({ q: "secret" });
      await pb.collection("form_drafts").delete(row.id);
    },
  };
}
