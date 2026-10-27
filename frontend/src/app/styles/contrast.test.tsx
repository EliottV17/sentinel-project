import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../../test/contrast";

const styles = readFileSync("src/app/styles/globals.css", "utf8");

function token(name: string): string {
  const match = new RegExp(`--color-${name}\\s*:\\s*(#[\\da-f]{6})`, "i").exec(styles);
  if (!match) throw new Error(`Missing canonical color token: ${name}`);
  return match[1];
}

function compatibilityBackground(selector: string): string {
  const escapedSelector = selector.replaceAll(".", "\\.");
  const rule = new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`).exec(styles)?.[1];
  const background = rule && /background-color:\s*var\((--color-[\w-]+)\)/.exec(rule)?.[1];
  if (!background) throw new Error(`Missing background token for compatibility selector ${selector}`);
  return background;
}

describe("Stage 4 contrast palette", () => {
  it("reproduces the former AA failure and verifies the existing danger-on-surface replacement", () => {
    const danger = token("danger");
    const dangerSoft = token("danger-soft");
    const surface = token("surface");

    expect(contrastRatio(danger, dangerSoft)).toBeCloseTo(4.1497, 3);
    expect(contrastRatio(danger, dangerSoft)).toBeLessThan(4.5);
    expect(contrastRatio(danger, surface)).toBeCloseTo(5.1728, 3);
    expect(contrastRatio(danger, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("subtle"), token("canvas"))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([".status-badge.border-red-300", ".pill-status.bg-red-100"])(
    "keeps the %s compatibility background within AA for danger text",
    (selector) => {
      const backgroundToken = compatibilityBackground(selector);
      expect(backgroundToken).toBe("--color-surface");
      expect(contrastRatio(token("danger"), token(backgroundToken.slice("--color-".length)))).toBeGreaterThanOrEqual(4.5);
    },
  );
});
