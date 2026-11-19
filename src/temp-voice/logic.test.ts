import { describe, expect, it } from "vitest";
import {
  getNextRoomName,
  getRoomForJoin,
  shouldDeleteTempChannel,
  type RoomConfig,
} from "./logic.js";

const rooms: readonly RoomConfig[] = [
  {
    triggerChannelId: "trigger",
    categoryId: "hangout",
    namePrefix: "Backstage",
  },
  {
    triggerChannelId: "perform",
    categoryId: "performing",
    namePrefix: "Stage",
  },
];
const triggerIds = new Set(rooms.map((room) => room.triggerChannelId));

describe.each(rooms)("getNextRoomName ($namePrefix)", (room) => {
  it.each([
    { numbers: [], next: 1 },
    { numbers: [1], next: 2 },
    { numbers: [1, 2], next: 3 },
    { numbers: [1, 3], next: 2 },
    { numbers: [2, 3], next: 1 },
    { numbers: [3, 1, 1, 2], next: 4 },
  ])("chooses $next from $numbers", ({ numbers, next }) => {
    const channels = numbers.map((number) => ({
      name: `${room.namePrefix} ${number}`,
      parentId: room.categoryId,
    }));
    expect(getNextRoomName(channels, room)).toBe(`${room.namePrefix} ${next}`);
  });

  it("ignores unrelated names and channels outside the category", () => {
    const channels = [
      { name: `${room.namePrefix} 1`, parentId: "other-category" },
      { name: `${room.namePrefix} 1`, parentId: null },
      { name: "Lounge", parentId: room.categoryId },
      { name: "➕ Join to Create", parentId: room.categoryId },
    ];
    expect(getNextRoomName(channels, room)).toBe(`${room.namePrefix} 1`);
  });

  it("only reserves exact generated names", () => {
    const prefix = room.namePrefix;
    const invalidNames = [
      "",
      prefix,
      `${prefix} 0`,
      `${prefix} -1`,
      `${prefix} +1`,
      `${prefix} 01`,
      `${prefix} 001`,
      `${prefix} 1.0`,
      `${prefix} 1.5`,
      `${prefix} 1e0`,
      `${prefix} 1 room`,
      `${prefix} 1a`,
      ` ${prefix} 1`,
      `${prefix} 1 `,
      `${prefix} 1\n`,
      `${prefix}  1`,
      `${prefix}\t1`,
      `${prefix}1`,
      `${prefix.toLowerCase()} 1`,
      `${prefix} １`,
    ];
    for (const name of invalidNames) {
      expect(
        getNextRoomName([{ name, parentId: room.categoryId }], room),
        `Invalid name: ${JSON.stringify(name)}`,
      ).toBe(`${prefix} 1`);
    }
  });

  it("does not parse large numbers into unsafe JavaScript integers", () => {
    expect(
      getNextRoomName(
        [
          { name: `${room.namePrefix} 1`, parentId: room.categoryId },
          {
            name: `${room.namePrefix} 9007199254740993`,
            parentId: room.categoryId,
          },
        ],
        room,
      ),
    ).toBe(`${room.namePrefix} 2`);
  });
});

it("numbers each category and prefix independently", () => {
  const channels = [
    { name: "Backstage 1", parentId: "hangout" },
    { name: "Stage 1", parentId: "performing" },
    { name: "Stage 2", parentId: "performing" },
    { name: "Stage 1", parentId: "hangout" },
  ];
  expect(getNextRoomName(channels, rooms[0]!)).toBe("Backstage 2");
  expect(getNextRoomName(channels, rooms[1]!)).toBe("Stage 3");
  expect(
    getNextRoomName(channels, { ...rooms[1]!, categoryId: "hangout" }),
  ).toBe("Stage 2");
});

