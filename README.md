# Encore Bot

A small TypeScript Discord bot for the Encore karaoke and music community.

The bot validates configuration, connects to Discord, logs its identity when
ready, and shuts down on SIGINT or SIGTERM. Joining either configured trigger
creates a temporary voice room and moves the member into it. Empty rooms
created by this process are deleted automatically. Each room tracks a human Host,
shows the Host in its voice-channel status, and has a configured normal capacity.
Admission windows exist as internal state only; live overflow is disabled.
The project includes linting,
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
  Manage Channels, Move Members, Set Voice Channel Status.

No Administrator, Manage Roles, or Speak permission is needed by the current bot.
Set Voice Channel Status is required for Host display; Manage Channels additionally
allows the bot to set status without joining voice. The installed discord.js 14.28.1
uses `client.rest.put(Routes.channelVoiceStatus(id), { body: { status } })`; there
is no high-level `VoiceChannel.setStatus()` helper in this version. New
channels are created directly under the category with no custom overwrites, so
Discord applies the category's permissions. Each trigger may be outside its
destination category, but all four configured channels/categories must belong to
the configured guild. Both triggers must be normal voice channels.

Give community members View Channel, Connect, and Speak where appropriate, but
not Manage Channels. For an exclusively bot-maintained Host display, disable Set
Voice Channel Status for ordinary members in these categories. Status is only
informational; it never grants Host authority. Members cannot name or rename rooms through EncoreBot;
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
    handler.ts       Startup checks, room observations, Discord lifecycle, internal operations
    handler.test.ts  Offline orchestration tests with small Discord stand-ins
    room-state.ts   Pure Host, membership, capacity, request, and window transitions
    room-state.test.ts  State transition tests
    reconcile.ts    Coalesced status/capacity effects and bounded admission adapter contract
    reconcile.test.ts  Deferred REST/race tests with a fake admission adapter
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

One handler keeps a map of active rooms created during this process, covering both
room types. A single promise chain serializes creation and cleanup across both
configurations. Each room has a separate, small reconciler for status and capacity
effects. Membership observations update state immediately; repeated scheduling
coalesces into reconciliation against current state after every awaited write. It fetches current channel names before
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
Shutdown stops queued work, invalidates requests, clears Host status where possible,
and waits for in-flight room effects before destroying the client.

## Host and admission foundation

The creator becomes Host only when observed inside the created room. A successful
move REST response alone is not evidence of presence. Human entry order uses a
monotonic observed sequence. Leaving removes that position, and rejoining appends
a new one. Bots and unknown account identities are ineligible for Host, but count
toward occupancy. The longest-present remaining human succeeds a departing Host.
A bot-only room has no Host and is not empty.

Host identity changes increment a generation and clear pending knocks and unused
approved windows. Stale actions fail even if the same person becomes Host again.
Members already inside stay. Host display is `👑 Host: <display name>` in channel
status; generated names remain unchanged. Status errors never roll back Host state.
Display names refresh on observed voice updates; there is no new privileged member
intent for instant nickname-change tracking.

`createTempVoiceHandler` exposes internal `transfer`, `resize`, `knock`, `decide`,
and requester `cancel` operations. There are no commands/buttons yet. A future
interaction adapter must derive actor/member IDs from the authenticated interaction,
not user input. Host operations check current presence and generation. Knock requires
a cached human with normal View Channel/Connect access; an uncached requester must
be resolved by that future interaction adapter. Transfer targets current humans in
the same room. `inspect` returns a copy, not mutable authoritative state.

`ROOM_POLICIES` in `room-state.ts` centralizes **provisional** values independently
for Stage and Backstage: default 8, presets 4/8/12, maximum overflow 4, admission
window 45 seconds. These are editable product defaults, not finalized choices.
Native `user_limit` starts at normal capacity. All occupants (including bots and
privileged staff) count; occupancy may legitimately exceed normal capacity. Encore
never kicks occupants or changes normal capacity merely because staff bypass a
native limit. Resizing uses presets and does not evict existing occupants.

Allow starts the window immediately; no separate activation interaction is planned.
Any observed entry by that approved member consumes their approval, including entry
through a normal vacancy. Emily taking a normal vacancy does not consume Jacob's
approval. A timer expires unused windows without needing another voice event.

**Live overflow is disabled.** The production handler supplies no `AdmissionAdapter`.
It neither changes Connect overwrites nor raises limits for approvals. An internal
approval currently allows only entry through available normal capacity. The tested
adapter contract is a foundation, not a completed Discord permission implementation.

The fake-adapter tests exercise the intended convergence:

- Close and confirm every ordinary Connect path before installing grants and
  raising the limit. Recompute desired state after each awaited operation.
- With a full room, reserve controlled hard-limit headroom for active approved
  windows. Staff arrivals may increase required headroom within normal + maxOverflow.
  If all approvals cannot fit within that bound, retain their windows but disarm
  overflow; never silently consume another user's approval.
- Retain elevated headroom while still full and safely gated. When normal spots
  become available, revoke special grants, lower the limit to normal, and reopen.
  Burst departures coalesce. Refill within the window can re-arm access.
