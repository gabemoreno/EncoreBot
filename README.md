# Encore Bot

A small TypeScript Discord bot for the Encore karaoke and music community.

This repository currently contains the project foundation: configuration
validation, linting, formatting, unit tests, and a production build. The entry
point validates configuration and exits. It does not connect to Discord, create
channels, or move members.

## Requirements

- Node.js 26.13.0 (recorded in `.nvmrc`)
- pnpm 12.16.1 (recorded in `package.json`)

If you use nvm, run `nvm install` and `nvm use` from this directory.

## Local setup

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm check
```

Set `DISCORD_TOKEN` in your local `.env`, then run:

```sh
pnpm dev
```

Until Discord login is implemented, any nonblank placeholder is sufficient to
exercise startup. No real token is needed for tests, linting, typechecking, or
building. Successful startup currently prints a configuration confirmation;
watch mode waits for source changes and reruns the entry point.

Development will use a private test Discord server with the existing Discord
application. A separate development application can be considered later.

## Configuration and secrets

| Variable        | Purpose                                      |
| --------------- | -------------------------------------------- |
| `DISCORD_TOKEN` | Bot token; required and nonblank at startup. |

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

Guild and channel IDs will be added when the voice feature is implemented. They
will be configured as strings rather than JavaScript numbers.

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
  index.ts           Startup and configuration validation
  config.ts          Small environment validation function
  config.test.ts     Configuration unit tests
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
will be installed with the login milestone, when it is first used.

Commit `pnpm-lock.yaml` alongside dependency changes. Generated output,
dependencies, coverage, local environment files, and AWS credentials are ignored.
Run `pnpm check` and review `git diff` plus untracked files before committing.

## Next milestones

1. Add discord.js, login, ready logging, and clean shutdown.
2. Add pure, tested temporary voice channel decisions.
3. Connect those decisions to Discord events and channel operations.

The planned voice feature uses fixed `Backstage N` names and memory-only tracking
of channels created by the running bot. It will never use a matching name alone
as permission to delete a channel. A restart can leave channels requiring manual
cleanup. No ownership, renaming controls, database, or persistent recovery is
planned for the initial version.