describe("getRoomForJoin", () => {
  const config = { guildId: "encore", rooms };

  it.each([
    {
      label: "join from no channel",
      old: null,
      next: "trigger",
      expected: true,
    },
    {
      label: "move into trigger",
      old: "lounge",
      next: "trigger",
      expected: true,
    },
    {
      label: "join another channel",
      old: null,
      next: "lounge",
      expected: false,
    },
    {
      label: "move between other channels",
      old: "lounge",
      next: "other",
      expected: false,
    },
    { label: "leave trigger", old: "trigger", next: "lounge", expected: false },
    {
      label: "disconnect from trigger",
      old: "trigger",
      next: null,
      expected: false,
    },
    {
      label: "disconnect from another channel",
      old: "lounge",
      next: null,
      expected: false,
    },
    {
      label: "mute/deafen in trigger",
      old: "trigger",
      next: "trigger",
      expected: false,
    },
    {
      label: "unchanged unrelated channel",
      old: "lounge",
      next: "lounge",
      expected: false,
    },
    {
      label: "update while disconnected",
      old: null,
      next: null,
      expected: false,
    },
  ])("handles $label", ({ old, next, expected }) => {
    expect(
      getRoomForJoin(
        { guildId: "encore", oldChannelId: old, newChannelId: next },
        config,
      ),
    ).toBe(expected ? rooms[0] : undefined);
  });

  it("ignores another guild even when the trigger ID matches", () => {
    expect(
      getRoomForJoin(
        { guildId: "other-guild", oldChannelId: null, newChannelId: "trigger" },
        config,
      ),
    ).toBeUndefined();
  });

  it("selects Stage when moving from the Backstage trigger to the Stage trigger", () => {
    expect(
      getRoomForJoin(
        { guildId: "encore", oldChannelId: "trigger", newChannelId: "perform" },
        config,
      ),
    ).toBe(rooms[1]);
  });

  it("ignores unchanged Stage state and Stage joins in another guild", () => {
    expect(
      getRoomForJoin(
        { guildId: "encore", oldChannelId: "perform", newChannelId: "perform" },
        config,
      ),
    ).toBeUndefined();
    expect(
      getRoomForJoin(
        { guildId: "other", oldChannelId: null, newChannelId: "perform" },
        config,
      ),
    ).toBeUndefined();
  });
});

describe("shouldDeleteTempChannel", () => {
  const trackedIds = new Set(["temporary"]);

  it("allows an empty tracked channel", () => {
    expect(
      shouldDeleteTempChannel(
        { id: "temporary", memberCount: 0 },
        trackedIds,
        triggerIds,
      ),
    ).toBe(true);
  });

  it.each([1, 3, -1, 0.5, NaN, Infinity])(
    "rejects a tracked channel with a nonzero or invalid member count (%s)",
    (memberCount) => {
      expect(
        shouldDeleteTempChannel(
          { id: "temporary", memberCount },
          trackedIds,
          triggerIds,
        ),
      ).toBe(false);
    },
  );

  it.each(["Lounge", "Backstage 1", "Stage 1"])(
    "preserves an untracked permanent channel named %s",
    (name) => {
      const channel = { id: "permanent", name, memberCount: 0 };

      expect(shouldDeleteTempChannel(channel, trackedIds, triggerIds)).toBe(
        false,
      );
    },
  );

  it("does not treat a channel from an earlier process as owned", () => {
    expect(
      shouldDeleteTempChannel(
        { id: "temporary", memberCount: 0 },
        new Set(),
        triggerIds,
      ),
    ).toBe(false);
  });

  it.each(rooms)(
    "protects the $namePrefix trigger even if mistakenly tracked",
    (room) => {
      const channel = {
        id: room.triggerChannelId,
        name: `${room.namePrefix} 1`,
        memberCount: 0,
      };
      for (const tracked of [new Set<string>(), new Set(triggerIds)]) {
        expect(shouldDeleteTempChannel(channel, tracked, triggerIds)).toBe(
          false,
        );
      }
    },
  );
});
