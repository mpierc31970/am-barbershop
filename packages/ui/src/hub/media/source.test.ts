// 07-17 Task 1: fetchMediaSource over /hub/api/media/library (choice 1). fetch is stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEDIA_COPY } from "./copy";
import { fetchMediaSource } from "./source";

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchMediaSource", () => {
  it("list builds the closed query and sends same-origin credentials", async () => {
    reply(200, { page: { items: [] }, usage: { level: "ok" } });
    const res = await fetchMediaSource.list({
      filter: "videos",
      q: "tour",
      page: 2,
      perPage: 60,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/hub/api/media/library?filter=videos&q=tour&page=2&perPage=60",
      expect.objectContaining({ credentials: "same-origin", method: "GET" }),
    );
    expect(res).toEqual({
      ok: true,
      data: { page: { items: [] }, usage: { level: "ok" } },
    });
  });

  it("items and states pass comma lists", async () => {
    reply(200, { items: [{ id: "a" }] });
    reply(200, { states: { a: "ready" } });
    expect(await fetchMediaSource.items(["a", "b"])).toEqual({
      ok: true,
      data: [{ id: "a" }],
    });
    expect(await fetchMediaSource.states(["a"])).toEqual({
      ok: true,
      data: { a: "ready" },
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "/hub/api/media/library?ids=a%2Cb",
    );
    expect(fetchMock.mock.calls[1]![0]).toBe("/hub/api/media/library?states=a");
  });

  it("describe POSTs only id and alt", async () => {
    reply(200, { count: 1 });
    const res = await fetchMediaSource.describe([
      { id: "a", alt: "Loaves", extra: 1 } as never,
    ]);
    expect(res).toEqual({ ok: true, data: { count: 1 } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/hub/api/media/library");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      describe: [{ id: "a", alt: "Loaves" }],
    });
  });

  it("non-2xx becomes a result with the server sentence, never a throw", async () => {
    reply(400, { error: "Add a short description." });
    expect(await fetchMediaSource.describe([{ id: "a", alt: "" }])).toEqual({
      ok: false,
      code: "invalid_input",
      message: "Add a short description.",
    });
    reply(404, { error: "not_found" });
    expect(await fetchMediaSource.items(["a"])).toEqual({
      ok: false,
      code: "not_found",
      message: MEDIA_COPY.errLoad,
    });
    reply(401, { error: "signed_out" });
    expect(await fetchMediaSource.states(["a"])).toMatchObject({
      ok: false,
      code: "signed_out",
      message: MEDIA_COPY.signedOut,
    });
  });

  it("a network failure is ERR-LOAD", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await fetchMediaSource.list({ filter: "all" })).toEqual({
      ok: false,
      code: "network",
      message: MEDIA_COPY.errLoad,
    });
  });
});
