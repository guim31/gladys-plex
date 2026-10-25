# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). Earlier versions (up to 1.2.0) are
described in the [GitHub Releases](https://github.com/guim31/gladys-plex/releases).

## [Unreleased]

### Added

- **Music player of Gladys 5.3**: each Plex player now shows in the new Music
  box of the dashboard with the artwork, the title, the artist and the album of
  what it plays (for an episode: the episode, the show and the season; for a
  movie: its title), a progress bar you can drag to seek, play / pause, the
  volume and mute. New features on the player device: title, artist, album,
  artwork, duration and position (writable: a seek).
- **Music panel of the box**: browse the music libraries (artists, albums,
  audio playlists), search them, and play a track, an album, an artist or a
  playlist on the player — now, next, or at the end of its queue; see the play
  queue of the player and jump to one of its tracks. The same picker serves the
  new scene action of Gladys "Play music on a speaker".
- Artworks resized by the Plex server, as JPEG, and served by the integration.
- New option "Language of the music panel" (folders and messages, French by
  default).

### Changed

- **Requires Gladys 5.3.0.** Players added before this version get the new
  features with **Update** in the Discover tab; every existing feature keeps
  its identifier, so scenes and dashboards keep working.
- The playback state is now writable (0 pause, 1 play, 2 stop) and reports
  **2 when nothing plays** (it reported 0): a scene "playback state = 0" no
  longer fires on a stop — use 2, or the "Playback stopped" trigger. It reports
  3 while the player is buffering.
- Mute becomes a music mute (after **Update**): an on/off switch that sets the
  wanted state, instead of a push button that toggled it.
- The "Now playing" text feature stays next to the new title, artist and album.
- Integration SDK 0.16.

### Fixed

- A player answering its commands in XML (what a Plex player does) no longer
  turns a command it executed into an error on the direct route.

## [1.2.2] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.2.1] - 2026-10-13

### Changed

- Quieter logs: the info level now only keeps the lifecycle (start-up,
  connection to the Plex server, new players, one line per command). Scene
  events and the notification socket reconnections move to debug, and a Plex
  server that stops answering is logged once, then once when it is back,
  instead of once per refresh.
- Integration SDK 0.15 and updated dependencies.

### Fixed

- A notification socket that keeps opening and closing no longer resets its
  reconnection delay on every attempt, and the Plex token is masked in its
  error messages.
- A player that starts streaming for the first time is offered in the Discovery
  tab right away (and again on the next refresh if Gladys was busy), instead of
  waiting for a manual scan.
- A Plex server that is unreachable when the integration starts (Plex booting
  after Gladys, for example) is retried in the background, every 30 s then up
  to every 5 min, instead of staying disconnected until the configuration is
  saved again.
- Credentials written in the server address (`user:password@`) are no longer
  quoted in the "unreachable" error.

[Unreleased]: https://github.com/guim31/gladys-plex/compare/v1.2.2...HEAD
[1.2.2]: https://github.com/guim31/gladys-plex/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/guim31/gladys-plex/compare/v1.2.0...v1.2.1
