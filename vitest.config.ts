import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    // Testing Library가 전역 afterEach를 찾아 테스트마다 자동으로 cleanup 한다.
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
