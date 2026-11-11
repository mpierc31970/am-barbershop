import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootPb, type PbInstance } from "./pb-harness";

// P7 schema proofs on the real binary (07-01): CONTACTS-02 (one contact per org + email_norm,
// one house list per org, a contact on a list once), CONT-28 (one system-404 page per org),
// CONT-33 / CONT-36 (media status, public_at, deleted_at; pop-up and form deleted_at; page
// version_refs) and the new select values. Every new collection keeps all five API rules
// null (invariant 1) and refuses an anonymous list.
const P7_COLLECTIONS = [
  "forms",
  "form_submissions",
  "contacts",
  "contact_lists",
  "contact_list_members",
  "contact_notes",
  "contact_events",
];

type Json = Record<string, unknown>;

async function superuserToken(inst: PbInstance): Promise<string> {
  const res = await fetch(
    `${inst.url}/api/collections/_superusers/auth-with-password`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: inst.email, password: inst.password }),
    },
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

async function api(
  inst: PbInstance,
  path: string,
  init: { method?: string; body?: unknown; auth?: string } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init.auth) headers.Authorization = init.auth;
  const res = await fetch(`${inst.url}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Json) : {} };
}

describe("P7 schema (throwaway PocketBase)", () => {
  let inst: PbInstance | null = null;
  let su = "";
  let orgA = "";
  let orgB = "";

  const post = (collection: string, body: unknown) =>
    api(inst!, `/api/collections/${collection}/records`, {
      method: "POST",
      body,
      auth: su,
    });

  const fieldsOf = async (name: string): Promise<Json[]> => {
    const res = await api(inst!, `/api/collections/${name}`, { auth: su });
    expect(res.status).toBe(200);
    return res.body.fields as Json[];
  };

  const valuesOf = async (collection: string, field: string) => {
    const fields = await fieldsOf(collection);
    return fields.find((f) => f.name === field)?.values;
  };

  const idOf = (res: { status: number; body: Json }) => {
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return String(res.body.id);
  };

  beforeAll(async () => {
    inst = await bootPb();
    if (!inst) return;
    su = await superuserToken(inst);
    orgA = idOf(
      await post("organizations", {
        name: "P7 A",
        slug: "p7-a",
        status: "active",
      }),
    );
    orgB = idOf(
      await post("organizations", {
        name: "P7 B",
        slug: "p7-b",
        status: "active",
      }),
    );
  });

  afterAll(async () => {
    await inst?.stop();
  });

  it("denies anonymous list on every new P7 collection and every rule is null", async (ctx) => {
    if (!inst) return ctx.skip();
    for (const name of P7_COLLECTIONS) {
      const res = await api(inst, `/api/collections/${name}/records`);
      expect(res.status, `${name} anonymous list`).toBe(403);
      expect(res.body.items, `${name} leaked records`).toBeUndefined();
      const col = await api(inst, `/api/collections/${name}`, { auth: su });
      expect(col.status, name).toBe(200);
      for (const rule of [
        "listRule",
        "viewRule",
        "createRule",
        "updateRule",
        "deleteRule",
      ]) {
        expect(col.body[rule], `${name}.${rule}`).toBeNull();
      }
    }
  });

  it("contacts: one row per (organization, email_norm); same email in another org is fine", async (ctx) => {
    if (!inst) return ctx.skip();
    const contact = { email: "Pat@Example.com", email_norm: "pat@example.com" };
    idOf(await post("contacts", { ...contact, organization: orgA }));
    const dup = await post("contacts", {
      ...contact,
      email: "pat@example.com",
      organization: orgA,
    });
    expect(dup.status).toBe(400);
    idOf(await post("contacts", { ...contact, organization: orgB }));
    const fields = await fieldsOf("contacts");
    expect(fields.map((f) => f.name)).not.toContain("owner");
    expect(await valuesOf("contacts", "first_source")).toEqual([
      "form",
      "booking",
      "subscribe",
      "registration",
      "purchase",
      "import",
      "manual",
    ]);
  });

  it("contact_lists: one house list per org; renter lists are unlimited", async (ctx) => {
    if (!inst) return ctx.skip();
    idOf(
      await post("contact_lists", {
        organization: orgA,
        name: "Everyone",
        kind: "house",
      }),
    );
    const dup = await post("contact_lists", {
      organization: orgA,
      name: "Everyone again",
      kind: "house",
    });
    expect(dup.status).toBe(400);
    idOf(
      await post("contact_lists", {
        organization: orgB,
        name: "Everyone",
        kind: "house",
      }),
    );
    for (const name of ["Renter 1", "Renter 2"]) {
      idOf(
        await post("contact_lists", {
          organization: orgA,
          name,
          kind: "renter",
        }),
      );
    }
  });

  it("contact_list_members: a contact is on a list once; notes and events attach", async (ctx) => {
    if (!inst) return ctx.skip();
    const contact = idOf(
      await post("contacts", {
        organization: orgA,
        email: "member@example.com",
        email_norm: "member@example.com",
      }),
    );
    const list = idOf(
      await post("contact_lists", {
        organization: orgA,
        name: "Renter 3",
        kind: "renter",
      }),
    );
    const member = { organization: orgA, list, contact };
    idOf(await post("contact_list_members", member));
    const dup = await post("contact_list_members", member);
    expect(dup.status).toBe(400);
    idOf(
      await post("contact_notes", {
        organization: orgA,
        contact,
        list,
        body: "Prefers mornings",
      }),
    );
    idOf(
      await post("contact_events", {
        organization: orgA,
        contact,
        kind: "manual",
        at: new Date().toISOString(),
      }),
    );
    const fields = await fieldsOf("contact_events");
    expect(fields.map((f) => f.name)).not.toContain("updated");
  });

  it("pages: kind accepts system-404, one per org; version_refs and password_version exist", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(await valuesOf("pages", "kind")).toEqual(["builder", "system-404"]);
    const page = {
      title: "Page not found",
      status: "published",
      kind: "system-404",
    };
    idOf(
      await post("pages", {
        ...page,
        slug: "system-404",
        organization: orgA,
      }),
    );
    const dup = await post("pages", {
      ...page,
      slug: "system-404-b",
      organization: orgA,
    });
    expect(dup.status).toBe(400);
    idOf(
      await post("pages", {
        ...page,
        slug: "system-404",
        organization: orgB,
      }),
    );
    // Builder pages are not limited by the partial index.
    for (const slug of ["one", "two"]) {
      idOf(
        await post("pages", {
          slug,
          title: slug,
          status: "draft",
          kind: "builder",
          organization: orgA,
        }),
      );
    }
    const names = (await fieldsOf("pages")).map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(["version_refs", "password_version"]),
    );
  });

  it("media_assets: new kinds, sources, extensions, status and the soft-delete columns", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(await valuesOf("media_assets", "kind")).toEqual([
      "logo",
      "hero",
      "gallery",
      "team",
      "moodboard",
      "library",
      "video",
      "audio",
    ]);
    expect(await valuesOf("media_assets", "source")).toEqual([
      "intake",
      "library",
      "link",
    ]);
    expect(await valuesOf("media_assets", "original_ext")).toEqual([
      "jpg",
      "png",
      "webp",
      "mp4",
      "mp3",
    ]);
    expect(await valuesOf("media_assets", "status")).toEqual([
      "uploading",
      "processing",
      "ready",
      "failed",
      // 13-11 (STAFF-23, migration 1790000879): a photo held by image moderation.
      "held",
    ]);
    const names = (await fieldsOf("media_assets")).map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "public_at",
        "deleted_at",
        "poster_asset",
        "duration_s",
        "captions_path",
      ]),
    );
    expect(names).not.toContain("captions_key");
    const poster = (await fieldsOf("media_assets")).find(
      (f) => f.name === "poster_asset",
    );
    expect(poster?.type).toBe("text");
    for (const [kind, source, ext] of [
      ["video", "library", "mp4"],
      ["audio", "library", "mp3"],
      ["library", "link", "jpg"],
    ]) {
      idOf(
        await post("media_assets", {
          organization: orgA,
          kind,
          source,
          original_ext: ext,
          storage_dir: `media/${kind}`,
          status: "ready",
          public_at: new Date().toISOString(),
        }),
      );
    }
  });

  it("forms, form_submissions, popups and site_settings carry their P7 fields", async (ctx) => {
    if (!inst) return ctx.skip();
    expect(await valuesOf("forms", "template")).toEqual([
      "blank",
      "contact",
      "quote-request",
      "client-intake",
      "feedback",
      "job-application",
    ]);
    expect(await valuesOf("forms", "layout")).toEqual(["1", "2"]);
    expect(await valuesOf("forms", "notify_route")).toEqual([
      "default",
      "inquiries",
      "newsletter",
      "billing",
      "account",
    ]);
    const form = idOf(
      await post("forms", {
        organization: orgA,
        name: "Contact",
        template: "contact",
        layout: "1",
        notify_route: "inquiries",
      }),
    );
    const contact = idOf(
      await post("contacts", {
        organization: orgA,
        email: "sender@example.com",
        email_norm: "sender@example.com",
      }),
    );
    idOf(
      await post("form_submissions", {
        organization: orgA,
        form,
        form_name: "Contact",
        contact,
        data: { f1: "hi" },
        labels: { f1: "Message" },
      }),
    );
    const subFields = await fieldsOf("form_submissions");
    const rel = subFields.find((f) => f.name === "contact");
    expect(rel?.type).toBe("relation");
    expect(rel?.required).toBe(false);
    const formRel = subFields.find((f) => f.name === "form");
    expect(formRel?.required).toBe(false);
    expect(formRel?.cascadeDelete).toBe(false);

    expect((await fieldsOf("forms")).map((f) => f.name)).toContain(
      "deleted_at",
    );
    expect((await fieldsOf("popups")).map((f) => f.name)).toContain(
      "deleted_at",
    );
    expect((await fieldsOf("site_settings")).map((f) => f.name)).toEqual(
      expect.arrayContaining(["nav", "footer", "seo", "settings", "language"]),
    );
  });
});
