import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type VoiceState,
} from "discord.js";
import { ConfigurationError, type Config } from "../config.js";
import {
  getNextRoomName,
  getRoomForJoin,
  shouldDeleteTempChannel,
  type RoomConfig,
} from "./logic.js";

type VoiceConfig = Omit<Config, "token">;

export async function validateTempVoiceSetup(
  client: Client,
  config: VoiceConfig,
): Promise<Guild> {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    if (guild.id !== config.guildId)
      throw new ConfigurationError(
        "DISCORD_GUILD_ID does not match the accessible guild.",
      );
    if (!guild.available)
      throw new ConfigurationError("The configured guild is unavailable.");
    const channels = await guild.channels.fetch();
    const me = await guild.members.fetchMe();
    const voicePermissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.MoveMembers,
    ];
    for (const room of config.rooms) {
      const trigger = channels.get(room.triggerChannelId);
      const category = channels.get(room.categoryId);
      if (
        trigger?.type !== ChannelType.GuildVoice ||
        trigger.guild.id !== guild.id
      ) {
        throw new ConfigurationError(
          `${room.namePrefix} trigger must identify an accessible normal voice channel in DISCORD_GUILD_ID.`,
        );
      }
      if (
        category?.type !== ChannelType.GuildCategory ||
        category.guild.id !== guild.id
      ) {
        throw new ConfigurationError(
          `${room.namePrefix} category must identify an accessible category in DISCORD_GUILD_ID.`,
        );
      }
      if (!trigger.permissionsFor(me)?.has(voicePermissions)) {
        throw new ConfigurationError(
          `The bot needs View Channel, Connect, and Move Members on the ${room.namePrefix} trigger.`,
        );
      }
      if (
        !category
          .permissionsFor(me)
          ?.has([...voicePermissions, PermissionFlagsBits.ManageChannels])
      ) {
        throw new ConfigurationError(
          `The bot needs View Channel, Connect, Move Members, and Manage Channels on the ${room.namePrefix} category.`,
        );
      }
    }
    return guild;
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError(
      "Unable to validate DISCORD_GUILD_ID and its channels. Check bot membership, permissions, and network access.",
    );
  }
}

export function createTempVoiceHandler(guild: Guild, config: VoiceConfig) {
  const trackedIds = new Set<string>();
  const triggerIds = new Set(config.rooms.map((room) => room.triggerChannelId));
  let queue = Promise.resolve();
  let stopped = false;
  const connected = () => guild.available && guild.client.isReady();
  const available = () => !stopped && connected();
  const memberCount = (channelId: string) =>
    guild.voiceStates.cache.filter((state) => state.channelId === channelId)
      .size;

  async function cleanup(channelId: string) {
    if (
      !connected() ||
      !shouldDeleteTempChannel(
        { id: channelId, memberCount: memberCount(channelId) },
        trackedIds,
        triggerIds,
      )
    )
      return;
    try {
      // Force a REST check for existence, then recheck the current Gateway state.
      const channel = await guild.channels.fetch(channelId, { force: true });
      if (!channel) {
        trackedIds.delete(channelId);
        return;
      }
      if (
        connected() &&
        channel.type === ChannelType.GuildVoice &&
        channel.guild.id === config.guildId &&
        shouldDeleteTempChannel(
          { id: channel.id, memberCount: memberCount(channel.id) },
          trackedIds,
          triggerIds,
        )
      ) {
        await channel.delete("Encore temporary voice channel is empty");
        trackedIds.delete(channelId);
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 10003
      ) {
        // Discord's Unknown Channel response confirms there is nothing to own.
        trackedIds.delete(channelId);
      } else {
        console.error(
          "Temporary voice channel cleanup failed; keeping its ID for a later retry.",
        );
      }
    }
  }

  async function createFor(memberId: string, room: RoomConfig) {
    const stillInTrigger = () =>
      available() &&
      guild.voiceStates.cache.get(memberId)?.channelId ===
        room.triggerChannelId;
    if (!stillInTrigger()) return;
    // Refresh names inside the serialized path, including permanent/orphaned rooms.
    const channels = await guild.channels.fetch();
    if (!stillInTrigger()) return;
    const name = getNextRoomName(
      [...channels.values()].filter((channel) => channel !== null),
      room,
    );
    // Omitting overwrites lets Discord inherit the parent category's permissions.
    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: room.categoryId,
      reason: "Encore temporary voice room",
    });
    trackedIds.add(channel.id);
    let moved = false;
    try {
      if (stillInTrigger()) {
        await guild.voiceStates.cache
          .get(memberId)!
          .setChannel(channel, "Encore temporary voice room");
        moved = true;
      }
    } finally {
      if (!moved) await cleanup(channel.id);
    }
  }

  function handle(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (!available() || newState.guild.id !== config.guildId)
      return Promise.resolve();
    // Snapshot IDs now: discord.js updates cached VoiceState objects in place.
    const oldChannelId = oldState.channelId;
    const memberId = newState.id;
    const room = getRoomForJoin(
      {
        guildId: newState.guild.id,
        oldChannelId,
        newChannelId: newState.channelId,
      },
      config,
    );
    if (!room && (!oldChannelId || !trackedIds.has(oldChannelId)))
      return Promise.resolve();

    queue = queue
      .then(async () => {
        if (!available()) return;
        if (oldChannelId) await cleanup(oldChannelId);
        if (room) await createFor(memberId, room);
      })
      .catch(() => {
        // Do not expose raw API errors, request bodies, or tokens.
        console.error(
          "Temporary voice channel operation failed. Check channel permissions and connectivity.",
        );
      });
    return queue;
  }

  return {
    handle,
    async stop() {
      stopped = true;
      await queue;
    },
  };
}
