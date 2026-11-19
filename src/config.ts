export function readConfig(env: NodeJS.ProcessEnv) {
  const token = env.DISCORD_TOKEN?.trim();

  if (!token) {
    throw new Error("DISCORD_TOKEN is required and must not be blank.");
  }

  return { token };
}
