// 07-26 Task 1: site settings action (CONT-29; T-07-26-01). The session and @cds/db are
// mocked; the real runAction maps refusals to copy. Only the four keys reach the chokepoint.
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const DEPS = { sections: { marker: "registry" } };

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  enforceAgreementGate: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../lib/content", () => ({ contentDeps: () => DEPS }));

const db = vi.hoisted(() => ({ saveSiteSettings: vi.fn() }));
vi.mock("@cds/db", () => db);

const a = await import("../app/actions/site-settings");

const GROUP = {
  language: "es",
  show_translate: true,
  show_search: false,
  allow_ai_crawlers: true,
};

beforeEach(() => {
  db.saveSiteSettings.mockReset();
  sess.getHubSession.mockResolvedValue({
    ctx: CTX,
    email: "a@b.c",
    org: { id: "org1", name: "X", primaryHost: null },
  });
});

describe("saveSiteSettingsAction", () => {
  it("forwards only the four setting keys", async () => {
    db.saveSiteSettings.mockResolvedValue({ settings: GROUP });
    const res = await a.saveSiteSettingsAction({
      language: "es",
      show_translate: true,
      show_search: false,
      allow_ai_crawlers: true,
      organization: "B",
      held: true,
      seo: { title_suffix: "x" },
      junk: 1,
    } as never);
    expect(res).toEqual({ ok: true, data: { settings: GROUP } });
    expect(db.saveSiteSettings).toHaveBeenCalledWith(CTX, DEPS, {
      language: "es",
      show_translate: true,
      show_search: false,
      allow_ai_crawlers: true,
    });
  });

  it("never reads inherited keys; a subset stays a subset", async () => {
    db.saveSiteSettings.mockResolvedValue({ settings: GROUP });
    const raw = Object.create({ language: "fr" }) as Record<string, unknown>;
    raw.show_search = true;
    await a.saveSiteSettingsAction(raw as never);
    expect(db.saveSiteSettings).toHaveBeenCalledWith(CTX, DEPS, {
      show_search: true,
    });
  });

  it("a non-object input forwards an empty patch", async () => {
    db.saveSiteSettings.mockResolvedValue({ settings: GROUP });
    await a.saveSiteSettingsAction("x" as never);
    expect(db.saveSiteSettings).toHaveBeenCalledWith(CTX, DEPS, {});
  });

  it("maps a db refusal through runAction", async () => {
    const { InvalidInput } = await import("@cds/core");
    db.saveSiteSettings.mockRejectedValue(
      new InvalidInput("Enter a language code like pt-BR."),
    );
    const res = await a.saveSiteSettingsAction({ language: "x" });
    expect(res.ok).toBe(false);
  });

  it("no session -> refused before @cds/db", async () => {
    sess.getHubSession.mockResolvedValue(null);
    const res = await a.saveSiteSettingsAction({ show_search: true });
    expect(res.ok).toBe(false);
    expect(db.saveSiteSettings).not.toHaveBeenCalled();
  });
});
