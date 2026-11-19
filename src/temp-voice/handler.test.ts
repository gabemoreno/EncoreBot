import {
  ChannelType,
  Collection,
  PermissionFlagsBits,
  PermissionsBitField,
  type Client,
  type Guild,
  type VoiceState,
} from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomConfig } from "./logic.js";
import { createTempVoiceHandler, validateTempVoiceSetup } from "./handler.js";

const config = {
  guildId: "guild",
  rooms: [
    {
      triggerChannelId: "trigger",
      categoryId: "category",
      namePrefix: "Backstage",
    },
    {
      triggerChannelId: "perform",
      categoryId: "performing",
      namePrefix: "Stage",
    },
  ] satisfies RoomConfig[],
};

// Small in-memory stand-ins for the Discord methods used by the handler.
// No client is logged in; casts are confined to the API boundary below.
function setup() {
  const permission = new PermissionsBitField([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.MoveMembers,
    PermissionFlagsBits.SetVoiceChannelStatus,
  ]);
  function channel(id: string, name: string, type = ChannelType.GuildVoice) {
    return {
      id,
      name,
      type,
      parentId: "category",
      guild: { id: "guild" },
      permissionsFor: vi.fn(() => permission),
      setUserLimit: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => {
        channels.delete(id);
        return Promise.resolve();
      }),
    };
  }
  const channels = new Collection<string, ReturnType<typeof channel>>();
  for (const room of config.rooms) {
    const trigger = channel(
      room.triggerChannelId,
      `Join to ${room.namePrefix}`,
    );
    trigger.parentId = room.categoryId;
    channels.set(trigger.id, trigger);
    channels.set(
      room.categoryId,
      channel(room.categoryId, room.namePrefix, ChannelType.GuildCategory),
    );
  }
  function member(id: string, channelId: string | null) {
    const state = {
      channelId,
      member: { user: { bot: false }, displayName: id },
      setChannel: vi.fn((destination: { id: string }) => {
        state.channelId = destination.id;
        return Promise.resolve();
      }),
    };
    states.set(id, state);
    return state;
  }
  const states = new Collection<string, ReturnType<typeof member>>();
  let nextId = 0;
  const create = vi.fn(
    (options: { name: string; parent: string; type: ChannelType }) => {
      const room = channel(`room-${++nextId}`, options.name, options.type);
      room.parentId = options.parent;
      channels.set(room.id, room);
      return Promise.resolve(room);
    },
  );
  const fetch = vi.fn((id?: string) =>
    Promise.resolve(id ? (channels.get(id) ?? null) : channels.clone()),
  );
  const guild = {
    id: "guild",
    available: true,
    client: {
      isReady: () => true,
      rest: { put: vi.fn(() => Promise.resolve()) },
    },
    channels: { fetch, create },
    voiceStates: { cache: states },
    members: { fetchMe: vi.fn(() => Promise.resolve({ id: "bot" })) },
  };
  const asGuild = guild as unknown as Guild;
  const handler = createTempVoiceHandler(asGuild, config);
  function transition(
    id: string,
    oldChannelId: string | null,
    newChannelId: string | null,
    guildId = "guild",
  ) {
    const state = states.get(id) ?? member(id, newChannelId);
    state.channelId = newChannelId;
    return handler.handle(
      { id, channelId: oldChannelId, guild: { id: guildId } } as VoiceState,
      {
        id,
        channelId: newChannelId,
        guild: { id: guildId },
        member: state.member,
      } as unknown as VoiceState,
    );
  }
  const client = {
    guilds: { fetch: vi.fn(() => Promise.resolve(asGuild)) },
  } as unknown as Client;
  return {
    guild,
    asGuild,
    client,
    handler,
    transition,
    channels,
    states,
    member,
    channel,
    create,
    fetch,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("temporary voice lifecycle", () => {
  it.each(config.rooms)(
    "creates, tracks, moves, and cleans up $namePrefix",
    async (setting) => {
      const f = setup();
      await f.transition("alice", null, setting.triggerChannelId);
      const room = f.channels.get("room-1")!;
      expect(f.create).toHaveBeenCalledWith({
        name: `${setting.namePrefix} 1`,
        type: ChannelType.GuildVoice,
        parent: setting.categoryId,
        userLimit: 8,
        reason: "Encore temporary voice room",
      });
      expect(f.states.get("alice")!.setChannel).toHaveBeenCalledWith(
        room,
        "Encore temporary voice room",
      );
      f.member("bob", room.id);
      await f.transition("alice", room.id, null);
      expect(room.delete).not.toHaveBeenCalled();
      await f.transition("bob", room.id, null);
      expect(room.delete).toHaveBeenCalledOnce();
      const fetchCalls = f.fetch.mock.calls.length;
      await f.transition("bob", room.id, null);
      expect(f.fetch).toHaveBeenCalledTimes(fetchCalls);
    },
  );

  it("ignores unrelated, unchanged, and other-guild events, including an empty trigger", async () => {
    const f = setup();
    await f.transition("a", null, "lounge");
    await f.transition("a", "trigger", "trigger");
    await f.transition("a", null, "trigger", "other-guild");
    await f.transition("a", "trigger", null);
    await f.transition("a", "perform", null);
    expect(f.channels.get("perform")!.delete).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.channels.get("trigger")!.delete).not.toHaveBeenCalled();
  });

  it.each(config.rooms)(
    "reserves permanent $namePrefix names without claiming channels",
    async (setting) => {
      const f = setup();
      const permanent = f.channel("permanent", `${setting.namePrefix} 1`);
      permanent.parentId = setting.categoryId;
      f.channels.set(permanent.id, permanent);
      await f.transition("a", permanent.id, setting.triggerChannelId);
      expect(f.create.mock.calls[0]?.[0].name).toBe(`${setting.namePrefix} 2`);
      expect(permanent.delete).not.toHaveBeenCalled();
    },
  );

  it("serializes concurrent joins so names cannot collide", async () => {
    const f = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = f.create.getMockImplementation()!;
    f.create.mockImplementationOnce(async (options) => {
      await gate;
      return original(options);
    });
    const first = f.transition("a", null, "trigger");
    await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
    const second = f.transition("b", null, "trigger");
    expect(f.create).toHaveBeenCalledOnce();
    release();
    await Promise.all([first, second]);
    expect(f.create.mock.calls.map(([options]) => options.name)).toEqual([
      "Backstage 1",
      "Backstage 2",
    ]);
  });

  it("does not create for a member who leaves while waiting in the queue", async () => {
    const f = setup();
    const pending = f.transition("a", null, "trigger");
    f.states.get("a")!.channelId = null;
    await pending;
    expect(f.create).not.toHaveBeenCalled();
  });

  it("serializes mixed joins while keeping each room type's numbering independent", async () => {
    const f = setup();
    await Promise.all([
      f.transition("a", null, "trigger"),
      f.transition("b", null, "perform"),
      f.transition("c", null, "trigger"),
      f.transition("d", null, "perform"),
    ]);
    expect(
      f.create.mock.calls.map(([options]) => [options.name, options.parent]),
    ).toEqual([
      ["Backstage 1", "category"],
      ["Stage 1", "performing"],
      ["Backstage 2", "category"],
      ["Stage 2", "performing"],
    ]);
  });

  it("cleans up an abandoned Backstage creation before routing the member to Stage", async () => {
    const f = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = f.create.getMockImplementation()!;
    f.create.mockImplementationOnce(async (options) => {
      await gate;
      return original(options);
    });
    const backstage = f.transition("a", null, "trigger");
    await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
    const stage = f.transition("a", "trigger", "perform");
    release();
    await Promise.all([backstage, stage]);
    expect(f.channels.has("room-1")).toBe(false);
    expect(f.channels.get("room-2")?.name).toBe("Stage 1");
    expect(f.states.get("a")!.setChannel).toHaveBeenCalledOnce();
    expect(f.states.get("a")!.channelId).toBe("room-2");
  });

  it.each(["leave", "move failure"])(
    "cleans up a new empty channel after %s",
    async (failure) => {
      const f = setup();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const state = f.member("a", "trigger");
      if (failure === "move failure")
        state.setChannel.mockRejectedValueOnce(new Error("secret"));
      else {
        const original = f.create.getMockImplementation()!;
        f.create.mockImplementationOnce(async (options) => {
          const room = await original(options);
          state.channelId = null;
          return room;
        });
      }
      await f.transition("a", null, "trigger");
      expect(f.channels.has("room-1")).toBe(false);
      const calls = f.fetch.mock.calls.length;
      await f.transition("a", "room-1", null);
      expect(f.fetch).toHaveBeenCalledTimes(calls);
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    },
  );

  it("preserves a room occupied by someone else when the move fails", async () => {
    const f = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    f.member("a", "trigger").setChannel.mockImplementationOnce((room) => {
      f.member("b", room.id);
      return Promise.reject(new Error("move failed"));
    });
    await f.transition("a", null, "trigger");
    const room = f.channels.get("room-1")!;
    expect(room.delete).not.toHaveBeenCalled();
    await f.transition("b", room.id, null);
    expect(room.delete).toHaveBeenCalledOnce();
  });

  it("recovers the queue after creation failure", async () => {
    const f = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    f.create.mockRejectedValueOnce(new Error("secret"));
    await f.transition("a", null, "trigger");
    await f.transition("b", null, "trigger");
    expect(f.channels.get("room-1")?.name).toBe("Backstage 1");
    expect(f.states.get("a")!.setChannel).not.toHaveBeenCalled();
  });

  it("retains ownership after deletion fails and retries on a later departure", async () => {
    const f = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await f.transition("a", null, "trigger");
    const room = f.channels.get("room-1")!;
    room.delete.mockRejectedValueOnce(new Error("missing permissions"));
    await f.transition("a", room.id, null);
    await f.transition("b", null, room.id);
    await f.transition("b", room.id, null);
    expect(room.delete).toHaveBeenCalledTimes(2);
  });

  it("forgets a channel that Discord confirms no longer exists", async () => {
    const f = setup();
    await f.transition("a", null, "trigger");
    f.fetch.mockRejectedValueOnce({ code: 10003 });
    await f.transition("a", "room-1", null);
    const calls = f.fetch.mock.calls.length;
    await f.transition("a", "room-1", null);
    expect(f.fetch).toHaveBeenCalledTimes(calls);
    expect(f.channels.get("room-1")!.delete).not.toHaveBeenCalled();
  });

  it("rechecks occupancy after fetching the channel", async () => {
    const f = setup();
    await f.transition("a", null, "trigger");
    const room = f.channels.get("room-1")!;
    f.fetch.mockImplementationOnce(() => {
      f.member("b", room.id);
      return Promise.resolve(room);
    });
    await f.transition("a", room.id, null);
    expect(room.delete).not.toHaveBeenCalled();
  });

  it("stops queued creation on shutdown", async () => {
    const f = setup();
    const pending = f.transition("a", null, "trigger");
    await f.handler.stop();
    await pending;
    expect(f.create).not.toHaveBeenCalled();
  });

  it("cleans up a room created while shutdown was requested", async () => {
    const f = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = f.create.getMockImplementation()!;
    f.create.mockImplementationOnce(async (options) => {
      await gate;
      return original(options);
    });
    const pending = f.transition("a", null, "trigger");
    await vi.waitFor(() => expect(f.create).toHaveBeenCalledOnce());
    const stopped = f.handler.stop();
    release();
    await Promise.all([pending, stopped]);
    expect(f.channels.has("room-1")).toBe(false);
    expect(f.states.get("a")!.setChannel).not.toHaveBeenCalled();
  });

  it("keeps a failed-move room tracked if its cleanup also fails", async () => {
    const f = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    f.member("a", "trigger").setChannel.mockImplementationOnce((room) => {
      f.channels
        .get(room.id)!
        .delete.mockRejectedValueOnce(new Error("missing permission"));
      return Promise.reject(new Error("move failed"));
    });
    await f.transition("a", null, "trigger");
    const room = f.channels.get("room-1")!;
    await f.transition("b", null, room.id);
    await f.transition("b", room.id, null);
    expect(room.delete).toHaveBeenCalledTimes(2);
    expect(f.channels.has(room.id)).toBe(false);
  });

  it("does not use voice-state occupancy while the guild is unavailable", async () => {
    const f = setup();
    await f.transition("a", null, "trigger");
    const room = f.channels.get("room-1")!;
    f.guild.available = false;
    await f.transition("a", room.id, null);
    expect(room.delete).not.toHaveBeenCalled();
  });
});

