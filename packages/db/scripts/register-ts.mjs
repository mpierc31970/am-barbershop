// Zero-dependency TypeScript script runner for @cds/db (plan 02-05; used by
// render-field-docs.ts now and the tenant export/restore CLIs in plan 08).
//
// Node's type stripping runs .ts directly but, like any ESM loader, will not resolve the
// extensionless relative imports the workspace uses ("./registry"). This resolve hook
// retries such a specifier from a .ts parent as "<spec>.ts", then "<spec>/index.ts".
// Workspace packages (@cds/core, @cds/db) resolve through node_modules links to their
// "exports" entry, which is already a .ts file.
//
// Run: node --experimental-strip-types --no-warnings=ExperimentalWarning \
//        --import ./packages/db/scripts/register-ts.mjs <script.ts>
// (Node >=22.12; the flag is a no-op on Node 24.)
import { register } from "node:module";

// The hook runs on the loader thread, so it is registered as a self-contained module.
const HOOK = `
const HAS_EXT = /\\.[cm]?[jt]sx?$|\\.json$/;
export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  const parent = context.parentURL ?? "";
  if (relative && !HAS_EXT.test(specifier) && /\\.[cm]?ts$/.test(parent)) {
    for (const candidate of [specifier + ".ts", specifier + "/index.ts"]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // try the next candidate
      }
    }
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(HOOK)}`);
