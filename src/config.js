// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined` or badly-typed values.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest.
export const DEFAULT_CONFIG = {
  plex_url: '',
  plex_token: '',
  session_poll_frequency: 10, // seconds, how often playback sessions are refreshed
  poll_frequency: 300, // seconds, how often library statistics are refreshed
  library_sensors: true,
  allow_self_signed: false,
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const plexUrl = String(raw.plex_url ?? DEFAULT_CONFIG.plex_url)
    .trim()
    // The Plex API paths all start with '/': a trailing slash would produce '//'.
    .replace(/\/+$/, '');
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    plex_url: plexUrl,
    plex_token: String(raw.plex_token ?? DEFAULT_CONFIG.plex_token).trim(),
    session_poll_frequency: clampNumber(
      raw.session_poll_frequency,
      DEFAULT_CONFIG.session_poll_frequency,
      5,
      120,
    ),
    poll_frequency: clampNumber(raw.poll_frequency, DEFAULT_CONFIG.poll_frequency, 60, 3600),
    // Booleans may arrive as strings from a form.
    library_sensors: raw.library_sensors !== false && raw.library_sensors !== 'false',
    allow_self_signed: raw.allow_self_signed === true || raw.allow_self_signed === 'true',
  };
}

/**
 * True when the config carries enough information to reach a Plex server.
 * @param {ReturnType<typeof normalizeConfig>} config
 */
export function isConfigured(config) {
  return config.plex_url.length > 0 && config.plex_token.length > 0;
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}
