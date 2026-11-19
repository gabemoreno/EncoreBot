import { describe, expect, it } from "vitest";
import {
  getNextBackstageName,
  shouldCreateTempChannel,
  shouldDeleteTempChannel,
} from "./logic.js";

describe("getNextBackstageName", () => {
  it.each([
    { names: [], expected: "Backstage 1" },
    { names: ["Backstage 1"], expected: "Backstage 2" },
    { names: ["Backstage 1", "Backstage 2"], expected: "Backstage 3" },
    { names: ["Backstage 1", "Backstage 3"], expected: "Backstage 2" },
    { names: ["Backstage 2", "Backstage 3"], expected: "Backstage 1" },
    {
      names: ["Backstage 3", "Backstage 1", "Backstage 1", "Backstage 2"],
      expected: "Backstage 4",
    },
    { names: ["Lounge", "➕ Join to Create"], expected: "Backstage 1" },
    {
      names: ["Backstage 1", "Backstage 9007199254740993"],
      expected: "Backstage 2",
    },
  ])("chooses $expected for $names", ({ names, expected }) => {
    const channels = names.map((name) => ({ name, parentId: "category" }));

    expect(getNextBackstageName(channels, "category")).toBe(expected);
  });

  it("ignores channels in other categories or without a category", () => {
    const channels = [
      { name: "Backstage 1", parentId: "other-category" },
      { name: "Backstage 1", parentId: null },
      { name: "Backstage 2", parentId: "category" },
    ];

    expect(getNextBackstageName(channels, "category")).toBe("Backstage 1");
  });

  it("only reserves exact application-controlled names", () => {
    const invalidNames = [
      "",
      "Backstage",
      "Backstage 0",
      "Backstage -1",
      "Backstage +1",
      "Backstage 01",
      "Backstage 001",
      "Backstage 1.0",
      "Backstage 1.5",
      "Backstage 1e0",
      "Backstage 1 room",
      "Backstage 1a",
      " Backstage 1",
      "Backstage 1 ",
      "Backstage 1\n",
      "Backstage  1",
      "Backstage\t1",
      "Backstage1",
      "backstage 1",
      "Backstage １",
    ];

    for (const name of invalidNames) {
      expect(
        getNextBackstageName([{ name, parentId: "category" }], "category"),
        `Invalid name: ${JSON.stringify(name)}`,
      ).toBe("Backstage 1");
    }
  });
});

describe("shouldCreateTempChannel", () => {
  const config = { guildId: "encore", joinToCreateChannelId: "trigger" };

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
      shouldCreateTempChannel(
        { guildId: "encore", oldChannelId: old, newChannelId: next },
        config,
      ),
    ).toBe(expected);
  });

  it("ignores another guild even when the trigger ID matches", () => {
    expect(
      shouldCreateTempChannel(
        { guildId: "other-guild", oldChannelId: null, newChannelId: "trigger" },
        config,
      ),
    ).toBe(false);
  });
});

describe("shouldDeleteTempChannel", () => {
  const trackedIds = new Set(["temporary"]);

  it("allows an empty tracked channel", () => {
    expect(
      shouldDeleteTempChannel(
        { id: "temporary", memberCount: 0 },
        trackedIds,
        "trigger",
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
          "trigger",
        ),
      ).toBe(false);
    },
  );

  it.each(["Lounge", "Backstage 1"])(
    "preserves an untracked permanent channel named %s",
    (name) => {
      const channel = { id: "permanent", name, memberCount: 0 };

      expect(shouldDeleteTempChannel(channel, trackedIds, "trigger")).toBe(
        false,
      );
    },
  );

  it("does not treat a channel from an earlier process as owned", () => {
    expect(
      shouldDeleteTempChannel(
        { id: "temporary", memberCount: 0 },
        new Set(),
        "trigger",
      ),
    ).toBe(false);
  });

  it.each([new Set<string>(), new Set(["trigger"])])(
    "protects the trigger even if it is mistakenly tracked (%j)",
    (ids) => {
      const trigger = { id: "trigger", name: "Backstage 1", memberCount: 0 };

      expect(shouldDeleteTempChannel(trigger, ids, "trigger")).toBe(false);
    },
  );
});
