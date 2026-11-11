import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// T-01-09 / WR-05: the binary is verified against a pinned hash, and checksums.txt is
// matched by exact file name. Pure checks only: nothing is downloaded here.
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "fetch-pocketbase.mjs",
);

type FetchModule = {
  PB_VERSION: string;
  PB_SHA256: Record<string, string>;
  checksumFor: (text: string, zipName: string) => string | null;
};

const load = async (): Promise<FetchModule> =>
  (await import(pathToFileURL(SCRIPT).href)) as FetchModule;

describe("fetch-pocketbase.mjs verification", () => {
  it("pins a sha256 for every supported os/arch", async () => {
    const { PB_SHA256 } = await load();
    for (const os of ["windows", "linux", "darwin"]) {
      for (const arch of ["amd64", "arm64"]) {
        expect(PB_SHA256[`${os}_${arch}`], `${os}_${arch}`).toMatch(
          /^[0-9a-f]{64}$/,
        );
      }
    }
  });

  it("matches checksums.txt entries by exact file name only", async () => {
    const { checksumFor } = await load();
    const text = [
      `${"a".repeat(64)}  evil_pocketbase_1_linux_amd64.zip`,
      `${"B".repeat(64)}  pocketbase_1_linux_amd64.zip`,
    ].join("\n");
    expect(checksumFor(text, "pocketbase_1_linux_amd64.zip")).toBe(
      "b".repeat(64),
    );
    expect(checksumFor(text, "pocketbase_1_linux_arm64.zip")).toBeNull();
  });
});