describe("startup validation", () => {
  it("accepts the configured guild, types, and planned permissions", async () => {
    const f = setup();
    // The trigger need not be in the destination category.
    f.channels.get("trigger")!.parentId = "other-category";
    await expect(validateTempVoiceSetup(f.client, config)).resolves.toBe(
      f.asGuild,
    );
  });

  it.each(["trigger", "category", "perform", "performing"])(
    "rejects an inaccessible or wrong-type %s",
    async (id) => {
      const f = setup();
      f.channels.get(id)!.type = ChannelType.GuildText;
      await expect(validateTempVoiceSetup(f.client, config)).rejects.toThrow(
        "must identify",
      );
      f.channels.delete(id);
      await expect(validateTempVoiceSetup(f.client, config)).rejects.toThrow(
        "must identify",
      );
    },
  );

  it.each(["trigger", "category", "perform", "performing"])(
    "rejects missing permissions on %s",
    async (id) => {
      const f = setup();
      f.channels
        .get(id)!
        .permissionsFor.mockReturnValue(new PermissionsBitField());
      await expect(validateTempVoiceSetup(f.client, config)).rejects.toThrow(
        "The bot needs",
      );
    },
  );

  it("reports inaccessible guilds without revealing API error details", async () => {
    const f = setup();
    vi.spyOn(f.client.guilds, "fetch").mockRejectedValue(
      new Error("secret-token"),
    );
    await expect(validateTempVoiceSetup(f.client, config)).rejects.toThrow(
      /^Unable to validate DISCORD_GUILD_ID and its channels\. Check bot membership, permissions, and network access\.$/,
    );
  });

  it("rejects channels that belong to another guild", async () => {
    const f = setup();
    f.channels.get("trigger")!.guild.id = "other-guild";
    await expect(validateTempVoiceSetup(f.client, config)).rejects.toThrow(
      "Backstage trigger must identify",
    );
  });
});

