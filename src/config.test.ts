import { describe, expect, it } from "vitest";
import { ConfigurationError, readConfig } from "./config.js";

const ids = {
  DISCORD_GUILD_ID: "123456789012345678",
  BACKSTAGE_TRIGGER_CHANNEL_ID: "234567890123456789",
  BACKSTAGE_CATEGORY_ID: "345678901234567890",
  STAGE_TRIGGER_CHANNEL_ID: "456789012345678901",
  STAGE_CATEGORY_ID: "567890123456789012",
};
const expectedIds = {
  guildId: ids.DISCORD_GUILD_ID,
  rooms: [
    {
      triggerChannelId: ids.BACKSTAGE_TRIGGER_CHANNEL_ID,
      categoryId: ids.BACKSTAGE_CATEGORY_ID,
      namePrefix: "Backstage",
    },
    {
      triggerChannelId: ids.STAGE_TRIGGER_CHANNEL_ID,
      categoryId: ids.STAGE_CATEGORY_ID,
      namePrefix: "Stage",
    },
  ],
};

describe("readConfig", () => {
  it("returns the configured token", () => {
    expect(readConfig({ ...ids, DISCORD_TOKEN: "test-token" })).toEqual({
      token: "test-token",
      ...expectedIds,
    });
  });

  it("trims surrounding whitespace", () => {
    expect(readConfig({ ...ids, DISCORD_TOKEN: "  test-token\n" })).toEqual({
      token: "test-token",
      ...expectedIds,
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

describe("Discord ID configuration", () => {
  it.each(Object.keys(ids))(
    "validates %s without exposing its value",
    (key) => {
      for (const invalid of [
        undefined,
        "",
        "abc-secret",
        "123",
        "012345678901234567",
        "-123456789012345678",
        "123456789012345678.0",
        "1e18",
        "18446744073709551616",
      ]) {
        const env = { ...ids, DISCORD_TOKEN: "secret-token", [key]: invalid };
        expect(() => readConfig(env)).toThrow(ConfigurationError);
        expect(() => readConfig(env)).toThrow(
          `${key} must be a valid Discord ID (17–20 digits).`,
        );
      }
    },
  );

  it("trims IDs and preserves integers beyond JavaScript's safe number range", () => {
    expect(
      readConfig({
        ...ids,
        DISCORD_TOKEN: "token",
        DISCORD_GUILD_ID: " 18446744073709551615 ",
      }).guildId,
    ).toBe("18446744073709551615");
  });
});

it("rejects a trigger shared by both room configurations", () => {
  expect(() =>
    readConfig({
      ...ids,
      DISCORD_TOKEN: "token",
      STAGE_TRIGGER_CHANNEL_ID: ids.BACKSTAGE_TRIGGER_CHANNEL_ID,
    }),
  ).toThrow(
    "BACKSTAGE_TRIGGER_CHANNEL_ID and STAGE_TRIGGER_CHANNEL_ID must be different.",
  );
});

it("keeps prefixes fixed in code even if extra environment values are supplied", () => {
  const config = readConfig({
    ...ids,
    DISCORD_TOKEN: "token",
    STAGE_NAME_PREFIX: "custom-name",
  });
  expect(config.rooms.map((room) => room.namePrefix)).toEqual([
    "Backstage",
    "Stage",
  ]);
});
