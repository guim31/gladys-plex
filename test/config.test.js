import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, isConfigured } from '../src/config.js';

test('normalizeConfig returns the defaults on an empty config', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig strips trailing slashes from the server URL', () => {
  const config = normalizeConfig({ plex_url: 'http://192.168.1.20:32400//' });
  assert.equal(config.plex_url, 'http://192.168.1.20:32400');
});

test('normalizeConfig trims the URL and the token', () => {
  const config = normalizeConfig({ plex_url: ' http://plex:32400 ', plex_token: ' tok ' });
  assert.equal(config.plex_url, 'http://plex:32400');
  assert.equal(config.plex_token, 'tok');
});

test('normalizeConfig coerces and clamps the numeric fields', () => {
  const config = normalizeConfig({ session_poll_frequency: '3', poll_frequency: '9999' });
  assert.equal(config.session_poll_frequency, 5); // clamped to the minimum
  assert.equal(config.poll_frequency, 3600); // clamped to the maximum
});

test('normalizeConfig falls back on non-numeric values', () => {
  const config = normalizeConfig({ session_poll_frequency: 'abc' });
  assert.equal(config.session_poll_frequency, DEFAULT_CONFIG.session_poll_frequency);
});

test('normalizeConfig handles booleans arriving as strings', () => {
  assert.equal(normalizeConfig({ library_sensors: 'false' }).library_sensors, false);
  assert.equal(normalizeConfig({ library_sensors: true }).library_sensors, true);
  assert.equal(normalizeConfig({ allow_self_signed: 'true' }).allow_self_signed, true);
  assert.equal(normalizeConfig({ allow_self_signed: false }).allow_self_signed, false);
});

test('isConfigured requires both the URL and the token', () => {
  assert.equal(isConfigured(normalizeConfig()), false);
  assert.equal(isConfigured(normalizeConfig({ plex_url: 'http://plex:32400' })), false);
  assert.equal(
    isConfigured(normalizeConfig({ plex_url: 'http://plex:32400', plex_token: 'tok' })),
    true,
  );
});
