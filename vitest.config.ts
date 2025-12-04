import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  plugins: [tsconfigPaths() as any],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "app"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}", "app/routes/__tests__/**/*.test.ts"],
    // Use vmThreads to avoid tinypool stack overflow issues
    pool: "vmThreads",
    sequence: {
      shuffle: false,
    },
  },
});
