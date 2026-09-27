// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

// Actions registered in index.js.
const REGISTERED_ACTIONS = ['test_connection', 'scan_clients'];

test('every manifest action has a registered handler', () => {
  for (const action of manifest.actions ?? []) {
    assert.ok(
      REGISTERED_ACTIONS.includes(action.key),
      `manifest action "${action.key}" has no handler`,
    );
  }
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  const minVersion = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.\d+/);
  assert.ok(minVersion, 'gladys_version must declare a minimum version');
  const [, major, minor] = minVersion.map(Number);
  assert.ok(
    major > 4 || (major === 4 && minor >= 86),
    `categories requires gladys_version >= 4.86.0, got "${manifest.gladys_version}"`,
  );
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('the required connection fields are declared', () => {
  const byKey = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.equal(byKey.plex_url.type, 'string');
  assert.equal(byKey.plex_url.required, true);
  assert.equal(byKey.plex_token.type, 'secret', 'the token must never be displayed in clear');
  assert.equal(byKey.plex_token.required, true);
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0, 'the form starts with an onboarding section');
  for (const section of sections) {
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(
      section.placeholder,
      undefined,
      `section "${section.key}" must not have a placeholder`,
    );
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(
      !(section.key in DEFAULT_CONFIG),
      `section "${section.key}" stores no value and must not appear in DEFAULT_CONFIG`,
    );
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('the version is consistent across the manifest', () => {
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    'docker_image tag must match the manifest version',
  );
});

test('widgets and scene triggers match what the code registers and fires', async () => {
  const { WIDGET, LATEST_KINDS } = await import('../src/widgets.js');
  const { SCENE_TRIGGER } = await import('../src/scene-events.js');
  const { MEDIA_TYPE } = await import('../src/plex/sessions.js');
  const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

  assert.deepEqual(manifest.widgets.map((w) => w.key).sort(), Object.values(WIDGET).sort());
  for (const key of Object.keys(WIDGET)) {
    assert.ok(indexSource.includes(`onWidgetGet(WIDGET.${key}`), `widget ${key} has no handler`);
  }
  const latest = manifest.widgets.find((w) => w.key === WIDGET.LATEST_MEDIA);
  assert.deepEqual(
    latest.settings[0].options.map((o) => o.value).sort(),
    Object.keys(LATEST_KINDS).sort(),
  );
  for (const widget of manifest.widgets) {
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, `widget label "${text}"`);
    }
    for (const text of Object.values(widget.description ?? {})) {
      assert.ok(text.length <= 100, `widget description "${text}"`);
    }
  }

  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGER).sort(),
  );
  for (const trigger of manifest.scene_triggers) {
    const mediaType = trigger.fields.find((f) => f.key === 'media_type');
    assert.deepEqual(
      mediaType.options.map((o) => o.value).sort(),
      Object.values(MEDIA_TYPE).sort(),
    );
    assert.ok(
      trigger.fields.every((f) => f.required === false),
      'filters are optional',
    );
  }
});

test('widgets and scene declarations need Gladys 5.1', () => {
  // Older cores reject any unknown manifest field: claiming compatibility
  // below 5.1.0 would make the update fail on them.
  assert.match(manifest.gladys_version, />=\s*5\.1\.0/);
});

test('number fields use whole min and default values', () => {
  // Gladys renders them as <input type="number" min max> WITHOUT step: the
  // browser then only accepts min + k.
  for (const field of manifest.config_schema.filter((f) => f.type === 'number')) {
    for (const bound of ['min', 'max', 'default']) {
      if (field[bound] !== undefined) {
        assert.ok(Number.isInteger(field[bound]), `${field.key}.${bound} must be an integer`);
      }
    }
  }
});
