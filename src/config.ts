import type { RoomConfig } from "./temp-voice/logic.js";

// Only messages constructed by this application may be shown at startup.
export class ConfigurationError extends Error {}

function readId(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (
    !value ||
    !/^[1-9][0-9]{16,19}$/.test(value) ||
    BigInt(value) > 18446744073709551615n
  ) {
    throw new ConfigurationError(
      `${key} must be a valid Discord ID (17–20 digits).`,
    );
  }
  return value;
}

export function readConfig(env: NodeJS.ProcessEnv) {
  const token = env.DISCORD_TOKEN?.trim();

  if (!token) {
    throw new Error("DISCORD_TOKEN is required and must not be blank.");
  }

  const guildId = readId(env, "DISCORD_GUILD_ID");
  const rooms: readonly RoomConfig[] = [
    {
      triggerChannelId: readId(env, "BACKSTAGE_TRIGGER_CHANNEL_ID"),
      categoryId: readId(env, "BACKSTAGE_CATEGORY_ID"),
      namePrefix: "Backstage",
    },
    {
      triggerChannelId: readId(env, "STAGE_TRIGGER_CHANNEL_ID"),
      categoryId: readId(env, "STAGE_CATEGORY_ID"),
      namePrefix: "Stage",
    },
  ];
  if (
    new Set(rooms.map((room) => room.triggerChannelId)).size !== rooms.length
  ) {
    throw new ConfigurationError(
      "BACKSTAGE_TRIGGER_CHANNEL_ID and STAGE_TRIGGER_CHANNEL_ID must be different.",
    );
  }
  return { token, guildId, rooms };
}

export type Config = ReturnType<typeof readConfig>;
