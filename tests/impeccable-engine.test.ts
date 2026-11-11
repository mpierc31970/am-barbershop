import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// THEME-04 / D48 / T-04-06: the impeccable engine binary is verified against a pinned
// sha256 and the release's <asset>.sha256 sidecar. Pure checks only: nothing is
// downloaded here.
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "impeccable",
  "fetch-engine.mjs",
);

type EngineModule = {
  ENGINE_VERSION: string;
  ENGINE_SHA256: Record<string, string>;
  assetName: (target: string) => string;
  checksumFor: (sidecarText: string, assetName: string) => string | null;
};

const load = async (): Promise<EngineModule> =>
  (await import(pathToFileURL(SCRIPT).href)) as EngineModule;

const TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "windows-x64",
];

describe("fetch-engine.mjs pin table", () => {
  it("pins engine 0.1.5", async () => {
    const { ENGINE_VERSION } = await load();
    expect(ENGINE_VERSION).toBe("0.1.5");
  });

  it("pins a sha256 for exactly the five supported targets", async () => {
    const { ENGINE_SHA256 } = await load();
    expect(Object.keys(ENGINE_SHA256).sort()).toEqual(TARGETS);
    for (const t of TARGETS) {
      expect(ENGINE_SHA256[t], t).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("keeps the researched linux-x64 and windows-x64 hashes", async () => {
    const { ENGINE_SHA256 } = await load();
    expect(ENGINE_SHA256["linux-x64"]).toBe(
      "cf5231a4b1ae66996c85b033800b1dad0797e590eae2f21ef2579430af187f19",
    );
    expect(ENGINE_SHA256["windows-x64"]).toBe(
      "477e544fc8880a5e82e427490cb9a5f5adab480c0e02966d33fd50772b531c71",
    );
  });

  it("names release assets per target", async () => {
    const { assetName } = await load();
    expect(assetName("windows-x64")).toBe("impeccable-windows-x64.exe");
    expect(assetName("linux-x64")).toBe("impeccable-linux-x64");
    expect(assetName("darwin-arm64")).toBe("impeccable-darwin-arm64");
  });
});

describe("fetch-engine.mjs sidecar parsing", () => {
  const hash = "c".repeat(64);

  it("reads '<hash>  <asset>' sidecars by exact asset name", async () => {
    const { checksumFor } = await load();
    expect(
      checksumFor(
        `${hash.toUpperCase()}  impeccable-linux-x64\n`,
        "impeccable-linux-x64",
      ),
    ).toBe(hash);
  });

  it("reads a bare '<hash>' sidecar", async () => {
    const { checksumFor } = await load();
    expect(checksumFor(`${hash}\n`, "impeccable-linux-x64")).toBe(hash);
  });

  it("rejects a sidecar naming another asset", async () => {
    const { checksumFor } = await load();
    expect(
      checksumFor(`${hash}  impeccable-linux-arm64`, "impeccable-linux-x64"),
    ).toBeNull();
    expect(
      checksumFor(`${hash}  evil-impeccable-linux-x64`, "impeccable-linux-x64"),
    ).toBeNull();
  });

  it("rejects a malformed hash", async () => {
    const { checksumFor } = await load();
    expect(
      checksumFor("abc123  impeccable-linux-x64", "impeccable-linux-x64"),
    ).toBeNull();
    expect(checksumFor(`${"z".repeat(64)}`, "impeccable-linux-x64")).toBeNull();
    expect(checksumFor("", "impeccable-linux-x64")).toBeNull();
  });
});
