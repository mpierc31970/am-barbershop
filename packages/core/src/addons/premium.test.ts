import { describe, expect, it } from "vitest";
import {
  FIXTURE_HOW_TO,
  FIXTURE_PREMIUM_OK,
  FIXTURE_PREMIUM_RUNBOOK,
} from "./__fixtures__/manifests";
import { composeAddonRegistry } from "./compose";
import { AddonManifestError } from "./errors";
import type { AddonManifest, PremiumSpec } from "./types";

const files = new Set([FIXTURE_HOW_TO, FIXTURE_PREMIUM_RUNBOOK]);
const opts = { fileExists: (p: string) => files.has(p) };
const premium = FIXTURE_PREMIUM_OK.premium!;

function withPremium(
  p: Partial<PremiumSpec>,
  extra: Partial<AddonManifest> = {},
): AddonManifest {
  return { ...FIXTURE_PREMIUM_OK, ...extra, premium: { ...premium, ...p } };
}

function refuses(m: AddonManifest, pattern: RegExp, o = opts): void {
  let err: unknown;
  try {
    composeAddonRegistry([m], o);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(AddonManifestError);
  expect((err as Error).message).toMatch(pattern);
}

describe("premium gate (ADDON-15, D154, D156)", () => {
  it("a complete premium manifest composes", () => {
    const reg = composeAddonRegistry([FIXTURE_PREMIUM_OK], opts);
    expect(reg.get("fixture-premium")).toBe(FIXTURE_PREMIUM_OK);
  });

  it("refuses empty health checks", () => {
    refuses(withPremium({ healthChecks: [] }), /fixture-premium.*health/);
  });

  it("refuses empty backup collections", () => {
    refuses(
      withPremium({ backups: { collections: [], offsite: true } }),
      /fixture-premium.*backups/,
    );
  });

  it("refuses a backup collection the add-on does not declare", () => {
    refuses(
      withPremium({ backups: { collections: ["other_rows"], offsite: true } }),
      /fixture-premium.*other_rows/,
    );
  });

  it("refuses an external dependency without a fallback entry", () => {
    refuses(withPremium({ dependencies: {} }), /fixture-premium.*smtp/);
  });

  it("refuses a dependency with an empty fallback", () => {
    refuses(
      withPremium({
        dependencies: { smtp: { fallback: "", testedBy: "x.test.ts" } },
      }),
      /fixture-premium.*smtp.*fallback/,
    );
  });

  it("refuses a dependency with an empty testedBy", () => {
    refuses(
      withPremium({
        dependencies: { smtp: { fallback: "Queue it.", testedBy: " " } },
      }),
      /fixture-premium.*smtp.*testedBy/,
    );
  });

  it("refuses a runbook path that is not docs/runbooks/<slug>.md", () => {
    refuses(
      withPremium({ runbook: "docs/runbooks/other.md" }),
      /fixture-premium.*runbook.*docs\/runbooks\/fixture-premium\.md/,
    );
  });

  it("refuses a runbook file that does not exist", () => {
    refuses(FIXTURE_PREMIUM_OK, /fixture-premium.*runbook.*missing/, {
      fileExists: (p) => p === FIXTURE_HOW_TO,
    });
  });

  it("refuses backups that are not offsite (D154, A-WR-07)", () => {
    refuses(
      withPremium({
        backups: { collections: ["fixture_premium_items"], offsite: false },
      }),
      /fixture-premium.*offsite/,
    );
  });

  it("refuses a premium add-on that omits externalDependencies (A-WR-07)", () => {
    const { externalDependencies: _gone, ...rest } = FIXTURE_PREMIUM_OK;
    void _gone;
    refuses(
      { ...rest, premium: { ...premium, dependencies: {} } } as AddonManifest,
      /fixture-premium.*must list externalDependencies/,
    );
  });

  it("an empty dependency list needs the explicit acknowledgement", () => {
    refuses(
      withPremium({ dependencies: {} }, { externalDependencies: [] }),
      /fixture-premium.*noExternalDependencies/,
    );
    expect(() =>
      composeAddonRegistry(
        [
          withPremium(
            { dependencies: {}, noExternalDependencies: true },
            { externalDependencies: [] },
          ),
        ],
        opts,
      ),
    ).not.toThrow();
    refuses(
      withPremium({ noExternalDependencies: true }),
      /fixture-premium.*contradicts/,
    );
  });

  it("refuses a fallback for a dependency that is not declared", () => {
    refuses(
      withPremium({
        dependencies: {
          ...premium.dependencies,
          stripe: { fallback: "Queue it.", testedBy: "x.test.ts" },
        },
      }),
      /fixture-premium.*stripe.*not declared/,
    );
  });

  it("requires a D155 capture mode, or a waiver with a reason", () => {
    refuses(
      withPremium({ captureMode: undefined as never }),
      /fixture-premium.*captureMode is missing/,
    );
    refuses(
      withPremium({ captureMode: { description: "Queue.", testedBy: "" } }),
      /fixture-premium.*captureMode needs/,
    );
    refuses(
      withPremium({ captureMode: { waived: " " } }),
      /fixture-premium.*waiver needs a reason/,
    );
    expect(() =>
      composeAddonRegistry(
        [
          withPremium({
            captureMode: { waived: "Takes no customer requests." },
          }),
        ],
        opts,
      ),
    ).not.toThrow();
  });

  it("13-18: a capture (not a waiver) needs a convertCapture hook (D291)", () => {
    refuses(
      withPremium({
        captureMode: { description: "Queue.", testedBy: "x.test.ts" },
      }),
      /fixture-premium.*convertCapture/,
    );
    const capture = premium.captureMode as { convertCapture?: unknown };
    expect(typeof capture.convertCapture).toBe("function");
  });

  it("a non-premium add-on needs no premium spec", () => {
    const { premium: _unused, ...plain } = FIXTURE_PREMIUM_OK;
    void _unused;
    expect(() =>
      composeAddonRegistry([plain as AddonManifest], opts),
    ).not.toThrow();
  });
});
