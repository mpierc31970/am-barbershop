import { defineConfig } from "vitest/config";

// No passWithNoTests on the root or the unit project: a wrong glob or a moved directory
// must fail the run, not turn it green with nothing executed (WR-06).
export default defineConfig({
  test: {
    projects: [
      {
        // apps/web's tsconfig says jsx: "preserve" (Next compiles JSX itself), so the
        // test transform needs its own JSX runtime for .tsx pages under test (IN-11).
        oxc: { jsx: { runtime: "automatic" } },
        test: {
          name: "unit",
          include: [
            "packages/**/*.test.{ts,tsx}",
            "apps/**/*.test.{ts,tsx}",
            "tests/**/*.test.{ts,tsx}",
          ],
          exclude: [
            "**/*.integration.test.{ts,tsx}",
            "**/node_modules/**",
            "**/.next/**",
          ],
          environment: "node",
        },
      },
      {
        // apps/web integration tests render pages (.tsx) against real PB (RESEARCH Pitfall 13).
        oxc: { jsx: { runtime: "automatic" } },
        test: {
          name: "db-integration",
          include: [
            "packages/db/**/*.integration.test.ts",
            "apps/web/**/*.integration.test.{ts,tsx}",
          ],
          exclude: ["**/node_modules/**", "**/.next/**"],
          environment: "node",
          testTimeout: 120_000,
          hookTimeout: 180_000,
          passWithNoTests: true,
        },
      },
    ],
  },
});
