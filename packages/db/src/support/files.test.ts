// 12-07 Task 1: support file type detection (choice 1). Extension AND magic bytes must agree.
import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { SUPPORT_FILE_TYPES, detectSupportFileType } from "./files";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const GIF = strToU8("GIF89a\x01\x00\x01\x00");
const WEBP = strToU8("RIFF\x24\x00\x00\x00WEBPVP8 ");
const PDF = strToU8("%PDF-1.7\n%stuff");
const HTML = strToU8("<!doctype html><script>alert(1)</script>");

function office(dir: "word" | "xl" | "ppt"): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    [`${dir}/document.xml`]: strToU8("<x/>"),
  });
}

describe("detectSupportFileType", () => {
  it("accepts a PNG named .png", () => {
    expect(detectSupportFileType("shot.png", PNG)?.ext).toBe("png");
    expect(detectSupportFileType("shot.png", PNG)?.mime).toBe("image/png");
  });

  it("refuses a PNG named .pdf and HTML named .png", () => {
    expect(detectSupportFileType("shot.pdf", PNG)).toBeNull();
    expect(detectSupportFileType("a.png", HTML)).toBeNull();
  });

  it("accepts jpg/jpeg, gif, webp and pdf by their magic", () => {
    expect(detectSupportFileType("a.jpg", JPG)?.ext).toBe("jpg");
    expect(detectSupportFileType("a.JPEG", JPG)?.ext).toBe("jpg");
    expect(detectSupportFileType("a.gif", GIF)?.mime).toBe("image/gif");
    expect(detectSupportFileType("a.webp", WEBP)?.mime).toBe("image/webp");
    expect(detectSupportFileType("a.pdf", PDF)?.ext).toBe("pdf");
    expect(detectSupportFileType("a.gif", PNG)).toBeNull();
  });

  it("accepts UTF-8 text and CSV, refuses a NUL byte or invalid UTF-8", () => {
    expect(detectSupportFileType("a.csv", strToU8("a,b\n1,é\n"))?.ext).toBe(
      "csv",
    );
    expect(detectSupportFileType("notes.txt", strToU8("hello"))?.ext).toBe(
      "txt",
    );
    expect(
      detectSupportFileType("a.csv", new Uint8Array([0x61, 0x00, 0x62])),
    ).toBeNull();
    expect(
      detectSupportFileType("a.txt", new Uint8Array([0xc3, 0x28])),
    ).toBeNull();
    expect(detectSupportFileType("a.txt", new Uint8Array(0))).toBeNull();
    expect(detectSupportFileType("a.txt", PNG)).toBeNull();
  });

  it("tells docx, xlsx and pptx apart", () => {
    expect(detectSupportFileType("a.xlsx", office("xl"))?.ext).toBe("xlsx");
    expect(detectSupportFileType("a.docx", office("word"))?.ext).toBe("docx");
    expect(detectSupportFileType("a.pptx", office("ppt"))?.ext).toBe("pptx");
    expect(detectSupportFileType("a.xlsx", office("word"))).toBeNull();
    expect(
      detectSupportFileType("a.docx", zipSync({ "x.txt": strToU8("x") })),
    ).toBeNull();
  });

  it("refuses unknown and missing extensions", () => {
    expect(detectSupportFileType("a.exe", PNG)).toBeNull();
    expect(detectSupportFileType("png", PNG)).toBeNull();
    expect(detectSupportFileType("a.svg", strToU8("<svg/>"))).toBeNull();
  });

  it("serves only images as image/*", () => {
    for (const t of SUPPORT_FILE_TYPES) {
      expect(t.mime.startsWith("image/")).toBe(
        ["png", "jpg", "webp", "gif"].includes(t.ext),
      );
    }
  });
});
