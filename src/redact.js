// -----------------------------------------------------------------------------
// Mask a secret (the Plex token) in a text that is about to be logged.
// -----------------------------------------------------------------------------

/**
 * @param {unknown} message
 * @param {string|undefined} secret - Masked raw and URL-encoded.
 * @returns {string}
 */
export function redactSecret(message, secret) {
  const text = String(message ?? '');
  if (!secret) {
    return text;
  }
  return text.split(secret).join('***').split(encodeURIComponent(secret)).join('***');
}
