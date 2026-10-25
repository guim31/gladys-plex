# Plex integration for Gladys Assistant

External integration connecting a [Plex Media Server](https://www.plex.tv) to
[Gladys Assistant](https://gladysassistant.com), built on the official
[JavaScript SDK](https://github.com/GladysAssistant/integration-sdk-js) and the
[integration template](https://github.com/GladysAssistant/integration-template-js).
Feature-wise it mirrors the Plex integration of Home Assistant: media player
control, activity monitoring, library statistics and intro/credits markers.

## Features

| Device                | Features                                                                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plex Media Server     | Active streams, transcode sessions, streaming bandwidth (kbps), "now playing" summary, one item counter per library (+ episodes / tracks counters)                                                                                                                    |
| One device per player | Gladys 5.3 music player: playback state (writable: pause / play / stop), title, artist, album, artwork, duration, position (writable: seek), volume, mute; Play / Pause / Stop / Previous / Next / Rewind / Forward, now-playing title, remaining time, intro/credits |
| Music panel           | Browse and search the music libraries (artists, albums, audio playlists), play now / next / at the end, the player's play queue with jump — also the `music.play-media` scene action of Gladys 5.3                                                                    |
| Scene triggers        | `playback_started`, `playback_paused`, `playback_resumed`, `playback_stopped` — filtered by player and media type (movie, episode, music, live TV…)                                                                                                                   |
| Dashboard widgets     | `now_playing` (who watches what, where, with the posters), `player` (the current playback — or one chosen player — as a remote: fan art or cover, title, state, remaining time, buttons), `latest_media` (poster grid of the latest movies, seasons or albums)        |

Playback states refresh on a fast poll (10 s by default) **and** through the
real-time WebSocket notification stream of the Plex server, so play/pause/stop
land in Gladys within a second. Players are discovered from the server's
client list **and** on the fly when they start streaming.

**Gladys 5.3 music player** (version 1.3, Gladys ≥ 5.3): each player feeds the
Music box of the dashboard through the SDK's `publishNowPlaying` (one batch of
changes, the position as a sample, never streamed) and answers the music panel
(manifest `"music": { "browse", "search", "queue", "append" }`). Players added
before 1.3 get the new features with **Update** in the Discover tab; their
feature ids are kept. Checked against a real Plex Media Server 1.43 (library,
play queues, notifications, transcoder) with a simulated companion player: a
real Plex app could not be driven on the test bench, feedback welcome.

User documentation (rehosted by Gladys on the Configuration screen):
[English](./docs/en.md) · [Français](./docs/fr.md).

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring (no Plex logic)
├─ src/
│  ├─ monitor.js                     # PlexMonitor: state, polling, publication, commands
│  ├─ catalog.js                     # Gladys 5.3 music panel: browse, search, play, queue, artwork
│  ├─ music.js                       # SDK music handlers -> catalog
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

- Scene triggers compare each session snapshot with the previous one (one
  event per transition, the first snapshot after a connection is only a
  baseline); refreshes are serialized so a poll and a notification-driven
  refresh never fire the same event twice.
- **Music player (Gladys 5.3)**: playing from the panel creates a server play
  queue (`POST /playQueues`) and hands it to the player with the companion
  command `playMedia` (server address, `containerKey`, a transient token when
  the server gives one) — what the Plex apps and python-plexapi do. "Next" and
  "at the end" add to the player's current queue (`PUT /playQueues/<id>`) then
  send `refreshPlayQueue`; the queue panel pages `/playQueues/<id>` (the server
  follows the item the player reports) and jumps with `skipTo`. The id of a
  player's queue is not in `/status/sessions`: it comes with the `playing`
  notifications. Shuffle and repeat are not published: the server does not
  report them. A player answers its commands in XML: only the status counts.
- Widget images go through the server's photo transcoder
  (`/photo/:/transcode?url=<thumb|art>&width&height`): posters in a 300×450
  box, fan art in 800×450, shrunk again if a result exceeds the 300 KB the
  core accepts. Image keys derive from the Plex image path, whose trailing
  timestamp changes with the artwork. Music artworks ask the transcoder for
  `format=jpeg` (without it, a PNG cover comes back as a heavy PNG).

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
