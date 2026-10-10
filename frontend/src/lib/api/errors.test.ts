import { describe, expect, it } from "vitest";
import { normalizeDetail } from "./errors";

describe("normalizeDetail field attribution", () => {
  it.each([
    "name must be a string",
    "name should not be empty",
  ])("maps the field from %s", (message) => {
    expect(normalizeDetail([message]).fields).toEqual({ name: message });
  });

  it("keeps username validation separate from name", () => {
    const message = "username must contain only letters and numbers";
    expect(normalizeDetail([message]).fields).toEqual({ username: message });
  });

  it.each([
    "last_name should not be empty",
    "last name must be a string",
  ])("maps last-name validation without misattributing it to name: %s", (message) => {
    expect(normalizeDetail([message]).fields).toEqual({ last_name: message });
  });

  it("preserves existing monitor target and frequency mappings", () => {
    const target = "target must be a valid URL";
    const frequency = "frequency must be a positive number";
    expect(normalizeDetail([target, frequency]).fields).toEqual({ target, frequency });
  });
});
