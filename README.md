# Plex integration for Gladys Assistant

External integration connecting a [Plex Media Server](https://www.plex.tv) to
[Gladys Assistant](https://gladysassistant.com), built on the official
[JavaScript SDK](https://github.com/GladysAssistant/integration-sdk-js) and the
[integration template](https://github.com/GladysAssistant/integration-template-js).
Feature-wise it mirrors the Plex integration of Home Assistant: media player
control, activity monitoring, library statistics and intro/credits markers.

## Features

| Device                | Features                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plex Media Server     | Active streams, transcode sessions, streaming bandwidth (kbps), "now playing" summary, one item counter per library (+ episodes / tracks counters)                 |
| One device per player | Play / Pause / Stop / Previous / Next / Rewind / Forward, volume, mute, playback state (Music widget compatible), now-playing title, remaining time, intro/credits |

Playback states refresh on a fast poll (10 s by default) **and** through the
real-time WebSocket notification stream of the Plex server, so play/pause/stop
land in Gladys within a second. Players are discovered from the server's
client list **and** on the fly when they start streaming.

User documentation (rehosted by Gladys on the Configuration screen):
[English](./docs/en.md) · [Français](./docs/fr.md).

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring (no Plex logic)
├─ src/
│  ├─ monitor.js                     # PlexMonitor: state, polling, publication, commands
│  ├─ config.js                      # config defaults + normalization
│  ├─ plex/
│  │  ├─ api.js                      # Plex Media Server HTTP API client
│  │  ├─ notifications.js            # real-time WebSocket notifications (+ reconnect)
│  │  └─ sessions.js                 # session normalization (pure, unit-tested)
│  └─ devices/
│     ├─ server.js                   # server device (activity + library sensors)
│     └─ player.js                   # player devices (controls + playback sensors)
├─ docs/                             # user documentation (en/fr)
├─ gladys-assistant-integration.json # manifest (name, config schema, image…)
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
└─ test/                             # unit tests (node --test, no framework)
```

## How it talks to Plex

- Every request hits the local REST API of the server with the user's
  `X-Plex-Token` and `Accept: application/json`.
- Player commands (`/player/playback/...`) are **proxied through the server**
  with the `X-Plex-Target-Client-Identifier` header — the NAT-friendly path,
  no direct connection to each player needed.
- Sessions come from `/status/sessions`, libraries from `/library/sections`
  (counts via 0-sized containers), players from `/clients`, intro/credits
  markers from `/library/metadata/<key>?includeMarkers=1` (cached).
- The WebSocket at `/:/websockets/notifications` triggers an immediate
  (debounced) session refresh on every `playing` event; polling remains the
  fallback when the socket cannot connect.

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="plex" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the
integration runs inside its sandboxed container. The SDK reads them
automatically.

## Quality checks

```bash
npm run format:check   # Prettier: is everything formatted?
npm run lint           # ESLint: catch real mistakes
npm test               # Unit tests, via the built-in `node --test` runner
```

The same three checks run on every push and pull request
(see [.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Publish

1. Make sure the repository is public and carries the GitHub topic
   `gladys-assistant-integration` (the decentralized indexer finds the
   integration through that topic).
2. Release from the GitHub UI: **Actions → Release → Run workflow** (patch /
   minor / major). The workflow bumps the version everywhere, pushes the tag
   and builds the multi-arch image to `ghcr.io`.
3. Validate locally anytime with `npx github:GladysAssistant/integration-store .`

## License

Apache-2.0
