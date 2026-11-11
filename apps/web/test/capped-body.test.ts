// WR-C05: capped body reads hold even when the request has no Content-Length (chunked).
import { describe, expect, it } from "vitest";
import {
  readCappedBody,
  readCappedFormData,
  readCappedText,
} from "../lib/capped-body";

/** A streamed POST with no Content-Length; counts how many chunks were pulled. */
function chunked(
  chunks: number,
  size: number,
  type = "text/plain",
): { req: Request; pulled: () => number } {
  let n = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (n >= chunks) return c.close();
      n += 1;
      c.enqueue(new Uint8Array(size).fill(120));
    },
  });
  const req = new Request("https://a.example.com/x", {
    method: "POST",
    body,
    headers: { "content-type": type },
    duplex: "half",
  } as RequestInit);
  return { req, pulled: () => n };
}

describe("readCappedBody (WR-C05)", () => {
  it("stops reading a chunked body with no length once it passes the cap", async () => {
    const { req, pulled } = chunked(1000, 1024);
    expect(req.headers.get("content-length")).toBeNull();
    expect(await readCappedBody(req, 4096)).toBeNull();
    expect(pulled()).toBeLessThan(10);
  });

  it("refuses a declared length over the cap without reading", async () => {
    const req = new Request("https://a.example.com/x", {
      method: "POST",
      body: "x".repeat(10),
      headers: { "content-length": "999999" },
    });
    expect(await readCappedBody(req, 4096)).toBeNull();
  });

  it("returns the whole body at or under the cap", async () => {
    const { req } = chunked(4, 1024);
    expect((await readCappedBody(req, 4096))?.byteLength).toBe(4096);
    const text = new Request("https://a.example.com/x", {
      method: "POST",
      body: "password=sourdough",
    });
    expect(await readCappedText(text, 4096)).toBe("password=sourdough");
  });

  it("parses capped form data with the request's content type", async () => {
    const req = new Request("https://a.example.com/x", {
      method: "POST",
      body: "a=1&b=two",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const form = await readCappedFormData(req, 4096);
    expect(form?.get("a")).toBe("1");
    expect(form?.get("b")).toBe("two");
    const big = chunked(200, 1024, "application/x-www-form-urlencoded");
    expect(await readCappedFormData(big.req, 131072)).toBeNull();
  });
});
