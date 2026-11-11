import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import tseslint from "typescript-eslint";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
const REPO_ROOT = import.meta.dirname;

// Invariant 4 / ADDON-06 (B-CR-01): no-restricted-imports sees only static bare specifiers.
// This rule closes the rest: a relative path that resolves into packages/addons/<slug> from
// outside that add-on (one add-on reaching into another, or platform code skipping the
// registry), and a dynamic import() or require() of an @cds/addon-* package. The registry
// itself is exempt from the add-on checks. R2-WR-01: an add-on's relative paths also stay
// inside its own folder, and nothing outside packages/db reaches packages/db/src relatively.
// tests/deps-boundary.test.ts scans source strings as the second guard.
const ADDON_BOUNDARY_RULE = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      relative:
        "Invariant 4: {{target}} is reached only through @cds/addon-registry (no relative paths into packages/addons).",
      dynamic: "Invariant 4: only @cds/addon-registry imports add-ons.",
      isolation:
        "Invariant 4 / D35: an add-on never imports another add-on or the registry; declare a dependency instead.",
      escape:
        "Invariant 1 / 4 (R2-WR-01): an add-on's relative imports stay inside its own folder, not {{target}}; take addonRepo and types from @cds/db and shared UI from @cds/ui.",
      dbDeep:
        "Invariant 1 (IN-07, R2-WR-01): {{target}} is reached only through the @cds/db public entry, never by relative path.",
    },
  },
  create(context) {
    const file = path
      .relative(REPO_ROOT, context.physicalFilename ?? context.filename)
      .split(path.sep)
      .join("/");
    const registry = file.startsWith("packages/addon-registry/");
    const own = /^packages\/addons\/([^/]+)\//.exec(file)?.[1] ?? null;
    // An add-on's own tests may use the shared DOM test helpers (no data access).
    const isTest = /\.test\.[cm]?[jt]sx?$/.test(file);
    const inside = (target, dir) =>
      target === dir || target.startsWith(`${dir}/`);

    function check(node, value, dynamic) {
      if (typeof value !== "string") return;
      if (value.startsWith(".")) {
        const target = path
          .relative(
            REPO_ROOT,
            path.resolve(REPO_ROOT, path.dirname(file), value),
          )
          .split(path.sep)
          .join("/");
        // R2-WR-01: a relative path must not bypass the @cds/db public entry (IN-07) or,
        // from an add-on, the addonRepo-only surface (B-WR-06). An add-on stays inside its
        // own folder; only packages/db itself reaches packages/db/src relatively.
        if (
          own &&
          !inside(target, `packages/addons/${own}`) &&
          !(isTest && inside(target, "packages/ui/src/test-support"))
        ) {
          context.report({ node, messageId: "escape", data: { target } });
          return;
        }
        if (
          !file.startsWith("packages/db/") &&
          inside(target, "packages/db/src")
        ) {
          context.report({ node, messageId: "dbDeep", data: { target } });
          return;
        }
        if (registry) return;
        const slug = /^packages\/addons\/([^/]+)(\/|$)/.exec(target)?.[1];
        if (slug && slug !== own) {
          context.report({
            node,
            messageId: own ? "isolation" : "relative",
            data: { target: `packages/addons/${slug}` },
          });
        }
        return;
      }
      if (registry || !dynamic) return; // static bare specifiers: no-restricted-imports
      const m = /^@cds\/addon-([a-z0-9-]+)(\/|$)/.exec(value);
      if (!m) return;
      if (own) context.report({ node, messageId: "isolation" });
      else if (m[1] !== "registry")
        context.report({ node, messageId: "dynamic" });
    }
    const literal = (n) => (n && n.type === "Literal" ? n.value : undefined);
    return {
      ImportDeclaration: (n) => check(n.source, n.source.value, false),
      ExportNamedDeclaration: (n) =>
        n.source && check(n.source, n.source.value, false),
      ExportAllDeclaration: (n) => check(n.source, n.source.value, false),
      ImportExpression: (n) => check(n.source, literal(n.source), true),
      CallExpression(n) {
        if (n.callee.type === "Identifier" && n.callee.name === "require") {
          check(n.arguments[0], literal(n.arguments[0]), true);
        }
      },
    };
  },
};
// Invariant 4 (B-WR-06; CONTEXT A1-Q4 rejected "letting add-ons use tenantRepo directly"):
// an add-on touches only its own collections, so from @cds/db it may take addonRepo (scoped
// to the add-on's declared collections) and types, nothing else. tenantRepo, the installer,
// publish and the auth minters stay out. Namespace, default, export-from, dynamic import()
// and require() of @cds/db are refused, since they would reach the whole surface.
const ADDON_DB_VALUES = new Set(["addonRepo"]);
const ADDON_DB_RULE = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      name: "Invariant 4: an add-on takes only addonRepo (and types) from @cds/db, not {{name}}; it touches only its own collections.",
      whole:
        "Invariant 4: an add-on imports named addonRepo (and types) from @cds/db, never the whole module.",
    },
  },
  create(context) {
    const isDb = (v) => v === "@cds/db";
    const literal = (n) => (n && n.type === "Literal" ? n.value : undefined);
    return {
      ImportDeclaration(n) {
        if (!isDb(n.source.value) || n.importKind === "type") return;
        for (const s of n.specifiers) {
          if (s.type !== "ImportSpecifier") {
            context.report({ node: s, messageId: "whole" });
            continue;
          }
          if (s.importKind === "type") continue;
          const name =
            s.imported.type === "Identifier"
              ? s.imported.name
              : s.imported.value;
          if (!ADDON_DB_VALUES.has(name)) {
            context.report({ node: s, messageId: "name", data: { name } });
          }
        }
      },
      ExportNamedDeclaration(n) {
        if (n.source && isDb(n.source.value) && n.exportKind !== "type") {
          for (const s of n.specifiers) {
            if (s.exportKind === "type") continue;
            const name =
              s.local.type === "Identifier" ? s.local.name : s.local.value;
            if (!ADDON_DB_VALUES.has(name)) {
              context.report({ node: s, messageId: "name", data: { name } });
            }
          }
        }
      },
      ExportAllDeclaration(n) {
        if (isDb(n.source.value) && n.exportKind !== "type") {
          context.report({ node: n, messageId: "whole" });
        }
      },
      ImportExpression(n) {
        if (isDb(literal(n.source))) {
          context.report({ node: n, messageId: "whole" });
        }
      },
      CallExpression(n) {
        if (
          n.callee.type === "Identifier" &&
          n.callee.name === "require" &&
          isDb(literal(n.arguments[0]))
        ) {
          context.report({ node: n, messageId: "whole" });
        }
      },
    };
  },
};

