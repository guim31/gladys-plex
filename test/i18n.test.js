// -----------------------------------------------------------------------------
// Translation guard: every text shown to the user exists in the four
// languages of the Gladys interface (en, fr, de, es), is not empty, fits its
// slot, and German uses "du" (Guilhem's decision), never the polite "Sie".
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { LANGUAGES, MESSAGES } from '../src/messages.js';
import {
  TEXTS,
  texts,
  buildNowPlayingContent,
  buildPlayerContent,
  buildLatestContent,
  imageKey,
} from '../src/widgets.js';
import { normalizeSession, normalizeMetadata } from '../src/plex/sessions.js';
import { SESSIONS } from './fixtures/plex.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const EXPECTED = [...LANGUAGES].sort();
const POLITE_GERMAN = /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/;

/**
 * Check one multilingual object.
 * @param {unknown} value
 * @param {string} path
 * @param {number} max - Characters allowed per language.
 */
function checkLocalized(value, path, max) {
  assert.ok(value && typeof value === 'object', `${path} is not a multilingual object`);
  assert.deepEqual(Object.keys(value).sort(), EXPECTED, `${path} must have exactly en, fr, de, es`);
  for (const [language, text] of Object.entries(value)) {
    assert.equal(typeof text, 'string', `${path}.${language} is not a string`);
    assert.ok(text.trim().length > 0, `${path}.${language} is empty`);
    assert.ok(text.length <= max, `${path}.${language} is ${text.length} characters, max ${max}`);
  }
  assert.doesNotMatch(value.de, POLITE_GERMAN, `${path}.de must say "du", not "Sie"`);
}

/** Any object carrying at least one language key is a multilingual object. */
const isLocalized = (node) =>
  node && typeof node === 'object' && !Array.isArray(node) && LANGUAGES.some((l) => l in node);

/** Collect every multilingual object of the manifest, with its path. */
function collect(node, path, found) {
  if (isLocalized(node)) {
    found.push({ path, value: node });
    return found;
  }
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      collect(child, `${path}.${key}`, found);
    }
  }
  return found;
}

/** Length allowed for a manifest text, by the slot it fills. */
function maxLength(path) {
  if (path === 'manifest.description') {
    return 100; // store rule
  }
  if (/^manifest\.widgets\.\d+\.label$/.test(path)) {
    return 30;
  }
  if (path.endsWith('.label')) {
    return 60;
  }
  if (/^manifest\.widgets\.\d+\.description$/.test(path)) {
    return 100;
  }
  return 400;
}

test('every multilingual object of the manifest is in en, fr, de and es', () => {
  const found = collect(manifest, 'manifest', []);
  // Guards against a walker that silently skips everything.
  assert.ok(found.length >= 100, `only ${found.length} multilingual objects found`);
  for (const { path, value } of found) {
    checkLocalized(value, path, maxLength(path));
  }
});

test('every config, widget, action and trigger text field is multilingual', () => {
  // A text field written as a bare string would escape the walker above.
  const TEXT_FIELDS = ['label', 'description', 'placeholder'];
  const visit = (node, path) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (TEXT_FIELDS.includes(key) && path !== 'manifest') {
        assert.ok(isLocalized(child), `${path}.${key} must be a multilingual object`);
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(manifest, 'manifest');
});

test('every action and connection message is in en, fr, de and es', () => {
  const sample = {
    friendlyName: 'Plex Server',
    version: '1.40.0',
    libraries: 4,
    players: 2,
    total: 3,
    error: 'connect ECONNREFUSED',
  };
  assert.ok(Object.keys(MESSAGES).length >= 5);
  for (const [key, message] of Object.entries(MESSAGES)) {
    const value = typeof message === 'function' ? message(sample) : message;
    checkLocalized(value, `MESSAGES.${key}`, 200);
  }
});

test('every widget text is in en, fr, de and es, short enough for its slot', () => {
  assert.deepEqual(Object.keys(TEXTS).sort(), EXPECTED);
  const keys = Object.keys(TEXTS.en);
  for (const language of LANGUAGES) {
    assert.deepEqual(Object.keys(TEXTS[language]).sort(), [...keys].sort(), `TEXTS.${language}`);
  }
  // Buttons and badges stay short: they sit side by side in a narrow widget,
  // and Gladys truncates a badge past 16 characters.
  const SHORT = {
    play: 12,
    pause: 12,
    stop: 12,
    next: 12,
    playing: 16,
    paused: 16,
    transcoding: 16,
    streams: 20,
    on: 5,
  };
  for (const key of keys) {
    const value = Object.fromEntries(LANGUAGES.map((l) => [l, TEXTS[l][key]]));
    checkLocalized(value, `TEXTS.*.${key}`, SHORT[key] ?? 60);
  }
});

test('the widget language follows the request, English otherwise', () => {
  assert.equal(texts('de-DE'), TEXTS.de);
  assert.equal(texts('es'), TEXTS.es);
  assert.equal(texts('FR'), TEXTS.fr);
  assert.equal(texts('it'), TEXTS.en);
  assert.equal(texts('constructor'), TEXTS.en);
});

test('the widgets render valid content in every language', () => {
  const register = (artwork) => imageKey(artwork);
  const sessions = SESSIONS.MediaContainer.Metadata.map(normalizeSession);
  for (const language of LANGUAGES) {
    const contents = [
      buildNowPlayingContent({
        sessions,
        streamsFeature: 'a',
        transcodesFeature: 'b',
        language,
        register,
      }),
      buildNowPlayingContent({
        sessions: [],
        streamsFeature: 'a',
        transcodesFeature: 'b',
        language,
        register,
      }),
      buildPlayerContent({
        session: sessions[0],
        playerName: 'Plex - TV',
        featureOf: (key) => `ext:plex:player:tv:${key}`,
        language,
        register,
      }),
      buildLatestContent({
        items: SESSIONS.MediaContainer.Metadata.map(normalizeMetadata),
        language,
        machineIdentifier: 'server',
        register,
      }),
    ];
    for (const content of contents) {
      assert.deepEqual(validateWidgetContent(content), [], `widget content in ${language}`);
    }
  }
});

test('no bilingual text is written outside the translation tables', async () => {
  // Inline { en, fr } objects or `language === 'fr'` choices would escape the
  // checks above: user-facing texts live in src/messages.js and TEXTS.
  const files = ['index.js'];
  for (const entry of await readdir(new URL('../src/', import.meta.url), { recursive: true })) {
    if (entry.endsWith('.js') && entry !== 'messages.js' && entry !== 'widgets.js') {
      files.push(`src/${entry}`);
    }
  }
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(en|fr|de|es):\s*['"`]/, `${file} has an inline translation`);
    assert.doesNotMatch(source, /===?\s*['"](fr|en|de|es)['"]/, `${file} picks a text by language`);
  }
});
