// P8 (08-06): the CopyWriter selector (CONTEXT A3-Q4; T-08-06-03).
import { templateCopy } from "@cds/core/templates";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCopyWriter } from "./copy-writer";

describe("getCopyWriter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the template stand-in when CDS_COPY_WRITER is unset", () => {
    vi.stubEnv("CDS_COPY_WRITER", undefined);
    expect(getCopyWriter()).toBe(templateCopy);
  });

  it.each(["", "template"])("returns the stand-in for %j", (v) => {
    vi.stubEnv("CDS_COPY_WRITER", v);
    expect(getCopyWriter()).toBe(templateCopy);
  });

  it("fails loudly for any other value", () => {
    vi.stubEnv("CDS_COPY_WRITER", "anthropic");
    expect(() => getCopyWriter()).toThrow(/CDS_COPY_WRITER/);
    expect(() => getCopyWriter()).toThrow(/unset it to use the template/);
  });
});
