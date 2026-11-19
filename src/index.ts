import { readConfig } from "./config.js";

try {
  readConfig(process.env);
  console.info(
    "Configuration validated. Discord login is not implemented yet.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Startup failed.");
  process.exitCode = 1;
}
