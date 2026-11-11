import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.join(import.meta.dirname, "../../");

// Add-on packages ship TypeScript source, so Next must transpile each one (RESEARCH
// Pitfall 6). Read at config time: dropping a folder into packages/addons needs no edit here.
function addonPackages(): string[] {
  const dir = path.join(repoRoot, "packages", "addons");
  if (!existsSync(dir)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const pkg = path.join(dir, entry.name, "package.json");
    if (entry.isDirectory() && existsSync(pkg)) {
      names.push(JSON.parse(readFileSync(pkg, "utf8")).name as string);
    }
  }
  return names.sort();
}

const nextConfig: NextConfig = {
  // Standalone only in Docker (Research Pitfall 7): the Dockerfile sets NEXT_OUTPUT=standalone.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingRoot: repoRoot,
  transpilePackages: [
    "@cds/core",
    "@cds/db",
    "@cds/ui",
    "@cds/templates",
    "@cds/addon-registry",
    ...addonPackages(),
  ],
  experimental: {
    // CSV imports travel as server-action arguments (RESEARCH Pattern 8); the row cap is
    // enforced by the importer (05-08). T-05-18.
    serverActions: { bodySizeLimit: "2mb" },
    // Photo uploads (06-13, ONB-04) go to the POST /hub/api/media route handler, which the
    // middleware matcher covers. Next buffers a middleware request body up to this size and
    // silently truncates the rest (default 10 MiB), so a 20 MB photo would arrive cut off
    // (RESEARCH Pitfall 1). 20 MB file + multipart overhead; the route enforces 20 MB itself.
    middlewareClientMaxBodySize: "22mb",
  },
  // 13-25 (P13-P33): the staff console's X-Robots-Tag is set by the middleware on platform
  // hosts only, not by headers() here: headers() runs before host routing, so a `/staff`
  // source would also noindex a tenant's own /staff page (an "Our staff" page).
  // 15-28 (D314, P15-P22): metadata is always rendered blocking in <head>. Next 15.2+ streams
  // generateMetadata into <body> for clients it does not list as HTML-limited bots, so the
  // description, robots and canonical tags landed after </head> on a timing race; Lighthouse
  // (and any crawler that reads <head> only) then saw none. /.*/ is Next's documented way to
  // turn streaming metadata off; the Lighthouse run showed no performance change on hub or
  // tenant pages.
  htmlLimitedBots: /.*/,
  // Lint runs from the repo root via `npm run lint` (root flat config).
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
