// 07-19: the forms slice of the core block data loader (CONT-25, choice 6). Section form ids
// from the registry's refsOf, pop-up form ids from live pop-ups' items; visitor pages read
// readPublicForms and stamp FormView; the status lands only on the matching form; a failing
// read leaves forms unset while media still loads. Preview reads getForm + publicFormOf.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      fn(...a),
  revalidateTag: () => {},
}));

const db = vi.hoisted(() => ({
  readPublicForms: vi.fn(),
  resumeFormDraft: vi.fn(),
  getForm: vi.fn(),
  resolvePublicMedia: vi.fn(),
  resolveHubMedia: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const live = vi.hoisted(() => ({ getLiveSite: vi.fn() }));
vi.mock("../lib/site-cache", async (orig) => ({
  ...(await orig<typeof import("../lib/site-cache")>()),
  ...live,
}));

const { loadCoreBlockData, previewCoreBlockData, formIdsFor } =
  await import("../lib/core-block-data");

const SITE = { orgId: "o1", host: "shop.example.com" } as never;
const CTX = { orgId: "o1" } as never;

function form(id: string) {
  return {
    id,
    name: "Contact",
    layout: "1",
    fields: [],
    after_submit: { kind: "message", message: "Thanks", button_text: "Send" },
    newsletter_checkbox: false,
    newsletter_wording: "",
  };
}

const SECTION = {
  id: "s1",
  section_type: "columns",
  content: {
    columns: [{ items: [{ id: "i1", kind: "form", form_id: "forma" }] }],
  },
} as never;
const POPUP = {
  id: "p1",
  content: { items: [{ id: "i2", kind: "form", form_id: "formb" }] },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  live.getLiveSite.mockResolvedValue({ banner: null, popups: [POPUP] });
  db.resolvePublicMedia.mockResolvedValue({});
  db.readPublicForms.mockImplementation(async (_s, ids: string[]) =>
    Object.fromEntries(
      ids.filter((id) => id !== "held").map((id) => [id, form(id)]),
    ),
  );
});

describe("form loader", () => {
  it("collects form ids from sections and pop-ups", () => {
    expect(formIdsFor([SECTION], [POPUP]).sort()).toEqual(["forma", "formb"]);
  });

  it("stamps FormView with the page id and the matching status only", async () => {
    const status = {
      formId: "forma",
      status: { itemId: "i1", kind: "sent" as const },
    };
    const data = await loadCoreBlockData(SITE, [SECTION], {
      forms: { pageId: "page1", status },
    });
    const forms = data.forms as Record<string, Record<string, unknown>>;
    expect(Object.keys(forms).sort()).toEqual(["forma", "formb"]);
    expect(forms.forma).toMatchObject({
      pageId: "page1",
      status: status.status,
      preview: false,
    });
    expect(forms.formb).toMatchObject({ status: null });
    expect(live.getLiveSite).toHaveBeenCalledTimes(1);
  });

  it("does not read forms when there are none", async () => {
    live.getLiveSite.mockResolvedValue({ banner: null, popups: [] });
    const data = await loadCoreBlockData(SITE, []);
    expect(db.readPublicForms).not.toHaveBeenCalled();
    expect(data.forms).toBeUndefined();
  });

  it("a failing read leaves forms unset and logs", async () => {
    db.readPublicForms.mockRejectedValue(new Error("down"));
    const data = await loadCoreBlockData(SITE, [SECTION]);
    expect(data.forms).toBeUndefined();
    expect(data.media).toEqual({});
    expect(console.error).toHaveBeenCalledWith(
      "[site] core form data failed",
      expect.any(Error),
    );
  });

  it("preview fills forms from getForm with preview: true", async () => {
    db.getForm.mockResolvedValue({ ...form("forma"), fields: [] });
    const data = await previewCoreBlockData(CTX, [SECTION]);
    const forms = data.forms as Record<string, Record<string, unknown>>;
    expect(forms.forma).toMatchObject({ preview: true, pageId: null });
  });
});

// 10-40 (BILL-14, D233; choice 3): a resume link pre-fills its Builder Pro form server-side.
describe("resume links", () => {
  const TOKEN = "B".repeat(43);
  const PRO = { rules: [], steps: [], save_resume: true };

  beforeEach(() => {
    db.readPublicForms.mockImplementation(async (_s, ids: string[]) =>
      Object.fromEntries(
        ids.map((id) => [
          id,
          id === "forma" ? { ...form(id), pro: PRO } : form(id),
        ]),
      ),
    );
  });

  it("pre-fills the form the token belongs to and marks it resumed", async () => {
    db.resumeFormDraft.mockResolvedValue({
      answers: { name: "Pat" },
      email: "pat@example.com",
    });
    const data = await loadCoreBlockData(SITE, [SECTION], {
      forms: { pageId: "page1", status: null, resume: TOKEN },
    });
    const forms = data.forms as Record<string, Record<string, unknown>>;
    expect(db.resumeFormDraft).toHaveBeenCalledTimes(1);
    expect(db.resumeFormDraft).toHaveBeenCalledWith(SITE, "forma", TOKEN);
    expect(forms.forma).toMatchObject({
      values: { name: "Pat" },
      resume: { kind: "resumed", token: TOKEN },
    });
    // A form without save and finish later is never looked up or marked.
    expect(forms.formb).not.toHaveProperty("resume");
    expect(forms.formb).not.toHaveProperty("values");
  });

  it("an unknown or expired token marks save-later forms expired, empty", async () => {
    db.resumeFormDraft.mockResolvedValue(null);
    const data = await loadCoreBlockData(SITE, [SECTION], {
      forms: { pageId: "page1", status: null, resume: TOKEN },
    });
    const forms = data.forms as Record<string, Record<string, unknown>>;
    expect(forms.forma).toMatchObject({ resume: { kind: "expired" } });
    expect(forms.forma).not.toHaveProperty("values");
  });

  it("a failing lookup logs the error class only and shows expired", async () => {
    db.resumeFormDraft.mockRejectedValue(new Error("down"));
    const data = await loadCoreBlockData(SITE, [SECTION], {
      forms: { pageId: null, status: null, resume: TOKEN },
    });
    const forms = data.forms as Record<string, Record<string, unknown>>;
    expect(forms.forma).toMatchObject({ resume: { kind: "expired" } });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      TOKEN,
    );
  });

  it("no token, no lookup", async () => {
    await loadCoreBlockData(SITE, [SECTION], {
      forms: { pageId: "page1", status: null },
    });
    expect(db.resumeFormDraft).not.toHaveBeenCalled();
  });
});
