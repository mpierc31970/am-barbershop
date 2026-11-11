// 11-41 (LIFE-04; D285): the Your data view mapper (dates in the business time zone, states)
// and the request action's refusal mapping (choice 3).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { ctx: Record<string, unknown> },
  blocked: false,
}));

const db = vi.hoisted(() => ({
  readDataDownloadState: vi.fn(),
  requestDataDownload: vi.fn(),
  statsTimeZone: vi.fn(async () => "America/Chicago"),
}));

vi.mock("@cds/db", () => db);
vi.mock("@cds/addon-registry/server", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../lib/session", () => ({
  getHubSession: async () => state.session,
  agreementBlocks: async () => state.blocked,
}));

const { InvalidInput, ImpersonationDenied } = await import("@cds/core");
const { dataDownloadView, zipSizeLabel, clockTime, dayMonth, whenLabel } =
  await import("../lib/data-download-view");
const { requestDataDownloadAction, readDataDownloadAction } =
  await import("../app/actions/data-download");

const TZ = "America/Chicago";
// 2026-10-09 14:14 CDT = 19:14Z.
const NOW = new Date("2026-10-09T19:14:00.000Z");
const CTX = {
  orgId: "orgaaaaaaaaaaa1",
  actor: "useraaaaaaaaaa1",
  role: "owner",
  grants: [],
  ip: "",
};

function owner(over: Record<string, unknown> = {}) {
  return {
    who: "owner" as const,
    latest: null,
    nextAllowedAt: null,
    canRequest: true,
    ...over,
  };
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: "dlaaaaaaaaaaaa1",
    status: "ready",
    requestedAt: NOW.toISOString(),
    readyAt: NOW.toISOString(),
    expiresAt: "2026-10-16T19:20:00.000Z",
    sizeBytes: 1.4 * 1024 ** 3,
    errorKind: null,
    href: "/hub/api/data-download/dlaaaaaaaaaaaa1?exp=1&sig=s",
    ...over,
  };
}

describe("data download view (11-41)", () => {
  it("formats dates like the UI-SPEC", () => {
    expect(dayMonth(NOW, TZ)).toBe("9 Oct");
    expect(dayMonth(new Date("2026-09-03T18:00:00Z"), TZ)).toBe("3 Sep");
    expect(clockTime(NOW, TZ)).toBe("2:14 pm");
    expect(whenLabel(new Date("2026-10-10T19:14:00Z"), NOW, TZ)).toBe(
      "2:14 pm tomorrow",
    );
    expect(whenLabel(new Date("2026-10-09T22:00:00Z"), NOW, TZ)).toBe(
      "5:00 pm today",
    );
    // IN-C05: 7 Mar 2026, 11:30 pm CST; 8 Mar is a 23-hour day (DST starts), so now + 24 h
    // is already 9 Mar. Noon on 8 Mar is still "tomorrow".
    const lateSat = new Date("2026-03-08T05:30:00Z");
    expect(whenLabel(new Date("2026-03-08T17:00:00Z"), lateSat, TZ)).toBe(
      "12:00 pm tomorrow",
    );
    expect(whenLabel(new Date("2026-03-09T17:00:00Z"), lateSat, TZ)).toBe(
      "9 Mar, 12:00 pm",
    );
    expect(zipSizeLabel(1.4 * 1024 ** 3)).toBe("1.4 GB");
    expect(zipSizeLabel(18 * 1024 ** 2)).toBe("18 MB");
    expect(zipSizeLabel(null)).toBeNull();
  });

  it("no row or expired: Idle; queued/building: Building; failed: Failed", () => {
    expect(dataDownloadView(owner(), TZ, NOW).status).toBe("idle");
    expect(
      dataDownloadView(
        owner({ latest: row({ status: "expired", href: null }) }),
        TZ,
        NOW,
      ).status,
    ).toBe("idle");
    for (const s of ["queued", "building"]) {
      expect(
        dataDownloadView(
          owner({ latest: row({ status: s, href: null }) }),
          TZ,
          NOW,
        ).status,
      ).toBe("building");
    }
    expect(
      dataDownloadView(
        owner({ latest: row({ status: "failed", href: null }) }),
        TZ,
        NOW,
      ).status,
    ).toBe("failed");
  });

  it("Ready: link, expiry day, size, requested time and the limit", () => {
    const v = dataDownloadView(
      owner({ latest: row(), nextAllowedAt: "2026-10-10T19:14:00.000Z" }),
      TZ,
      NOW,
    );
    expect(v).toEqual({
      viewer: "owner",
      status: "ready",
      ready: {
        href: "/hub/api/data-download/dlaaaaaaaaaaaa1?exp=1&sig=s",
        until: "16 Oct",
        size: "1.4 GB",
      },
      requested: "9 Oct, 2:14 pm",
      limitUntil: "2:14 pm tomorrow",
    });
  });

  it("not-owner and impersonating carry nothing about the download", () => {
    for (const who of ["not-owner", "impersonating"] as const) {
      expect(
        dataDownloadView(
          { who, latest: null, nextAllowedAt: null, canRequest: false },
          TZ,
          NOW,
        ),
      ).toEqual({
        viewer: who,
        status: "idle",
        ready: null,
        requested: null,
        limitUntil: null,
      });
    }
  });
});

