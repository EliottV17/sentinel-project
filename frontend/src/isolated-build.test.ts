// @vitest-environment node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const configUrl = pathToFileURL(resolve("vite.config.ts")).href;

describe("viteEnvironmentDirectory", () => {
  it("disables dotenv discovery only for isolated production builds", async () => {
    const { viteEnvironmentDirectory } = await import(configUrl);
    expect(viteEnvironmentDirectory("1")).toBe(false);
    expect(viteEnvironmentDirectory(undefined)).toBeUndefined();
    expect(viteEnvironmentDirectory("0")).toBeUndefined();
  });
});