const CDS_PLUGIN = {
  rules: {
    "addon-boundary": ADDON_BOUNDARY_RULE,
    "addon-db-surface": ADDON_DB_RULE,
  },
};

// Invariant 1 / D5: one chokepoint owns all database access. Only packages/db may hold a
// PocketBase client. tests/deps-boundary.test.ts covers require() and dynamic import().
const INVARIANT_1 = "Invariant 1: only packages/db may use the PocketBase SDK.";
const POCKETBASE_BOUNDARY = {
  paths: [{ name: "pocketbase", message: INVARIANT_1 }],
  patterns: [{ group: ["pocketbase/*"], message: INVARIANT_1 }],
};

// PAY-09 / CONTEXT A1: the Stripe SDK lives only in the payments/stripe adapter folder,
// packages/db included. Everything else goes through the gateway interface. The
// payments/stripe block below is the one carve-out; tests/deps-boundary.test.ts scans
// require() and import() too.
const PAY_09 =
  "PAY-09: only packages/db/src/payments/stripe may use the Stripe SDK; go through @cds/db payments (CdsBilling / PaymentGateway).";
const STRIPE_BOUNDARY = {
  paths: [{ name: "stripe", message: PAY_09 }],
  patterns: [{ group: ["stripe/*"], message: PAY_09 }],
};

// PUSH-01 (P11, 11-22): the web-push library lives only in the alerts/push adapter folder,
// packages/db included. Everything else raises alerts through @cds/db. The alerts/push block
// below is the one carve-out; tests/deps-boundary.test.ts scans require() and import() too.
const PUSH_01 = "PUSH-01: only packages/db/src/alerts/push may use web-push";
const WEB_PUSH_BOUNDARY = {
  paths: [{ name: "web-push", message: PUSH_01 }],
  patterns: [{ group: ["web-push/*"], message: PUSH_01 }],
};

// Invariant 4 / ADDON-06 (RESEARCH Pattern 7): only @cds/addon-registry imports add-ons.
// The pattern group is ["@cds/addon-*"] minus the registry itself, written as a regex so
// the registry's own specifiers (and its subpaths) stay importable everywhere.
const INVARIANT_4 = "Invariant 4: only @cds/addon-registry imports add-ons.";
const ADDON_BOUNDARY = {
  regex: "^@cds/addon-(?!registry(/|$))",
  message: INVARIANT_4,
};

