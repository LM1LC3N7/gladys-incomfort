# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It reads Intergas boilers through the local
Lan2RF (InComfort) gateway, in plain HTTP.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "setpoint" # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only (src/handlers.js registers the handlers)
src/handlers.js                   every SDK handler, wired to the app (shared with the tests)
src/app.js                        IncomfortApp: lifecycle, reading loop, setpoint command
src/lan2rf/client.js              the gateway's paths, /protect/ + basic auth, setpoint
src/lan2rf/http.js                the only network access (node:http)
src/lan2rf/parse.js               answers -> plain objects (ported from incomfort-client)
src/lan2rf/errors.js              GatewayError, credential refusal
src/budget.js                     the states-per-minute window (300/min limit of Gladys)
src/devices.js                    the Gladys devices and their external ids (pure)
src/config.js                     DEFAULTS (mirror the manifest defaults) + normalization
src/constants.js, src/i18n.js     keys, limits, timings; runtime and device texts (en/fr)
gladys-assistant-integration.json manifest: name, config_schema, actions...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test: SDK fake Gladys, fake gateway, loopback servers
scripts/cover.mjs                 generates cover.png (plain Node)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

Safety rules of this integration (TODO.md, "Decisions"): the room setpoint
is the only command, refused unless `allow_setpoint`, 5 to 30 °C (refused
outside, never clamped); the heater list and the boiler are read again just
before acting, nothing is sent past 3.5 s; never a `switch` feature, never a
hot water command; credentials the gateway refused (401) are never retried
without a user action; logs carry codes, never the text of an answer nor the
credentials.

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Here:
  `heater:<serial>` and `room:<serial>-<1|2>`, the serial the gateway lists.
  Gladys keys devices, their history, scenes and dashboards on them: changing
  one creates a new device and orphans the old one. The same goes for every
  key users store: manifest `config_schema`, `actions`, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume (unused for now). Never log passwords or answers of the
  gateway.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code (defaults, action
  handlers): change both sides together.
- **Units.** Only those the core lists for the category
  (`DEVICE_FEATURE_UNITS_BY_CATEGORY` of `server/utils/constants.js`); units
  and types are fixed when the device is created.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync. Files are
  UTF-8 without BOM (`test/encoding.test.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
