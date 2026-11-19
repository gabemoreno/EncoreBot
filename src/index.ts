import { Client, Events, GatewayIntentBits } from "discord.js";
import { ConfigurationError, readConfig } from "./config.js";
import {
  createTempVoiceHandler,
  validateTempVoiceSetup,
} from "./temp-voice/handler.js";

let client: Client | undefined;
let shuttingDown = false;
let tempVoice: ReturnType<typeof createTempVoiceHandler> | undefined;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info("Shutting down Encore.");

  try {
    await tempVoice?.stop();
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
  const config = readConfig(process.env);
  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  client.once(Events.ClientReady, (readyClient) => {
    async function initialize() {
      const guild = await validateTempVoiceSetup(readyClient, config);
      if (shuttingDown) return;
      tempVoice = createTempVoiceHandler(guild, config);
      readyClient.on(Events.VoiceStateUpdate, (oldState, newState) => {
        void tempVoice?.handle(oldState, newState);
      });
      console.info(
        `Connected as ${readyClient.user.tag} (${readyClient.user.id}).`,
      );
      console.info("Temporary voice rooms are ready.");
    }
    void initialize().catch(async (error: unknown) => {
      if (shuttingDown) return;
      console.error(
        error instanceof ConfigurationError
          ? error.message
          : "Unable to initialize temporary voice rooms.",
      );
      process.exitCode = 1;
      await shutdown();
    });
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

  await client.login(config.token);
} catch (error) {
  if (!shuttingDown) {
    console.error(
      error instanceof ConfigurationError
        ? error.message
        : "Unable to start Encore. Check DISCORD_TOKEN and network access.",
    );
    process.exitCode = 1;
    await shutdown();
  }
}