describe("Host integration", () => {
  it("waits for observed creator presence instead of trusting the move response", async () => {
    const f = setup();
    f.member("alice", "trigger").setChannel.mockResolvedValueOnce(undefined);
    await f.transition("alice", null, "trigger");
    expect(f.handler.inspect("room-1")?.hostId).toBeNull();
    await f.transition("alice", "trigger", "room-1");
    expect(f.handler.inspect("room-1")?.hostId).toBe("alice");
    expect(f.guild.client.rest.put).toHaveBeenLastCalledWith(
      "/channels/room-1/voice-status",
      { body: { status: "👑 alice" } },
    );
    await f.handler.stop();
  });
  it("tracks ordinary arrivals, transfers authority, and leaves names stable", async () => {
    const f = setup();
    await f.transition("alice", null, "trigger");
    await f.transition("bob", null, "room-1");
    const generation = f.handler.inspect("room-1")!.generation;
    await f.handler.transfer("room-1", "alice", "bob", generation);
    await expect(
      f.handler.resize("room-1", "alice", generation, 4),
    ).rejects.toThrow();
    await f.handler.resize("room-1", "bob", generation + 1, 4);
    expect(f.channels.get("room-1")?.setUserLimit).toHaveBeenCalledWith(
      4,
      "Encore normal capacity",
    );
    expect(f.channels.get("room-1")?.name).toBe("Backstage 1");
    await f.transition("bob", "room-1", null);
    expect(f.handler.inspect("room-1")?.hostId).toBe("alice");
    const snapshot = f.handler.inspect("room-1")!;
    snapshot.members.clear();
    expect(f.handler.inspect("room-1")?.members.size).toBe(1);
    await f.handler.stop();
    expect(f.guild.client.rest.put).toHaveBeenLastCalledWith(
      "/channels/room-1/voice-status",
      { body: { status: null } },
    );
  });
  it("tombstones an externally deleted room during a status write", async () => {
    const f = setup();
    let release!: () => void;
    f.guild.client.rest.put.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const creation = f.transition("alice", null, "trigger");
    await vi.waitFor(() =>
      expect(f.guild.client.rest.put).toHaveBeenCalledOnce(),
    );
    f.handler.deleted("room-1");
    release();
    await creation;
    expect(f.handler.inspect("room-1")).toBeUndefined();
    await expect(
      f.handler.transfer("room-1", "alice", "bob", 1),
    ).rejects.toThrow();
    await f.handler.stop();
  });
  it("updates Host immediately while the previous status REST call is pending", async () => {
    const f = setup();
    await f.transition("alice", null, "trigger");
    await f.transition("bob", null, "room-1");
    await f.transition("carol", null, "room-1");
    let release!: () => void;
    f.guild.client.rest.put.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = f.transition("alice", "room-1", null);
    await vi.waitFor(() =>
      expect(f.guild.client.rest.put).toHaveBeenCalledTimes(2),
    );
    const second = f.transition("bob", "room-1", null);
    expect(f.handler.inspect("room-1")?.hostId).toBe("carol");
    release();
    await Promise.all([first, second]);
    expect(f.guild.client.rest.put).toHaveBeenLastCalledWith(
      "/channels/room-1/voice-status",
      { body: { status: "👑 carol" } },
    );
    await f.handler.stop();
  });
});

it("shutdown drains a deleted room's in-flight status effect", async () => {
  const f = setup();
  await f.transition("alice", null, "trigger");
  await f.transition("bob", null, "room-1");
  let release!: () => void;
  f.guild.client.rest.put.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const transfer = f.handler.transfer("room-1", "alice", "bob", 1);
  await vi.waitFor(() =>
    expect(f.guild.client.rest.put).toHaveBeenCalledTimes(2),
  );
  f.handler.deleted("room-1");
  let drained = false;
  const stop = f.handler.stop().then(() => {
    drained = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(drained).toBe(false);
  release();
  await Promise.all([stop, transfer]);
  expect(drained).toBe(true);
});
