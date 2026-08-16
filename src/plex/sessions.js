// -----------------------------------------------------------------------------
// Session normalization helpers (pure functions, unit-tested).
//
// The /status/sessions payload is rich but irregular (movies, episodes, music
// tracks and live TV all shape their fields differently). Everything the
// devices need is normalized here once, so the device modules stay simple.
// -----------------------------------------------------------------------------

/**
 * Normalize one raw session entry from /status/sessions.
 * @param {object} raw - Raw session metadata.
 * @returns {object|null} Normalized session, or null when no player is attached.
 */
export function normalizeSession(raw) {
  const player = raw.Player;
  if (!player?.machineIdentifier) {
    return null;
  }
  return {
    machineIdentifier: player.machineIdentifier,
    playerName: player.title || player.product || player.machineIdentifier,
    playerProduct: player.product || '',
    state: player.state || 'stopped', // 'playing' | 'paused' | 'buffering'
    // What the client accepts from a remote controller, e.g.
    // "timeline,playback,navigation,mirror,playqueues". This — NOT the legacy
    // /clients list, empty on most modern servers — is what tells us whether
    // playback commands can be proxied to this player.
    protocolCapabilities: String(player.protocolCapabilities ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
    user: raw.User?.title || '',
    mediaType: raw.type || 'video', // 'movie' | 'episode' | 'track' | 'clip' | ...
    ratingKey: raw.ratingKey,
    title: buildNowPlayingTitle(raw),
    viewOffset: Number(raw.viewOffset ?? 0),
    duration: Number(raw.duration ?? 0),
    transcoding: raw.TranscodeSession !== undefined,
    bandwidth: Number(raw.Session?.bandwidth ?? 0), // kbps
    // Server-side session id, needed to terminate the stream of a player
    // that is not remotely controllable.
    sessionId: raw.Session?.id,
    // LAN address of the player. When the server refuses to relay a command
    // (its /clients list is empty), we talk to the player directly on this
    // address — the route Plex controllers use for casting.
    address: player.address || '',
    local: player.local === '1' || player.local === 1 || player.local === true,
  };
}

/**
 * Human-readable "now playing" label for one session.
 * @param {object} raw - Raw session metadata.
 * @returns {string}
 */
export function buildNowPlayingTitle(raw) {
  if (raw.type === 'episode') {
    const season = raw.parentIndex !== undefined ? `S${pad(raw.parentIndex)}` : '';
    const episode = raw.index !== undefined ? `E${pad(raw.index)}` : '';
    const number = season || episode ? ` ${season}${episode}` : '';
    return `${raw.grandparentTitle ?? ''}${number} - ${raw.title ?? ''}`.trim();
  }
  if (raw.type === 'track') {
    const artist = raw.grandparentTitle ? `${raw.grandparentTitle} - ` : '';
    return `${artist}${raw.title ?? ''}`.trim();
  }
  const year = raw.year ? ` (${raw.year})` : '';
  return `${raw.title ?? ''}${year}`.trim();
}

/**
 * Media type family of a session, used as the `type` parameter of player
 * commands (some players route the command per controller type).
 * @param {string} mediaType - Normalized session media type.
 * @returns {'video'|'music'|'photo'}
 */
export function commandTypeForMedia(mediaType) {
  if (mediaType === 'track') {
    return 'music';
  }
  if (mediaType === 'photo') {
    return 'photo';
  }
  return 'video';
}

/**
 * Whether an address belongs to a private / local network. Used to decide if
 * the direct command route is worth trying: a session streamed from outside
 * the home reports a PUBLIC address, and knocking on port 32500 of a random
 * WAN IP would only waste the command's time budget.
 * @param {string} address
 * @returns {boolean}
 */
export function isPrivateAddress(address) {
  if (!address) {
    return false;
  }
  if (/^(10\.|192\.168\.|127\.|169\.254\.)/.test(address)) {
    return true;
  }
  const octets172 = address.match(/^172\.(\d{1,3})\./);
  if (octets172) {
    const second = Number(octets172[1]);
    return second >= 16 && second <= 31;
  }
  // IPv6 link-local / unique-local, and plain localhost.
  return /^(fe80:|f[cd])/i.test(address) || address === '::1' || address === 'localhost';
}

/**
 * Whether a session's player accepts remotely proxied playback commands.
 * Plex advertises this per session through `protocolCapabilities`; the
 * `playback` controller is the one carrying play/pause/stop/seek/volume.
 * @param {{ protocolCapabilities?: Array<string> }} session
 * @returns {boolean}
 */
export function acceptsPlaybackCommands(session) {
  return (session?.protocolCapabilities ?? []).includes('playback');
}

/**
 * Whether the playhead currently sits inside a marker of the given type.
 * @param {Array<{ type: string, startTimeOffset: number, endTimeOffset: number }>} markers
 * @param {string} markerType - 'intro' | 'credits'
 * @param {number} viewOffset - Playhead position, in ms.
 * @returns {boolean}
 */
export function isInMarker(markers, markerType, viewOffset) {
  return markers.some(
    (m) => m.type === markerType && viewOffset >= m.startTimeOffset && viewOffset < m.endTimeOffset,
  );
}

/**
 * Remaining playback time of a session, in whole minutes (rounded up).
 * @param {{ viewOffset: number, duration: number }} session
 * @returns {number}
 */
export function remainingMinutes(session) {
  const remainingMs = Math.max(0, session.duration - session.viewOffset);
  return Math.ceil(remainingMs / 60_000);
}

/**
 * One-line summary of every active session, shown on the server device
 * ("user: title | user: title").
 * @param {Array<ReturnType<typeof normalizeSession>>} sessions
 * @returns {string}
 */
export function buildActivitySummary(sessions) {
  if (sessions.length === 0) {
    return '';
  }
  return sessions
    .map((s) => {
      const state = s.state === 'paused' ? ' (pause)' : '';
      return s.user ? `${s.user}: ${s.title}${state}` : `${s.title}${state}`;
    })
    .join(' | ');
}

function pad(value) {
  return String(value).padStart(2, '0');
}
