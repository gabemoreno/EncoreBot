/** Room names are fixed by application code, never by a Discord member. */
export type RoomConfig = {
  readonly triggerChannelId: string;
  readonly categoryId: string;
  readonly namePrefix: "Backstage" | "Stage";
};

/** Choose the first unused exact name in the target category. */
export function getNextRoomName(
  channels: readonly { name: string; parentId: string | null }[],
  room: Pick<RoomConfig, "categoryId" | "namePrefix">,
): string {
  const existingNames = new Set(
    channels
      .filter((channel) => channel.parentId === room.categoryId)
      .map((channel) => channel.name),
  );

  // Exact comparisons deliberately ignore malformed names and leading zeros.
  let number = 1;
  while (existingNames.has(`${room.namePrefix} ${number}`)) number += 1;

  return `${room.namePrefix} ${number}`;
}

export function getRoomForJoin(
  transition: {
    guildId: string;
    oldChannelId: string | null;
    newChannelId: string | null;
  },
  config: { guildId: string; rooms: readonly RoomConfig[] },
): RoomConfig | undefined {
  if (
    transition.guildId !== config.guildId ||
    transition.oldChannelId === transition.newChannelId
  )
    return undefined;
  return config.rooms.find(
    (room) => room.triggerChannelId === transition.newChannelId,
  );
}

/** The caller supplies IDs tracked by this process, never inferred from names. */
export function shouldDeleteTempChannel(
  channel: { id: string; memberCount: number },
  trackedChannelIds: ReadonlySet<string>,
  triggerChannelIds: ReadonlySet<string>,
): boolean {
  return (
    !triggerChannelIds.has(channel.id) &&
    trackedChannelIds.has(channel.id) &&
    channel.memberCount === 0
  );
}
