# Encore Bot

A small TypeScript Discord bot for the Encore karaoke and music community.

The bot validates configuration, connects to Discord, logs its identity when
ready, and shuts down on SIGINT or SIGTERM. Joining either configured trigger
creates a temporary voice room and moves the member into it. Empty rooms
created by this process are deleted automatically. The project includes linting,
formatting, unit tests, and a production build.

| Use        | Permanent trigger    | Destination                | Generated names                 |
| ---------- | -------------------- | -------------------------- | ------------------------------- |
| Hangout    | `➕ Join to Create`  | Backstage/Hangout category | `Backstage 1`, `Backstage 2`, … |
| Performing | `➕ Join to Perform` | Performing category        | `Stage 1`, `Stage 2`, …         |

Both use the same lifecycle. Stage rooms are ordinary Discord voice channels,
not Discord Stage channels, and have no karaoke queue or special controls.

## Requirements

- Node.js 26.13.0 (recorded in `.nvmrc`)
- pnpm 12.16.1 (recorded in `package.json`)

If you use nvm, run `nvm install` and `nvm use` from this directory.

## Local setup

```sh
pnpm install --frozen-lockfile
cp -n .env.example .env
pnpm check
```

Set `DISCORD_TOKEN` and the five Discord IDs below in your local `.env`, then run:

```sh
pnpm dev
```

The copy command preserves an existing `.env`. A valid bot token is required to
connect. Successful startup prints `Connected as <bot tag> (<bot ID>).` and the
bot reports `Temporary voice rooms are ready.` after validating the configured guild,
channel types, and bot permissions for both configurations. Watch mode restarts it after source changes.
Each restart loses temporary-channel tracking. Press Ctrl+C
to stop it; both SIGINT and SIGTERM destroy the Discord client before exiting.

No real token is needed for tests, linting, typechecking, or building. Startup
tests run in child processes with missing or blank tokens and do not load `.env`
or connect to Discord.

Development will use a private test Discord server with the existing Discord
application. A separate development application can be considered later.

Install the existing application into that server as a bot if it is not already
there. The client uses only `Guilds` and `GuildVoiceStates` Gateway intents. Keep
Message Content, Server Members, and Presence privileged intents disabled in the
Developer Portal. No command registration or audio connection is needed.

Grant the bot these effective permissions, accounting for channel/category
overwrites:

- Each trigger voice channel: View Channel, Connect, Move Members.
- Each destination category and its voice channels: View Channel, Connect,
  Manage Channels, Move Members.

No Administrator, Manage Roles, or Speak permission is needed by the bot. New
channels are created directly under the category with no custom overwrites, so
Discord applies the category's permissions. Each trigger may be outside its
destination category, but all four configured channels/categories must belong to
the configured guild. Both triggers must be normal voice channels.

Give community members View Channel, Connect, and Speak where appropriate, but
not Manage Channels. Members cannot name or rename rooms through EncoreBot;
Discord administrators still retain their administrative powers. Ensure the bot
can see all existing channels in both destination categories to avoid name collisions
with channels hidden from it.

If startup fails, the process exits with code 1 and asks you to check
`DISCORD_TOKEN` and network access, or reports a specific configuration/permission
problem without printing values. Confirm that the token belongs to your bot and
has not been reset, and that Discord is reachable. Error messages deliberately
omit raw Discord errors, request details, and stack traces to protect the token.
Client/connection error events also produce fixed messages; discord.js handles
ordinary connection recovery. Shutdown errors exit with code 1; normal signal
shutdown exits with code 0.

## Configuration and secrets

| Variable                       | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `DISCORD_TOKEN`                | Bot token; required and nonblank at startup.  |
| `DISCORD_GUILD_ID`             | Server hosting both temporary-room systems.   |
| `BACKSTAGE_TRIGGER_CHANNEL_ID` | Permanent `➕ Join to Create` voice channel.  |
| `BACKSTAGE_CATEGORY_ID`        | Destination Backstage/Hangout category.       |
| `STAGE_TRIGGER_CHANNEL_ID`     | Permanent `➕ Join to Perform` voice channel. |
| `STAGE_CATEGORY_ID`            | Destination Performing category.              |

Node loads `.env` for the development command. Values already set in the shell
take precedence. Restart the development process after changing `.env`.

`src/config.ts` validates an explicitly supplied environment object. It does not
read files, connect to Discord, or validate configuration when imported. Startup
passes `process.env`; unit tests pass ordinary objects. Validation checks that
the token is nonblank, not whether Discord will accept it.