describe("requestDataDownloadAction (11-41 choice 3)", () => {
  beforeEach(() => {
    state.session = { ctx: { ...CTX } };
    state.blocked = false;
    db.requestDataDownload.mockReset();
    db.readDataDownloadState.mockReset();
    db.readDataDownloadState.mockResolvedValue(
      owner({ latest: row({ status: "queued", href: null }) }),
    );
  });

  it("the Owner's request answers with the Building view", async () => {
    db.requestDataDownload.mockResolvedValue({ id: "dlaaaaaaaaaaaa1" });
    const res = await requestDataDownloadAction();
    expect(db.requestDataDownload).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: true, data: { status: "building" } });
  });

  it("the 24-hour limit answers with the Limited view, not an error", async () => {
    db.requestDataDownload.mockRejectedValue(
      new InvalidInput("you can ask for a new download after …"),
    );
    db.readDataDownloadState.mockResolvedValue(
      owner({ nextAllowedAt: "2026-10-10T19:14:00.000Z", canRequest: false }),
    );
    const res = await requestDataDownloadAction();
    expect(res).toMatchObject({
      ok: true,
      data: {
        status: "idle",
        limitUntil: expect.stringMatching(/tomorrow|today|, /),
      },
    });
  });

  it("impersonating staff and Admins never reach requestDataDownload", async () => {
    state.session = { ctx: { ...CTX, impersonator: "staffaaaaaaaaa1" } };
    db.readDataDownloadState.mockResolvedValue({
      who: "impersonating",
      latest: null,
      nextAllowedAt: null,
      canRequest: false,
    });
    expect(await requestDataDownloadAction()).toMatchObject({
      ok: true,
      data: { viewer: "impersonating" },
    });
    state.session = { ctx: { ...CTX, role: "admin" } };
    db.readDataDownloadState.mockResolvedValue({
      who: "not-owner",
      latest: null,
      nextAllowedAt: null,
      canRequest: false,
    });
    expect(await requestDataDownloadAction()).toMatchObject({
      ok: true,
      data: { viewer: "not-owner" },
    });
    expect(db.requestDataDownload).not.toHaveBeenCalled();
  });

  it("an outdated Owner gets the re-accept copy, not 'try again' (WR-E04)", async () => {
    state.blocked = true;
    const { AGREEMENT_GATE_COPY } = await import("../lib/agreement-gate");
    expect(await requestDataDownloadAction()).toEqual({
      ok: false,
      code: "agreement_required",
      message: AGREEMENT_GATE_COPY,
    });
    expect(db.requestDataDownload).not.toHaveBeenCalled();
  });

  it("any other failure is a short retry message, never the error text", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.requestDataDownload.mockRejectedValue(new Error("pb at 10.0.0.1 down"));
    const res = await requestDataDownloadAction();
    expect(res).toEqual({
      ok: false,
      code: "save_failed",
      message:
        "We couldn't start your download just now. Try again in a minute.",
    });
    db.requestDataDownload.mockRejectedValue(new ImpersonationDenied());
    expect(await requestDataDownloadAction()).toMatchObject({ ok: false });
    spy.mockRestore();
  });

  it("signed out stays signed_out; the poll reads the same view", async () => {
    state.session = null;
    expect(await requestDataDownloadAction()).toMatchObject({
      ok: false,
      code: "signed_out",
    });
    state.session = { ctx: { ...CTX } };
    expect(await readDataDownloadAction()).toMatchObject({
      ok: true,
      data: { status: "building" },
    });
  });
});
