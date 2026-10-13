# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). Earlier versions (up to 1.2.0) are
described in the [GitHub Releases](https://github.com/guim31/gladys-plex/releases).

## [Unreleased]

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

[Unreleased]: https://github.com/guim31/gladys-plex/compare/v1.2.0...HEAD