Keep the real token in `.env` or your host's secret/environment settings. Never
commit it, paste it into documentation, or log it. `.env.example` contains only
configuration keys and is safe to commit. If a token is exposed, rotate it in
the Discord Developer Portal; ignoring the file does not erase Git history.

IDs remain strings and must contain 17–20 decimal digits, with no leading zero,
within the unsigned 64-bit range. Surrounding whitespace is trimmed. This checks
format; startup additionally checks accessibility, channel types, guild membership,
and the bot's effective permissions before registering the voice handler.

Enable **User Settings → Advanced → Developer Mode** in Discord. Right-click the
server and choose **Copy Server ID**; right-click each trigger voice channel and
destination category and choose **Copy Channel ID**. Paste these values into the
corresponding `.env` entries. IDs are configuration, not authentication secrets.
The existing `.env` is not updated by copying the example with `cp -n`; add new
keys manually when upgrading. Replace the previous `JOIN_TO_CREATE_CHANNEL_ID`
and `TEMP_VOICE_CATEGORY_ID` keys with `BACKSTAGE_TRIGGER_CHANNEL_ID` and
`BACKSTAGE_CATEGORY_ID`, then add the two Stage IDs. The old keys are no longer read.

`readConfig` builds a read-only list of `{ triggerChannelId, categoryId, namePrefix }`
objects. Prefixes are fixed in code as `Backstage` and `Stage`; they are not read
from environment variables or Discord input. The two trigger IDs must be distinct.
The intended setup uses separate categories, although sharing a destination
category is valid: numbering is scoped to the category **and** prefix. Startup
validates both configurations in one loop and reports which room type failed;
if either is invalid, neither handler route is activated.

## Commands

| Command             | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `pnpm dev`          | Run TypeScript in watch mode with local `.env` values.           |
| `pnpm format`       | Apply Prettier formatting.                                       |
| `pnpm format:check` | Check formatting without changing files.                         |
| `pnpm lint`         | Run ESLint, including checks for unhandled promises.             |
| `pnpm lint:fix`     | Apply automatic lint fixes.                                      |
| `pnpm typecheck`    | Typecheck application code and tests without emitting files.     |
| `pnpm test`         | Run all unit tests once.                                         |
| `pnpm test:watch`   | Rerun tests while editing.                                       |
| `pnpm clean`        | Remove generated `dist/` output.                                 |
| `pnpm build`        | Clean and compile the application into `dist/`, excluding tests. |
| `pnpm check`        | Check formatting, lint, types, tests, and build.                 |
| `pnpm start`        | Run the compiled entry point with source maps.                   |

`pnpm start` expects configuration from the environment; it does not load `.env`.
To check the compiled program locally after building, use:

```sh
node --env-file=.env --enable-source-maps dist/index.js
```

## Project layout

```text
src/
  index.ts           Discord login, ready logging, and shutdown
  index.test.ts      Offline startup failure checks
  config.ts          Small environment validation function
  config.test.ts     Configuration unit tests
  temp-voice/
    logic.ts         Pure naming, creation, and deletion rules
    logic.test.ts    Offline tests for temporary voice channel decisions
    handler.ts       Startup checks and serialized Discord operations
    handler.test.ts  Offline orchestration tests with small Discord stand-ins
eslint.config.mjs    ESLint and TypeScript rules
tsconfig.json       Shared settings and typechecking
tsconfig.build.json Application build settings
```

The project uses ES modules and strict TypeScript. Relative imports use `.js`
extensions so compiled files run directly in Node. ESLint handles code quality;
Prettier defaults handle formatting. Vitest discovers colocated `*.test.ts`
files using its default Node environment and needs no configuration file yet.
Tests import Vitest helpers explicitly. Typechecking is a separate check.

TypeScript is constrained to the 6.0 release line because the installed
typescript-eslint version supports TypeScript versions below 6.1. Revisit that
constraint when upgrading the linter.

`pnpm-workspace.yaml` records permission for esbuild's install script, needed by
the `tsx` development tool. It is package-manager configuration for this single
project; no additional packages or monorepo structure are involved. discord.js
is the only direct runtime dependency.

Commit `pnpm-lock.yaml` alongside dependency changes. Generated output,
dependencies, coverage, local environment files, and AWS credentials are ignored.
Run `pnpm check` and review `git diff` plus untracked files before committing.