// Applies everywhere, packages/db included (IN-07): @cds/db is reached only through its
// public entry, so client.ts and the context minters can never be deep-imported.
// Flat config replaces rule options wholesale per matching block, so the packages/db
// block below restates these instead of turning the rule off.
const SHARED_RESTRICTIONS = {
  paths: [],
  patterns: [
    {
      group: ["@cds/db/*"],
      message: "Import @cds/db via its public entry only (Invariant 1).",
    },
    ADDON_BOUNDARY,
  ],
};
// packages/addon-registry is the one place add-ons are imported (the override block below).
// PAY-09: STRIPE_BOUNDARY is merged into every block that restates options.
const REGISTRY_RESTRICTIONS = {
  paths: [
    ...POCKETBASE_BOUNDARY.paths,
    ...STRIPE_BOUNDARY.paths,
    ...WEB_PUSH_BOUNDARY.paths, // PUSH-01
  ],
  patterns: [
    ...SHARED_RESTRICTIONS.patterns.filter((p) => p !== ADDON_BOUNDARY),
    ...POCKETBASE_BOUNDARY.patterns,
    ...STRIPE_BOUNDARY.patterns,
    ...WEB_PUSH_BOUNDARY.patterns, // PUSH-01
  ],
};

// Inside an add-on (invariant 4, D35): no other add-on, no registry (declare a dependency
// instead), no PocketBase SDK (data goes through @cds/db), and no next/* except
// next/link and next/navigation (used by admin/ panels). Org context arrives as a
// parameter, so env and global state are off limits too.
const ADDON_ISOLATION =
  "Invariant 4 / D35: an add-on never imports another add-on or the registry; declare a dependency instead.";
const ADDON_RESTRICTIONS = {
  paths: [
    {
      name: "pocketbase",
      message:
        "Invariant 1 / 4: add-ons reach data only through @cds/db, never the PocketBase SDK.",
    },
    {
      name: "next",
      message:
        "Invariant 4: add-ons may import only next/link and next/navigation.",
    },
    ...STRIPE_BOUNDARY.paths, // PAY-09
    ...WEB_PUSH_BOUNDARY.paths, // PUSH-01
  ],
  patterns: [
    ...SHARED_RESTRICTIONS.patterns.filter((p) => p !== ADDON_BOUNDARY),
    { regex: "^@cds/addon-", message: ADDON_ISOLATION },
    ...POCKETBASE_BOUNDARY.patterns,
    ...STRIPE_BOUNDARY.patterns, // PAY-09
    ...WEB_PUSH_BOUNDARY.patterns, // PUSH-01
    {
      regex: "^next/(?!(link|navigation)$)",
      message:
        "Invariant 4: add-ons may import only next/link and next/navigation.",
    },
  ],
};
// Node built-ins are env, disk, network and process state (B-WR-06): an add-on's shipped code
// never reads them. Its own *.test.ts files may (fixtures on disk), see the block below.
const ADDON_NODE = {
  regex:
    "^(node:)?(fs|process|child_process|os|path|net|http|https|http2|dgram|dns|tls|cluster|worker_threads|vm|v8|module|inspector)(/|$)",
  message:
    "Invariant 4: add-ons receive org context as a parameter; never read env, disk or the network through Node built-ins.",
};
const ADDON_SOURCE_RESTRICTIONS = {
  paths: ADDON_RESTRICTIONS.paths,
  patterns: [...ADDON_RESTRICTIONS.patterns, ADDON_NODE],
};
const ADDON_ENV = "Add-ons receive org context as a parameter; never read env.";
const ADDON_GLOBAL =
  "Add-ons receive org context as a parameter; never read global state (invariant 4).";
const WITH_POCKETBASE = {
  paths: [
    ...SHARED_RESTRICTIONS.paths,
    ...POCKETBASE_BOUNDARY.paths,
    ...STRIPE_BOUNDARY.paths, // PAY-09
    ...WEB_PUSH_BOUNDARY.paths, // PUSH-01
  ],
  patterns: [
    ...SHARED_RESTRICTIONS.patterns,
    ...POCKETBASE_BOUNDARY.patterns,
    ...STRIPE_BOUNDARY.patterns, // PAY-09
    ...WEB_PUSH_BOUNDARY.patterns, // PUSH-01
  ],
};
// PAY-09: packages/db keeps pocketbase allowed but still refuses stripe (T-10-02-02),
// and web-push outside alerts/push (PUSH-01).
const DB_RESTRICTIONS = {
  paths: [
    ...SHARED_RESTRICTIONS.paths,
    ...STRIPE_BOUNDARY.paths,
    ...WEB_PUSH_BOUNDARY.paths,
  ],
  patterns: [
    ...SHARED_RESTRICTIONS.patterns,
    ...STRIPE_BOUNDARY.patterns,
    ...WEB_PUSH_BOUNDARY.patterns,
  ],
};
// PAY-09 adapter: no stripe ban, still no web-push (PUSH-01).
const STRIPE_ADAPTER_RESTRICTIONS = {
  paths: [...SHARED_RESTRICTIONS.paths, ...WEB_PUSH_BOUNDARY.paths],
  patterns: [...SHARED_RESTRICTIONS.patterns, ...WEB_PUSH_BOUNDARY.patterns],
};
// PUSH-01 adapter: no web-push ban, still no stripe (PAY-09).
const PUSH_ADAPTER_RESTRICTIONS = {
  paths: [...SHARED_RESTRICTIONS.paths, ...STRIPE_BOUNDARY.paths],
  patterns: [...SHARED_RESTRICTIONS.patterns, ...STRIPE_BOUNDARY.patterns],
};

