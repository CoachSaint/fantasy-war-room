import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Hosted fixtures run explicitly with FWR_LIVE_TEST=1 and disposable
    // credentials. Ordinary CI excludes them rather than reporting skips.
    exclude: [...configDefaults.exclude,
      ...(process.env.FWR_LIVE_TEST === "1" ? [] : ["**/*.integration.test.ts"])],
  },
});
