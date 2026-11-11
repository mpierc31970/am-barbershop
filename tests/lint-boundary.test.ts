import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Invariant 1 / D5: only packages/db may import the PocketBase SDK.
const repoRoot = path.resolve(import.meta.dirname, "..");
const eslint = new ESLint({ cwd: repoRoot });
const RULE = "no-restricted-imports";
const TIMEOUT = 30_000; // FlatCompat loads slowly on first use.

async function restrictedImportHits(
  code: string,
  relPath: string,
): Promise<number> {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, relPath),
  });
  return result.messages.filter((m) => m.ruleId === RULE).length;
}

const DEFAULT_IMPORT =
  "import PocketBase from 'pocketbase';\nexport const x = PocketBase;\n";
const SUBPATH_REEXPORT = "export { default } from 'pocketbase/cjs';\n";
const TYPE_IMPORT =
  "import type { RecordModel } from 'pocketbase';\nexport type R = RecordModel;\n";

describe("Invariant 1 lint boundary (no-restricted-imports pocketbase)", () => {
  it(
    "flags a pocketbase import in packages/core",
    async () => {
      expect(
        await restrictedImportHits(DEFAULT_IMPORT, "packages/core/src/x.ts"),
      ).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "flags a pocketbase/* subpath re-export in apps/web",
    async () => {
      expect(
        await restrictedImportHits(SUBPATH_REEXPORT, "apps/web/app/x.ts"),
      ).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "flags a type-only pocketbase import in packages/ui",
    async () => {
      expect(
        await restrictedImportHits(TYPE_IMPORT, "packages/ui/src/x.ts"),
      ).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "allows the same imports inside packages/db",
    async () => {
      expect(
        await restrictedImportHits(DEFAULT_IMPORT, "packages/db/src/x.ts"),
      ).toBe(0);
      expect(
        await restrictedImportHits(SUBPATH_REEXPORT, "packages/db/src/y.ts"),
      ).toBe(0);
    },
    TIMEOUT,
  );

  const DEEP_DB =
    'import { superuser } from "@cds/db/src/client";\nexport const s = superuser;\n';

  it(
    "TEN-02: flags a deep @cds/db/* import in apps/web",
    async () => {
      expect(
        await restrictedImportHits(DEEP_DB, "apps/web/app/x.ts"),
      ).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "IN-07: flags a deep @cds/db/* import inside packages/db too",
    async () => {
      expect(
        await restrictedImportHits(DEEP_DB, "packages/db/src/x.ts"),
      ).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "IN-07: packages/db keeps pocketbase allowed while apps/web stays banned",
    async () => {
      expect(
        await restrictedImportHits(DEFAULT_IMPORT, "packages/db/src/x.ts"),
      ).toBe(0);
      expect(
        await restrictedImportHits(DEFAULT_IMPORT, "apps/web/app/x.ts"),
      ).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});

// Invariant 4 / ADDON-06 (RESEARCH Pattern 7; T-05-14): add-on isolation, one firing
// sample per rule plus the registry's allowed import.
async function ruleHits(
  code: string,
  relPath: string,
  rule: string,
): Promise<number> {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, relPath),
  });
  return result.messages.filter((m) => m.ruleId === rule).length;
}

const ADDON_FILE = "packages/addons/testimonials/repo.ts";
const BOUNDARY = "cds/addon-boundary";

describe("Invariant 4 lint boundary (add-on isolation, ADDON-06)", () => {
  it.each([
    [
      "apps/web importing an add-on",
      'import m from "@cds/addon-testimonials";\nexport const x = m;\n',
      "apps/web/app/x.ts",
      RULE,
    ],
    [
      "apps/web importing an add-on subpath",
      'import * as s from "@cds/addon-testimonials/server";\nexport const x = s;\n',
      "apps/web/lib/x.ts",
      RULE,
    ],
    [
      "an add-on importing another add-on",
      'import m from "@cds/addon-credentials";\nexport const x = m;\n',
      ADDON_FILE,
      RULE,
    ],
    [
      "an add-on importing the registry",
      'import { ADDON_REGISTRY } from "@cds/addon-registry";\nexport const x = ADDON_REGISTRY;\n',
      ADDON_FILE,
      RULE,
    ],
    ["an add-on importing pocketbase", DEFAULT_IMPORT, ADDON_FILE, RULE],
    [
      "an add-on reading process.env",
      "export const x = process.env.X;\n",
      ADDON_FILE,
      "no-restricted-properties",
    ],
    [
      "an add-on reading globalThis",
      "export const x = globalThis.foo;\n",
      ADDON_FILE,
      "no-restricted-globals",
    ],
    [
      "an add-on reading window",
      "export const x = window.location;\n",
      "packages/addons/testimonials/admin/Panel.tsx",
      "no-restricted-globals",
    ],
    [
      "an add-on reaching into another add-on by relative path (B-CR-01)",
      'import m from "../credentials/records";\nexport const x = m;\n',
      ADDON_FILE,
      BOUNDARY,
    ],
    [
      "an add-on admin file reaching into another add-on by relative path",
      'export { default } from "../../credentials/index";\n',
      "packages/addons/testimonials/admin/Panel.tsx",
      BOUNDARY,
    ],
    [
      "an add-on reaching tenantRepo by relative path into packages/db (R2-WR-01)",
      'import { tenantRepo } from "../../db/src/index";\nexport const x = tenantRepo;\n',
      ADDON_FILE,
      BOUNDARY,
    ],
    [
      "an add-on reaching a context minter by relative path (R2-WR-01)",
      'import { mintOrgContext } from "../../db/src/context";\nexport const x = mintOrgContext;\n',
      ADDON_FILE,
      BOUNDARY,
    ],
    [
      "an add-on re-exporting packages/db by relative path (R2-WR-01)",
      'export * from "../../../db/src/index";\n',
      "packages/addons/testimonials/admin/Panel.tsx",
      BOUNDARY,
    ],
    [
      "an add-on dynamically importing packages/db by relative path (R2-WR-01)",
      'export const load = () => import("../../db/src/index");\n',
      ADDON_FILE,
      BOUNDARY,
    ],
    [
      "an add-on requiring @cds/db through node_modules by relative path (R2-WR-01)",
      'export const m = require("../../../node_modules/@cds/db/src/index");\n',
      "packages/addons/testimonials/x.js",
      BOUNDARY,
    ],
    [
      "an add-on reaching packages/core internals by relative path (R2-WR-01)",
      'import { a } from "../../core/src/addons/compose";\nexport const x = a;\n',
      ADDON_FILE,
      BOUNDARY,
    ],
    [
      "an add-on's shipped code reaching the ui test helpers (R2-WR-01)",
      'import { render } from "../../../ui/src/test-support/dom";\nexport const x = render;\n',
      "packages/addons/testimonials/admin/Panel.tsx",
      BOUNDARY,
    ],
    [
      "apps/web reaching packages/db/src by relative path (IN-07, R2-WR-01)",
      'import { superuser } from "../../../packages/db/src/client";\nexport const x = superuser;\n',
      "apps/web/lib/x.ts",
      BOUNDARY,
    ],
    [
      "the registry reaching packages/db/src by relative path (R2-WR-01)",
      'import { tenantRepo } from "../../db/src/index";\nexport const x = tenantRepo;\n',
      "packages/addon-registry/src/x.ts",
      BOUNDARY,
    ],
    [
      "apps/web bypassing the registry by relative path (B-CR-01)",
      'import m from "../../../packages/addons/testimonials/index";\nexport const x = m;\n',
      "apps/web/lib/x.ts",
      BOUNDARY,
    ],
    [
      "apps/web importing an add-on with dynamic import() (B-CR-01)",
      'export const load = () => import("@cds/addon-testimonials");\n',
      "apps/web/lib/x.ts",
      BOUNDARY,
    ],
    [
      "apps/web requiring an add-on",
      'export const m = require("@cds/addon-testimonials/server");\n',
      "apps/web/lib/x.js",
      BOUNDARY,
    ],
    [
      "an add-on dynamically importing another add-on",
      'export const load = () => import("@cds/addon-credentials");\n',
      ADDON_FILE,
      BOUNDARY,
    ],
    [
      "an add-on importing next/headers",
      'import { headers } from "next/headers";\nexport const x = headers;\n',
      ADDON_FILE,
      RULE,
    ],
    [
      "an add-on importing node:process (B-WR-06)",
      'import { env } from "node:process";\nexport const x = env.X;\n',
      ADDON_FILE,
      RULE,
    ],
    [
      "an add-on importing node:fs (B-WR-06)",
      'import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n',
      ADDON_FILE,
      RULE,
    ],
    [
      "an add-on importing bare fs/promises (B-WR-06)",
      'import { readFile } from "fs/promises";\nexport const x = readFile;\n',
      "packages/addons/credentials/server.ts",
      RULE,
    ],
    [
      "an add-on reading self.location (B-WR-06)",
      "export const x = self.location;\n",
      "packages/addons/testimonials/admin/Panel.tsx",
      "no-restricted-globals",
    ],
    [
      "an add-on reading global (B-WR-06)",
      "export const x = global.foo;\n",
      ADDON_FILE,
      "no-restricted-globals",
    ],
    [
      "an add-on importing tenantRepo from @cds/db (B-WR-06)",
      'import { tenantRepo } from "@cds/db";\nexport const x = tenantRepo;\n',
      ADDON_FILE,
      "cds/addon-db-surface",
    ],
    [
      "an add-on importing the installer next to addonRepo (B-WR-06)",
      'import { addonRepo, installAddon } from "@cds/db";\nexport const x = [addonRepo, installAddon];\n',
      ADDON_FILE,
      "cds/addon-db-surface",
    ],
    [
      "an add-on importing all of @cds/db (B-WR-06)",
      'import * as db from "@cds/db";\nexport const x = db;\n',
      ADDON_FILE,
      "cds/addon-db-surface",
    ],
    [
      "an add-on re-exporting from @cds/db (B-WR-06)",
      'export * from "@cds/db";\n',
      ADDON_FILE,
      "cds/addon-db-surface",
    ],
    [
      "an add-on dynamically importing @cds/db (B-WR-06)",
      'export const load = () => import("@cds/db");\n',
      ADDON_FILE,
      "cds/addon-db-surface",
    ],
    [
      "a conditional hook in an add-on admin panel (B-WR-05)",
      'import { useState } from "react";\nexport function P({ on }: { on: boolean }) {\n  if (on) {\n    const [v] = useState(0);\n    return v;\n  }\n  return 0;\n}\n',
      "packages/addons/testimonials/admin/X.tsx",
      "react-hooks/rules-of-hooks",
    ],
    [
      "a missing effect dependency in an add-on site island (B-WR-05)",
      'import { useEffect } from "react";\nexport function P({ n }: { n: number }) {\n  useEffect(() => {\n    console.log(n);\n  }, []);\n  return null;\n}\n',
      "packages/addons/credentials/site/X.tsx",
      "react-hooks/exhaustive-deps",
    ],
  ])(
    "flags %s",
    async (_label, code, file, rule) => {
      expect(await ruleHits(code, file, rule)).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "allows the registry to import add-ons",
    async () => {
      expect(
        await restrictedImportHits(
          'import m from "@cds/addon-testimonials";\nexport const x = m;\n',
          "packages/addon-registry/src/x.ts",
        ),
      ).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "allows platform code to import the registry entry points",
    async () => {
      expect(
        await restrictedImportHits(
          'import { ADDON_SECTIONS } from "@cds/addon-registry";\nimport "@cds/addon-registry/server";\nexport const x = ADDON_SECTIONS;\n',
          "apps/web/lib/x.ts",
        ),
      ).toBe(0);
      expect(
        await restrictedImportHits(
          'import "@cds/addon-registry/server";\n',
          "packages/db/scripts/x.ts",
        ),
      ).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "allows an add-on's own relative imports, the registry's dynamic import, and db-internal addons/",
    async () => {
      expect(
        await ruleHits(
          'import { a } from "../records";\nimport { b } from "./sections/definition";\nexport const x = [a, b];\n',
          "packages/addons/testimonials/admin/Panel.tsx",
          BOUNDARY,
        ),
      ).toBe(0);
      expect(
        await ruleHits(
          'export const load = () => import("@cds/addon-registry/server");\n',
          "apps/web/lib/x.ts",
          BOUNDARY,
        ),
      ).toBe(0);
      expect(
        await ruleHits(
          'import { a } from "../addons/entitlements";\nexport const x = a;\n',
          "packages/db/src/content/x.ts",
          BOUNDARY,
        ),
      ).toBe(0);
      expect(
        await ruleHits(
          'import m from "../../addons/testimonials/index";\nexport const x = m;\n',
          "packages/addon-registry/src/x.ts",
          BOUNDARY,
        ),
      ).toBe(0);
      // R2-WR-01: an add-on's own tests may use the shared DOM helpers, and apps/web tests
      // may use packages/db/test fixtures (test code, not the src surface).
      expect(
        await ruleHits(
          'import { render } from "../../../ui/src/test-support/dom";\nexport const x = render;\n',
          "packages/addons/testimonials/admin/panel.dom.test.tsx",
          BOUNDARY,
        ),
      ).toBe(0);
      expect(
        await ruleHits(
          'import { seed } from "../../../packages/db/test/seeded";\nexport const x = seed;\n',
          "apps/web/test/x.integration.test.tsx",
          BOUNDARY,
        ),
      ).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "allows an add-on addonRepo and @cds/db types, and node:fs in its own tests (B-WR-06)",
    async () => {
      const ok =
        'import { addonRepo, type AddonCollectionRepo } from "@cds/db";\nimport type { OrgContext } from "@cds/db";\nexport type R = AddonCollectionRepo;\nexport type C = OrgContext;\nexport const x = addonRepo;\n';
      expect(await ruleHits(ok, ADDON_FILE, "cds/addon-db-surface")).toBe(0);
      expect(await restrictedImportHits(ok, ADDON_FILE)).toBe(0);
      expect(
        await restrictedImportHits(
          'import { existsSync } from "node:fs";\nimport path from "node:path";\nexport const x = [existsSync, path];\n',
          "packages/addons/testimonials/testimonials.test.ts",
        ),
      ).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "keeps pocketbase banned inside the registry",
    async () => {
      expect(
        await restrictedImportHits(
          DEFAULT_IMPORT,
          "packages/addon-registry/src/x.ts",
        ),
      ).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "allows next/link and next/navigation in an add-on admin panel",
    async () => {
      expect(
        await restrictedImportHits(
          'import Link from "next/link";\nimport { useRouter } from "next/navigation";\nexport const x = [Link, useRouter];\n',
          "packages/addons/testimonials/admin/Panel.tsx",
        ),
      ).toBe(0);
    },
    TIMEOUT,
  );
});

// PAY-09 / CONTEXT A1 (T-10-02-01, T-10-02-02): the Stripe SDK is imported only under
// packages/db/src/payments/stripe/**, packages/db included (flat config restates options).
const STRIPE_IMPORT =
  'import Stripe from "stripe";\nexport const s = Stripe;\n';
const STRIPE_SUBPATH = 'import "stripe/lib/x";\n';
const STRIPE_ADAPTER = "packages/db/src/payments/stripe/client.ts";

describe("PAY-09 lint boundary (no-restricted-imports stripe)", () => {
  it(
    "flags a stripe import everywhere outside the adapter folder",
    async () => {
      for (const file of [
        "packages/core/src/x.ts",
        "apps/web/app/x.ts",
        "packages/ui/src/x.tsx",
        "packages/addons/testimonials/x.ts",
        "packages/db/src/catalog.ts",
        "packages/db/src/payments/factory.ts",
        "packages/addon-registry/src/x.ts",
      ]) {
        expect(await restrictedImportHits(STRIPE_IMPORT, file), file).toBe(1);
      }
    },
    TIMEOUT,
  );

  it(
    "flags a stripe/* subpath outside the adapter folder",
    async () => {
      expect(
        await restrictedImportHits(STRIPE_SUBPATH, "packages/db/src/x.ts"),
      ).toBe(1);
      expect(
        await restrictedImportHits(STRIPE_SUBPATH, "packages/core/src/x.ts"),
      ).toBe(1);
    },
    TIMEOUT,
  );

  it(
    "allows stripe (and pocketbase) inside packages/db/src/payments/stripe",
    async () => {
      expect(await restrictedImportHits(STRIPE_IMPORT, STRIPE_ADAPTER)).toBe(0);
      expect(await restrictedImportHits(STRIPE_SUBPATH, STRIPE_ADAPTER)).toBe(
        0,
      );
      expect(await restrictedImportHits(DEFAULT_IMPORT, STRIPE_ADAPTER)).toBe(
        0,
      );
    },
    TIMEOUT,
  );

  it(
    "keeps the pocketbase ban and the deep @cds/db ban unchanged",
    async () => {
      expect(
        await restrictedImportHits(DEFAULT_IMPORT, "packages/core/src/x.ts"),
      ).toBeGreaterThan(0);
      expect(
        await restrictedImportHits(
          'import { superuser } from "@cds/db/src/client";\nexport const s = superuser;\n',
          STRIPE_ADAPTER,
        ),
      ).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});

// PUSH-01 (11-22, T-11-22-04): web-push is imported only under packages/db/src/alerts/push/**,
// packages/db included; the push adapter still refuses stripe (PAY-09) and vice versa.
const WEB_PUSH_IMPORT =
  'import webpush from "web-push";\nexport const w = webpush;\n';
const PUSH_ADAPTER = "packages/db/src/alerts/push/web-push.ts";

describe("PUSH-01 lint boundary (no-restricted-imports web-push)", () => {
  it(
    "flags a web-push import everywhere outside the adapter folder",
    async () => {
      for (const file of [
        "packages/core/src/x.ts",
        "apps/web/app/x.ts",
        "packages/ui/src/x.tsx",
        "packages/addons/testimonials/x.ts",
        "packages/db/src/alerts/raise.ts",
        "packages/db/src/payments/stripe/client.ts",
        "packages/addon-registry/src/x.ts",
      ]) {
        expect(await restrictedImportHits(WEB_PUSH_IMPORT, file), file).toBe(1);
      }
      expect(
        await restrictedImportHits(
          'import "web-push/src/x";\n',
          "packages/db/src/x.ts",
        ),
      ).toBe(1);
    },
    TIMEOUT,
  );

  it(
    "allows web-push inside packages/db/src/alerts/push, keeps the stripe ban there",
    async () => {
      expect(await restrictedImportHits(WEB_PUSH_IMPORT, PUSH_ADAPTER)).toBe(0);
      expect(await restrictedImportHits(DEFAULT_IMPORT, PUSH_ADAPTER)).toBe(0);
      expect(
        await restrictedImportHits(
          'import Stripe from "stripe";\nexport const s = Stripe;\n',
          PUSH_ADAPTER,
        ),
      ).toBe(1);
    },
    TIMEOUT,
  );
});
