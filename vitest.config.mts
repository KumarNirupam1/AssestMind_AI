import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests only. Anything that needs the database, Clerk, or the network
 * belongs in an integration test or a Playwright smoke test, not here — the
 * value of Vitest here is that `npx vitest run` stays fast and hermetic.
 *
 * The `@/` alias mirrors the `paths` entry in tsconfig.json. It is declared
 * explicitly rather than pulled in via `vite-tsconfig-paths` to keep the
 * dependency surface small.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
