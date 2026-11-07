import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    isolate: false,
    setupFiles: ["tests/helpers/setup-chatgpt.ts"],
  },
});