const WEB_FILES = ["apps/web/**/*.{ts,tsx,js,jsx,mjs}"];
// Add-on admin/ and site/ modules are client components too (B-WR-05): every future add-on
// panel gets the hooks rules without opting in.
const UI_FILES = ["packages/ui/**/*.{ts,tsx}", "packages/addons/**/*.{ts,tsx}"];

const nextConfigs = compat
  .extends("next/core-web-vitals", "next/typescript")
  .map((config) => ({ ...config, files: WEB_FILES }));

// packages/ui and packages/addons hold client components (builder, site islands, add-on
// panels) outside apps/web, so the hooks rules follow them there (RESEARCH Pitfall 10).
// The plugin object is reused from the next config: flat config refuses two different
// objects under one plugin name.
const reactHooksPlugin = nextConfigs.find((c) => c.plugins?.["react-hooks"])
  ?.plugins["react-hooks"];
if (!reactHooksPlugin) throw new Error("eslint: react-hooks plugin not found");

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      ".pocketbase/**",
      "**/pb_migrations/**",
      // PocketBase goja hooks use JSVM globals, not TS; .storage is the plan 05 local store.
      "**/pb_hooks/**",
      ".storage/**",
      ".storage-public/**",
      "**/next-env.d.ts",
      ".planning/**",
      ".base/**",
      ".base-ast/**",
      ".base-ast-cache/**",
      "scripts/runner/**",
      ".lighthouseci/**",
    ],
  },
  ...tseslint.configs.recommended,
  ...nextConfigs,
  { files: WEB_FILES, settings: { next: { rootDir: "apps/web" } } },
  {
    files: UI_FILES,
    plugins: { "react-hooks": reactHooksPlugin },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  { rules: { "no-restricted-imports": ["error", WITH_POCKETBASE] } },
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    plugins: { cds: CDS_PLUGIN },
    rules: { "cds/addon-boundary": "error" },
  },
  {
    // Restates SHARED_RESTRICTIONS (incl. the invariant 4 rule: only @cds/addon-registry
    // imports add-ons) with pocketbase allowed and STRIPE_BOUNDARY kept (PAY-09).
    files: ["packages/db/**"],
    rules: { "no-restricted-imports": ["error", DB_RESTRICTIONS] },
  },
  {
    // PAY-09 / CONTEXT A1: the one carve-out. The Stripe adapter restates
    // SHARED_RESTRICTIONS without the STRIPE_BOUNDARY entries (flat config replaces
    // options per block, RESEARCH Pitfall 7).
    files: ["packages/db/src/payments/stripe/**"],
    rules: { "no-restricted-imports": ["error", STRIPE_ADAPTER_RESTRICTIONS] },
  },
  {
    // PUSH-01 (11-22): the one web-push carve-out, same shape as PAY-09's.
    files: ["packages/db/src/alerts/push/**"],
    rules: { "no-restricted-imports": ["error", PUSH_ADAPTER_RESTRICTIONS] },
  },
  {
    files: ["packages/addon-registry/**"],
    rules: { "no-restricted-imports": ["error", REGISTRY_RESTRICTIONS] },
  },
  {
    files: ["packages/addons/**"],
    plugins: { cds: CDS_PLUGIN },
    rules: {
      "no-restricted-imports": ["error", ADDON_SOURCE_RESTRICTIONS],
      "cds/addon-db-surface": "error",
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: ADDON_ENV },
      ],
      "no-restricted-globals": [
        "error",
        { name: "globalThis", message: ADDON_GLOBAL },
        { name: "window", message: ADDON_GLOBAL },
        { name: "self", message: ADDON_GLOBAL },
        { name: "global", message: ADDON_GLOBAL },
        { name: "process", message: ADDON_GLOBAL },
      ],
    },
  },
  {
    // An add-on's own tests may read fixtures from disk (node:fs, node:path); everything
    // else in ADDON_RESTRICTIONS still applies.
    files: ["packages/addons/**/*.test.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", ADDON_RESTRICTIONS] },
  },
];