## Temporary voice channel rules

The rules in `src/temp-voice/logic.ts` accept plain values and do not import
discord.js or read runtime configuration. `handler.ts` applies them to voice-state
updates in the configured guild.

- Naming chooses the lowest unused positive number for the configured prefix
  (`Backstage N` or `Stage N`) in its category. Only exact names reserve a number: casing, spacing, and decimal
  digits must match. Names such as `Backstage 01` or `Backstage 1.0` are ignored.
  Duplicate names reserve a number once; other categories do not affect it.
  Any exact matching channel name in the category reserves its number, even
  when that channel is permanent or untracked.
- Creation requires the configured guild and an actual transition from a
  different channel (or no channel) into one of the configured triggers. It returns the matching room configuration; other updates
  do nothing.
- Deletion requires an ID tracked by the current process and exactly zero
  members. Names never establish ownership. Both triggers are explicitly protected,
  even if either ID is accidentally included in the tracked set.

## Lifecycle and failure behavior

One handler keeps a single set of IDs created during this process, covering both
room types. A single promise chain serializes creation and cleanup across both
configurations. It fetches current channel names before
each creation, uses the lowest available number, tracks the new ID, rechecks that
the member is still in the selected trigger, and moves them. A slow operation for
one room type temporarily delays the other; sharing the queue keeps moves between
room types and cleanup simple. Run only one EncoreBot process
for this guild: the queue does not coordinate multiple bot processes or human
administrators creating channels at the same time.

On departure, it checks ownership and live voice-state occupancy, fetches the
channel to confirm it exists, rechecks occupancy, and then deletes it if eligible.
Occupancy comes from Gateway voice states, without fetching the server's member
list. Like any Discord client, this relies on received events; the API does not
provide an atomic "delete only if empty" operation, so a last-instant join can race
the deletion request.

If a member leaves before being moved, or the move fails, the handler attempts to
delete the newly created room only if it is empty. Occupied rooms remain tracked.
Successful deletion or Discord's Unknown Channel response removes the ID. A
failed cleanup retains it so a later departure/update for that channel can retry;
there is no background retry timer. If nobody revisits the channel, manual cleanup
may be needed. Failures use fixed safe log messages and do not break the queue.
Shutdown stops queued work and waits for in-flight work before destroying the client.

## Restart limitation

Discord channels survive bot shutdown. After a restart, earlier rooms remain
untracked and will **never** be claimed or deleted based on their names. Their names
still reserve numbers. Clean them up manually when appropriate. This also applies
to development watch-mode restarts, crashes, or a lost creation response where
Discord created a room but the bot never received its ID. There is no persistence,
restart recovery, channel ownership, or user-facing control panel.

## Manual test in the private test server

These steps create and delete test rooms; run them yourself after setting the IDs.

1. Configure both triggers/categories and the permissions above, fill in `.env`,
   and run `pnpm dev`. Wait for `Temporary voice rooms are ready.`
2. Join `➕ Join to Create`. Confirm you move into `Backstage 1` (or the lowest
   available number) under the Backstage category. Join `➕ Join to Perform` and
   confirm a `Stage 1` room appears under Performing. Check category-synced
   permissions on both room types.
3. For each type, have another member join the room normally. Leave one at a time:
   the room should remain occupied, then disappear when the last member leaves.
4. Have two members enter the same trigger nearly simultaneously, then try both
   triggers concurrently. Confirm unique names within each type and independent
   numbering across types. Empty a lower-numbered room and confirm its gap is reused.
5. Join unrelated channels, toggle mute/deafen, and disconnect. Confirm those
   updates do not create rooms. Confirm both permanent triggers survive.
6. Create permanent test channels named `Backstage N` and `Stage N`; confirm they
   are not deleted when empty and their numbers are skipped in their respective
   categories. Restart with a room of each type present and confirm those old
   rooms remain untracked.
7. In this private test setup, briefly remove Move Members after startup and enter
   a trigger. Confirm the failed move is logged and its empty new room is cleaned
   up. Restore the permission. Test missing permissions on either configuration
   at startup: startup should fail clearly, with no voice handler registered.
8. Restore permissions and manually remove leftover test rooms. Run `pnpm check`
   and review the changes before committing.

Automated tests use plain data for the rules and small in-memory Discord stand-ins
for orchestration. They do not load `.env`, log in, or modify real channels.
