// checkVtt (07-13; UPL-CAPTIONS; T-07-13-07).
import { describe, expect, it } from "vitest";
import { checkVtt, VTT_MAX_BYTES } from "./vtt";

const enc = (s: string) => new TextEncoder().encode(s);

describe("checkVtt", () => {
  it("accepts a WebVTT file and normalises CRLF", () => {
    const r = checkVtt(enc("WEBVTT\r\n\r\n00:00.000 --> 00:01.000\r\nHi"));
    expect(r).toEqual({
      ok: true,
      text: "WEBVTT\n\n00:00.000 --> 00:01.000\nHi",
    });
  });

  it("accepts a BOM (stripped), a title and a tab after the header", () => {
    const bom = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...enc("WEBVTT\n\n00:00.000 --> 00:01.000\nHi"),
    ]);
    const r = checkVtt(bom);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text.startsWith("WEBVTT")).toBe(true);
    expect(
      checkVtt(enc("WEBVTT - title\n\n00:00.000 --> 00:01.000\nHi")).ok,
    ).toBe(true);
    expect(checkVtt(enc("WEBVTT\t\n\n00:00.000 --> 00:01.000\nHi")).ok).toBe(
      true,
    );
  });

  it("refuses anything else", () => {
    expect(checkVtt(enc("WEBVTTX\n\n00:00.000 --> 00:01.000\nHi")).ok).toBe(
      false,
    );
    expect(checkVtt(enc("1\n00:00:00,000 --> 00:00:01,000\nHi")).ok).toBe(
      false,
    );
    expect(
      checkVtt(
        new Uint8Array([
          ...enc("WEBVTT\n\n00:00.000 --> 00:01.000\n"),
          0xff,
          0xfe,
        ]),
      ).ok,
    ).toBe(false);
    expect(
      checkVtt(enc("WEBVTT\n\n00:00.000 --> 00:01.000\nH\u0000i")).ok,
    ).toBe(false);
    expect(checkVtt(enc("WEBVTT\n\nno cues here")).ok).toBe(false);
    const big = enc(
      "WEBVTT\n\n00:00.000 --> 00:01.000\n" + "a".repeat(VTT_MAX_BYTES),
    );
    expect(checkVtt(big).ok).toBe(false);
    expect(checkVtt(new Uint8Array(0)).ok).toBe(false);
    expect(VTT_MAX_BYTES).toBe(512 * 1024);
  });
});
