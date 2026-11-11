// Manifest intake + emails contributions (CONTEXT A3-Q5, RESEARCH Pattern 7, EMAIL-01, D267,
// T-06-07, T-06-08): compose accepts an add-on's own records/csv and slug-prefixed classed
// email types, and refuses everything else.
import { describe, expect, it } from "vitest";
import type { CsvSpec } from "../csv/types";
import { FIXTURE_HOW_TO, fixtureManifest } from "./__fixtures__/manifests";
import { composeAddonRegistry } from "./compose";
import { AddonManifestError } from "./errors";
import type {
  AddonEmailSpec,
  AddonIntake,
  AddonManifest,
  AddonRecordSpec,
} from "./types";

const opts = { fileExists: (p: string) => p === FIXTURE_HOW_TO };
const SLUG = "fixture-quote";

const RECORD: AddonRecordSpec = {
  singular: "quote",
  plural: "quotes",
  validate: (raw) => raw as Record<string, unknown>,
  textsOf: () => [],
  urlsOf: () => [],
  title: () => "",
  publishedField: "is_published",
  orderField: "sort_order",
};

function manifest(extra: Partial<AddonManifest>): AddonManifest {
  return fixtureManifest({
    slug: SLUG,
    records: { fixture_quotes: RECORD },
    csv: { fixture_quotes: {} as unknown as CsvSpec },
    ...extra,
  });
}

const RECORDS_OK: AddonIntake["records"] = {
  collection: "fixture_quotes",
  csv: "fixture_quotes",
  label: "Paste or import your quotes",
  addOneLabel: "Add one by one",
};

function refuses(m: AddonManifest, pattern: RegExp): void {
  let err: unknown;
  try {
    composeAddonRegistry([m], opts);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(AddonManifestError);
  expect((err as Error).message).toContain(SLUG);
  expect((err as Error).message).toMatch(pattern);
}

const composes = (m: AddonManifest) =>
  expect(() => composeAddonRegistry([m], opts)).not.toThrow();

describe("manifest intake (CONTEXT A3-Q5)", () => {
  it("composes an intake records step naming its own collection and csv", () => {
    composes(manifest({ intake: { records: RECORDS_OK } }));
  });

  it("refuses a records collection that is not its own", () => {
    refuses(
      manifest({ intake: { records: { ...RECORDS_OK, collection: "users" } } }),
      /intake/,
    );
  });

  it("refuses a csv key that is not in manifest.csv", () => {
    refuses(
      manifest({ intake: { records: { ...RECORDS_OK, csv: "other" } } }),
      /intake.*csv/,
    );
  });

  it("composes valid fields and refuses a duplicate field id", () => {
    const field = {
      id: "tagline",
      label: "Tagline",
      kind: "text" as const,
      helper: "One line.",
      fallback: "We leave this out.",
    };
    composes(manifest({ intake: { fields: [field] } }));
    refuses(
      manifest({ intake: { fields: [field, field] } }),
      /intake.*duplicated/,
    );
  });

  it("refuses a field with an empty fallback (ONB-03)", () => {
    refuses(
      manifest({
        intake: {
          fields: [
            {
              id: "tagline",
              label: "Tagline",
              kind: "text",
              helper: "One line.",
              fallback: " ",
            },
          ],
        },
      }),
      /intake.*fallback/,
    );
  });

  it("refuses a field id that is not a plain identifier", () => {
    refuses(
      manifest({
        intake: {
          fields: [
            {
              id: "Bad Id",
              label: "x",
              kind: "text",
              helper: "x",
              fallback: "x",
            },
          ],
        },
      }),
      /intake field id/,
    );
  });
});

describe("manifest emails (EMAIL-01, D267)", () => {
  const ok: AddonEmailSpec = {
    type: `${SLUG}.thanks`,
    class: "transactional",
    description: "Thanks a visitor for a quote.",
  };

  it("composes a slug-prefixed, classed email type", () => {
    composes(manifest({ emails: [ok] }));
  });

  it("refuses a type not prefixed with the slug", () => {
    refuses(
      manifest({ emails: [{ ...ok, type: "other.thanks" }] }),
      /email type/,
    );
  });

  it("refuses a class other than transactional or marketing", () => {
    refuses(
      manifest({
        emails: [{ ...ok, class: "promo" as unknown as "marketing" }],
      }),
      /class/,
    );
  });

  it("refuses a duplicate type", () => {
    refuses(manifest({ emails: [ok, ok] }), /duplicated/);
  });
});
