# Plex for Gladys Assistant

Connect your [Plex Media Server](https://www.plex.tv) to Gladys Assistant:
control your Plex players from Gladys, and use what is playing in your
automations (dim the lights when a movie starts, bring them back up when the
credits roll...).

## What you get

**One "server" device** with monitoring sensors:

- **Active streams** — how many sessions are playing right now;
- **Transcode sessions** — how many of them the server is transcoding;
- **Streaming bandwidth** — total streaming bandwidth, in kbps;
- **Now playing** — a one-line summary of who watches what;
- **One item counter per library** (can be disabled): movies, TV shows
  (plus an episode counter), music artists (plus a track counter)...

**One device per Plex player** (TV app, mobile app, Chromecast... any player
your server can control):

- Playback controls: **Play, Pause, Stop, Previous, Next, Rewind, Forward**;
- **Volume** (0–100) and **Mute**;
- **Playback state** (playing or not) — compatible with the **Music** dashboard
  widget of Gladys;
- **Now playing** — the formatted title of the current media
  (`Show S01E02 - Episode`, `Artist - Track`, `Movie (year)`);
- **Remaining time**, in minutes;
- **In intro** and **In credits** — binary sensors that turn on while the
  playhead is inside the intro or the end credits of the current episode/movie
  (uses the markers detected by your Plex server). Perfect automation triggers.

Playback states update every few seconds (configurable), and the integration
also listens to the real-time notification stream of your server, so a play,
pause or stop is reflected in Gladys within a second.

## Configuration

1. Find the **URL of your Plex Media Server**, usually
   `http://<ip-of-the-server>:32400`. Use the local address whenever Gladys and
   Plex share the same network.
2. Find your **Plex token (X-Plex-Token)**: open the Plex web app, play any
   media, click **Get Info → View XML**, and copy the `X-Plex-Token` value at
   the end of the URL. See the official article linked in the configuration
   screen for the detailed walkthrough.
3. Fill both fields in the **Configuration** tab of the integration and save.
4. Use the **Test the Plex connection** button: it reports the server name,
   its version and how many libraries and players were found.
5. Open the **Discovery** tab: the server device and your players are waiting
   to be added.

If your server only answers over `https` with a Plex-issued or self-signed
certificate, either use the `http` local address (recommended) or enable
**Accept self-signed certificate**.

### Options

- **Playback refresh interval** — how often the active sessions are polled
  (10 s by default). Real-time notifications make the usual case faster; this
  is the fallback pace.
- **Library refresh interval** — how often the library counters are refreshed
  (5 min by default).
- **Library sensors** — disable it if you do not want one counter feature per
  library on the server device.

## Players discovery

Players show up automatically:

- players registered to the server (the `/clients` list) are found at startup
  and by the **Scan for Plex players** button;
- any player that **starts streaming** is discovered on the fly and published
  to the Discovery tab, even if it is not remotely controllable.

Note: not every Plex client accepts remote control. Players must advertise
themselves to your server (most TV and desktop apps do; some mobile apps ask
for the "Advertise as player" setting to be enabled).

## Automation ideas

- When **In credits** turns on in the living room → raise the lights;
- When **Playback state** turns on after 10 pm → dim the lights to 20 %;
- When **Active streams** goes above 3 → send a notification (bandwidth!);
- One button on the dashboard to **Pause** every player at dinner time.

## Troubleshooting

The integration logs everything it does: check the integration logs from the
Gladys UI (or `docker logs` on the host) with `LOG_LEVEL=debug` for the full
detail.

- **"Plex authentication failed"** — the token is wrong or expired. Fetch a
  fresh X-Plex-Token and update the configuration.
- **"Plex server unreachable"** — check the URL (scheme, IP, port 32400) and
  that Gladys can reach the server's network.
- **A player does not react to commands** — the player must be reachable by
  the **server** (commands are proxied through it). Players discovered only
  while streaming (phones especially) are often not controllable: enable
  "Advertise as player" in that Plex app, then run **Scan for Plex players**
  again. On a non-controllable player, commands report a clear error —
  except **Stop**, which interrupts the playback server-side (session
  termination).
- **Intro/credits sensors never turn on** — your Plex server must have the
  intro/credits detection enabled (Settings → Library) and the markers only
  exist for analyzed items.
