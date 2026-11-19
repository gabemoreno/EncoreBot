import { describe, expect, it } from "vitest";
import { readConfig } from "./config.js";

describe("readConfig", () => {
  it("returns the configured token", () => {
    expect(readConfig({ DISCORD_TOKEN: "test-token" })).toEqual({
      token: "test-token",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(readConfig({ DISCORD_TOKEN: "  test-token\n" })).toEqual({
      token: "test-token",
    });
  });

  it.each([undefined, "", "   ", "\t\n"])(
    "rejects a missing or blank token (%j) with a safe error",
    (token) => {
      expect(() =>
        readConfig({
          DISCORD_TOKEN: token,
          UNRELATED_SECRET: "must-not-appear-in-errors",
        }),
      ).toThrow(/^DISCORD_TOKEN is required and must not be blank\.$/);
    },
  );

  it("rejects an empty environment object", () => {
    expect(() => readConfig({})).toThrow("DISCORD_TOKEN is required");
  });
});
