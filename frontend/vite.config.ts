/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export function viteEnvironmentDirectory(isolatedBuild: string | undefined): false | undefined {
  return isolatedBuild === "1" ? false : undefined;
}

// https://vite.dev/config/
export default defineConfig({
  envDir: viteEnvironmentDirectory(process.env.VITE_ISOLATED_BUILD),
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost:5173/",
      },
    },
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