- Revocation restores the original Connect bit and preserves unrelated permissions.
  This must be implemented by the future Discord adapter, not assumed from cache.
- Track a grant before attempting its REST write because failure can be ambiguous.
  Remove the cleanup obligation only after confirmed revocation (or channel deletion).
  Failure degrades admission enforcement, attempts a normal-limit fallback, and
  prevents further arming. Cleanup retries on later observations, expiry, or shutdown;
  there is no automatic recovery from degraded mode and no background retry loop.

The eventual Discord adapter must validate role/member overwrites and preserve bot
Connect access. An @everyone deny alone is insufficient if role/member allows bypass
it. Manage Roles (called Manage Permissions in channel UI) will be needed for overwrite
editing/deletion, ideally scoped to the destination categories. Do not grant Hosts
moderation permissions or request Administrator. Custom overwrites will also break
category permission synchronization. See the official [permission resolution rules](https://docs.discord.com/developers/topics/permissions#permission-overwrites),
[channel API](https://docs.discord.com/developers/resources/channel#edit-channel-permissions),
and [status endpoint](https://docs.discord.com/developers/resources/channel#set-voice-channel-status).

There is no atomic one-use Connect permission. Entry consumes application state
immediately on observation, but revocation is asynchronous. Rapid rejoin, outages,
failed cleanup, and crashes can leave access usable. A closed gate temporarily
blocks ordinary vacancies until the native limit is reduced and access restored.
Administrators and privileged staff are outside this admission enforcement boundary.
Neither stale UI nor button visibility is authorization.

After a reconnect/resync, invalidate windows and reconcile current voice membership.
Known surviving order is retained; newly discovered occupants append in cache order
because missed historical entry order is unknowable. This does not recover rooms
from a previous process. Failed display/limit effects retry on later room activity
or reconnect. Unexpected manual limit changes are not continuously enforced by this
milestone; the bot tracks its own confirmed writes.

## Before enabling live overflow

Use the private server and a deliberately supported permission layout. The following
checks require a future Discord adapter and a development-only invocation path;
there is no current switch to enable overflow or user-facing approval UI.

1. Verify Host status with Set Voice Channel Status plus Manage Channels while the
   bot is not in voice. Remove status permission after startup: succession must still
   happen, and later status reconciliation must recover after permission is restored.
2. Test creator movement with delayed voice events, three humans joining/leaving,
   a bot-only remainder, rejoining former Hosts, and internal transfer. Confirm names
   never change and former-generation actions fail.
3. Start at 8/8. Allow Jacob for 45 seconds. Confirm ordinary Connect is denied before
   hard limit 9, Jacob can enter, an ordinary Emily cannot take overflow, and Jacob's
   member overwrite is restored after observed entry. Inspect REST ordering and actual
   server access, not just client icons.
4. Repeat with explicit role Connect allows, conflicting roles, member allows/denies,
   and baseline View Channel restrictions. Unsupported layouts must reject activation
   without raising the limit or overriding restrictions. Bot access must survive closure.
5. While Jacob waits, leave to 7/8, then rapidly to 3/8. Confirm normal-limit restoration
   precedes reopening. Let Emily take a normal spot; Jacob stays approved. Let Jacob
   take one instead; his window is consumed. Refill before expiry and confirm safe
   re-arming. Wait past expiry and confirm no grant remains.
6. Test two simultaneous approvals, and staff joining below capacity, at 8/8, and after
   Jacob is armed. At occupancy 9, Jacob should receive hard-limit headroom 10 if within
   policy. At the overflow bound, his window must remain logically valid but no unsafe
   limit increase may occur. Never kick staff or consume Jacob's approval for them.
7. Confirm lowering a native limit below current occupancy preserves connected users.
   Test Speak/video for existing occupants while Connect is denied and after the
   admitted user's temporary allow is removed. This behavior must be verified before
   enabling the proposed gate; do not assume it is harmless.
8. Change Host during each pending permission/limit request, transfer while Allow is
   running, and have Jacob join concurrently. Existing occupants stay; stale decisions
   must not re-arm permissions. Repeat with the same person later regaining Host.
9. Remove Manage Roles mid-grant and mid-revocation; simulate lost responses and
   unavailable REST. Verify cleanup obligations survive, normal-limit fallback is
   attempted, no new overflow arms, and ordinary access never reopens while the limit
   is uncertain/elevated. Restore permissions and trigger a retry.
10. Delete a channel during an operation, stop gracefully during an operation, rapidly
    leave/rejoin after entry, disconnect Gateway, and terminate the process abruptly.
    Inspect surviving permissions manually. Document that a crash cannot guarantee
    expiry/revocation without recovery; manually clean up orphaned rooms.

## Restart limitation

Discord channels survive bot shutdown. After a restart, earlier rooms remain
untracked and will **never** be claimed or deleted based on their names. Their names
still reserve numbers. Host status may remain stale after a crash; native limits
also survive. With a future overflow adapter, temporary grants and closed access
could survive too, since in-memory expiry timers are gone. Clean them up manually
when appropriate. This also applies
to development watch-mode restarts, crashes, or a lost creation response where
Discord created a room but the bot never received its ID. There is no persistence,
restart recovery, or user-facing control panel.

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
