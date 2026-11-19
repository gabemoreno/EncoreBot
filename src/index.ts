import { Client, Events } from "discord.js";
import { readConfig } from "./config.js";

let client: Client | undefined;
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info("Shutting down Encore.");

  try {
    await client?.destroy();
  } catch {
    console.error("Discord client shutdown failed.");
    process.exitCode = 1;
  } finally {
    // Exit after cleanup, including when a signal interrupts an in-flight login.
    process.exit(process.exitCode ?? 0);
  }
}

try {
  const { token } = readConfig(process.env);
  // Ready is delivered without intents; guild/voice events are not needed yet.
  client = new Client({ intents: [] });

  client.once(Events.ClientReady, (readyClient) => {
    if (!shuttingDown) {
      console.info(
        `Connected as ${readyClient.user.tag} (${readyClient.user.id}).`,
      );
    }
  });

  // Never log raw Discord errors or debug events: they may contain secrets.
  client.on(Events.Error, () => {
    console.error("Discord client error.");
  });
  client.on(Events.ShardError, () => {
    console.error("Discord connection error.");
  });

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  await client.login(token);
} catch {
  if (!shuttingDown) {
    console.error(
      "Unable to start Encore. Check DISCORD_TOKEN and network access.",
    );
    process.exitCode = 1;
    await shutdown();
  }
}
