// Writes docs/ops/export-field-lists.md from the registry (LIFE-03). Run `npm run docs:fields`.
// Registers add-on collections before anything reads the composed registry (05-04).
import "@cds/addon-registry/server";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { renderFieldLists } from "../src/field-docs";

const out = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "docs",
  "ops",
  "export-field-lists.md",
);
writeFileSync(out, renderFieldLists());
console.log(`wrote ${path.relative(process.cwd(), out)}`);
