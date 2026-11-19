import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("startup without valid configuration", () => {
  it.each([undefined, "   "])(
    "exits with a safe error for a missing or blank token (%j)",
    (token) => {
      // Do not load .env or inherit credentials from the test runner.
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        UNRELATED_SECRET: "must-not-appear-in-output",
      };
      if (token !== undefined) env.DISCORD_TOKEN = token;

      const result = spawnSync(
        process.execPath,
        ["--import=tsx", "src/index.ts"],
        {
          cwd: fileURLToPath(new URL("../", import.meta.url)),
          env,
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr.trim()).toBe(
        "Unable to start Encore. Check DISCORD_TOKEN and network access.",
      );
      expect(result.stdout.trim()).toBe("Shutting down Encore.");
      expect(result.stdout + result.stderr).not.toContain(env.UNRELATED_SECRET);
    },
  );
});
