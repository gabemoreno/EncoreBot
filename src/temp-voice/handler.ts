import {
  ChannelType,
  PermissionFlagsBits,
  Routes,
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

import {
  ROOM_POLICIES,
  resync,
  createRoomState,
  enter,
  leave,
  closeRoom,
  transferHost,
  resize,
  knock,
  decide,
  cancel,
  type RoomState,
} from "./room-state.js";
import { createReconciler } from "./reconcile.js";

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
          ?.has([
            ...voicePermissions,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.SetVoiceChannelStatus,
          ])
      ) {
        throw new ConfigurationError(
          `The bot needs View Channel, Connect, Move Members, Manage Channels, and Set Voice Channel Status on the ${room.namePrefix} category.`,
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
  const rooms = new Map<
    string,
    { state: RoomState; reconcile: ReturnType<typeof createReconciler> }
  >();
  const trackedIds = () => new Set(rooms.keys());
  const retiring = new Set<Promise<void>>();
  function forget(channelId: string) {
    const room = rooms.get(channelId);
    if (!room) return;
    closeRoom(room.state, true);
    const work = room.reconcile.stop();
    retiring.add(work);
    void work.finally(() => {
      retiring.delete(work);
    });
    rooms.delete(channelId);
  }
  const triggerIds = new Set(config.rooms.map((room) => room.triggerChannelId));
  let queue = Promise.resolve();
  let stopped = false;
  let observationSequence = 0;
  const observations = new Map<
    string,
    { sequence: number; channelId: string | null; oldChannelId: string | null }
  >();
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
        trackedIds(),
        triggerIds,
      )
    )
      return;
    try {
      // Force a REST check for existence, then recheck the current Gateway state.
      const channel = await guild.channels.fetch(channelId, { force: true });
      if (!channel) {
        forget(channelId);
        return;
      }
      if (
        connected() &&
        channel.type === ChannelType.GuildVoice &&
        channel.guild.id === config.guildId &&
        shouldDeleteTempChannel(
          { id: channel.id, memberCount: memberCount(channel.id) },
          trackedIds(),
          triggerIds,
        )
      ) {
        await channel.delete("Encore temporary voice channel is empty");
        forget(channelId);
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 10003
      ) {
        // Discord's Unknown Channel response confirms there is nothing to own.
        forget(channelId);
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
      userLimit: ROOM_POLICIES[room.namePrefix].defaultNormal,
      reason: "Encore temporary voice room",
    });
    const state = createRoomState(
      channel.id,
      memberId,
      ROOM_POLICIES[room.namePrefix],
    );
    const reconcile = createReconciler(
      state,
      {
        status: async (status) => {
          await guild.client.rest.put(Routes.channelVoiceStatus(channel.id), {
            body: { status },
          });
        },
        limit: async (limit) => {
          await channel.setUserLimit(limit, "Encore normal capacity");
        },
        // Deliberately no admission adapter: live overflow is not validated or enabled.
      },
      {
        ready: connected,
        onError: () =>
          console.error(
            "Temporary room reconciliation failed; state retained for retry.",
          ),
      },
    );
    rooms.set(channel.id, { state, reconcile });
    let moved = false;
    try {
      if (stillInTrigger()) {
        await guild.voiceStates.cache
          .get(memberId)!
          .setChannel(channel, "Encore temporary voice room");
        moved = true;
      }
    } finally {
      if (!moved) state.creatorPending = null;
      // The move response itself is not proof of presence. Only Gateway-populated
      // voice state can confirm it; a later event also follows the path below.
      if (
        observations.get(memberId)?.oldChannelId === channel.id &&
        observations.get(memberId)?.channelId !== channel.id
      )
        state.creatorPending = null;
      const occupants = [...guild.voiceStates.cache].filter(
        ([, voice]) => voice.channelId === channel.id,
      );
      occupants.sort(
        (a, b) =>
          (observations.get(a[0])?.sequence ?? 0) -
          (observations.get(b[0])?.sequence ?? 0),
      );
      for (const [id, voice] of occupants) observe(channel.id, id, voice);
      if (stopped) closeRoom(state);
      await reconcile.schedule();
      if (!moved) await cleanup(channel.id);
    }
  }

  function observe(channelId: string, id: string, voice: VoiceState) {
    const room = rooms.get(channelId);
    if (!room) return;
    const member = voice.member;
    // Unknown identity is conservatively ineligible for Host, but still occupies a spot.
    enter(room.state, id, {
      isBot: member?.user.bot !== false,
      displayName: member?.displayName ?? id,
    });
  }

  function handle(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (!available() || newState.guild.id !== config.guildId)
      return Promise.resolve();
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;
    const memberId = newState.id;
    if (oldChannelId !== newChannelId) {
      observations.set(memberId, {
        sequence: ++observationSequence,
        channelId: newChannelId,
        oldChannelId,
      });
    }
    const destination = getRoomForJoin(
      { guildId: newState.guild.id, oldChannelId, newChannelId },
      config,
    );
    const affected = new Set<string>();
    if (oldChannelId && rooms.has(oldChannelId)) {
      affected.add(oldChannelId);
      if (oldChannelId !== newChannelId)
        leave(rooms.get(oldChannelId)!.state, memberId);
    }
    if (newChannelId && rooms.has(newChannelId)) {
      affected.add(newChannelId);
      observe(newChannelId, memberId, newState);
    }
    // Observations invalidate generations immediately, even while REST is in flight.
    const effects = [...affected].map((id) =>
      rooms.get(id)!.reconcile.schedule(),
    );
    if (!destination && !affected.size) return Promise.resolve();
    queue = queue
      .then(async () => {
        if (!available()) return;
        if (oldChannelId) await cleanup(oldChannelId);
        if (destination) await createFor(memberId, destination);
      })
      .catch(() => {
        console.error(
          "Temporary voice channel operation failed. Check channel permissions and connectivity.",
        );
      });
    return Promise.all([queue, ...effects]).then(() => {});
  }

  function active(channelId: string) {
    const room = rooms.get(channelId);
    if (!available() || !room || room.state.closed)
      throw new Error("Room is not active.");
    return room;
  }
  return {
    handle,
    // Snapshots prevent callers from mutating authoritative state.
    inspect(channelId: string) {
      const room = rooms.get(channelId);
      return room ? structuredClone(room.state) : undefined;
    },
    async transfer(
      channelId: string,
      actor: string,
      target: string,
      generation: number,
    ) {
      const room = active(channelId);
      transferHost(room.state, actor, target, generation);
      await room.reconcile.schedule();
    },
    async resize(
      channelId: string,
      actor: string,
      generation: number,
      capacity: number,
    ) {
      const room = active(channelId);
      resize(room.state, actor, generation, capacity);
      await room.reconcile.schedule();
    },
    knock(channelId: string, memberId: string) {
      const room = active(channelId);
      const member = guild.members.cache.get(memberId);
      const channel = guild.channels.cache.get(channelId);
      if (
        !member ||
        member.user.bot ||
        !channel
          ?.permissionsFor(member)
          ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])
      )
        throw new Error("Member is not eligible to knock.");
      return knock(room.state, memberId);
    },
    async decide(
      channelId: string,
      actor: string,
      generation: number,
      memberId: string,
      requestId: number,
      allow: boolean,
    ) {
      const room = active(channelId);
      decide(
        room.state,
        actor,
        generation,
        memberId,
        requestId,
        allow,
        Date.now(),
      );
      await room.reconcile.schedule();
    },
    async cancel(channelId: string, memberId: string, requestId: number) {
      const room = active(channelId);
      cancel(room.state, memberId, requestId);
      await room.reconcile.schedule();
    },
    deleted(channelId: string) {
      forget(channelId);
    },
    async resume() {
      if (!available()) return;
      // A fresh session cannot reconstruct missed join order. Invalidate authority,
      // retain observed order for survivors, and append newly observed members.
      for (const { state, reconcile } of rooms.values()) {
        resync(
          state,
          [...guild.voiceStates.cache]
            .filter(([, voice]) => voice.channelId === state.channelId)
            .map(([id, voice]) => ({
              id,
              isBot: voice.member?.user.bot !== false,
              displayName: voice.member?.displayName ?? id,
            })),
        );
        await reconcile.schedule();
      }
    },
    async stop() {
      stopped = true;
      for (const { state } of rooms.values()) closeRoom(state);
      await queue;
      await Promise.all(
        [...rooms.values()].map(({ state, reconcile }) => {
          closeRoom(state);
          return reconcile.stop();
        }),
      );
      await Promise.all(retiring);
    },
  };
}
