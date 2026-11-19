/** Choose the first unused exact name in the target category. */
export function getNextBackstageName(
  channels: readonly { name: string; parentId: string | null }[],
  categoryId: string,
): string {
  const existingNames = new Set(
    channels
      .filter((channel) => channel.parentId === categoryId)
      .map((channel) => channel.name),
  );

  // Exact comparisons deliberately ignore malformed names and leading zeros.
  let number = 1;
  while (existingNames.has(`Backstage ${number}`)) number += 1;

  return `Backstage ${number}`;
}

export function shouldCreateTempChannel(
  transition: {
    guildId: string;
    oldChannelId: string | null;
    newChannelId: string | null;
  },
  config: { guildId: string; joinToCreateChannelId: string },
): boolean {
  return (
    transition.guildId === config.guildId &&
    transition.newChannelId === config.joinToCreateChannelId &&
    transition.oldChannelId !== transition.newChannelId
  );
}

/** The caller supplies IDs tracked by this process, never inferred from names. */
export function shouldDeleteTempChannel(
  channel: { id: string; memberCount: number },
  trackedChannelIds: ReadonlySet<string>,
  joinToCreateChannelId: string,
): boolean {
  return (
    channel.id !== joinToCreateChannelId &&
    trackedChannelIds.has(channel.id) &&
    channel.memberCount === 0
  );
}
