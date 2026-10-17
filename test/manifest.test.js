// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEVICE_FEATURE_UNITS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import { ACTIONS } from '../src/constants.js';
import { buildHeaterDevice, buildRoomDevice } from '../src/devices.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const handlers = read('src/handlers.js');
const dockerfile = read('Dockerfile');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* texts(item, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

const keys = (list) => (list ?? []).map((item) => item.key);
const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));

test('the store basics; version 0.1.0 set by hand everywhere', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/);
  assert.equal(pkg.version, '0.1.0');
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-incomfort:${manifest.version}`);
  assert.equal(pkg.name, 'gladys-incomfort');
  assert.equal(lock.name, 'gladys-incomfort');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['climate']);
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(fields.intro.description.en, /Unofficial integration, not affiliated/);
  assert.match(fields.intro.description.fr, /non officielle, sans lien/);
  assert.match(read('docs/en.md'), /never been tested on a real gateway/i);
  assert.match(read('docs/fr.md'), /jamais été testée sur une vraie passerelle/i);
});

test('the license and the notices ship in the image; no person named in LICENSE', () => {
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/, 'the standard text');
  assert.match(read('THIRD_PARTY_NOTICES.md'), /incomfort-client[\s\S]*MIT License/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /Home Assistant[\s\S]*Apache License/);
  assert.match(dockerfile, /COPY[^\n]*LICENSE[^\n]*THIRD_PARTY_NOTICES\.md/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code; the setpoint off by default', () => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.deepEqual(keys(manifest.config_schema), [
    'intro',
    'host',
    'credentials_section',
    'username',
    'password',
    'options_section',
    'allow_setpoint',
    'language',
  ]);
  assert.equal(fields.password.type, 'secret');
  assert.match(fields.password.description.en, /never shown again, sent only to the gateway/);
  assert.match(
    fields.password.description.fr,
    /jamais réaffiché, envoyé seulement à la passerelle/,
  );
  assert.match(fields.credentials_section.description.en, /in clear/, 'the risk of http is said');
  assert.match(fields.credentials_section.description.fr, /en clair/);
  assert.doesNotMatch(JSON.stringify(manifest), /chiffré|encrypted/i, 'a secret is not encrypted');
  assert.equal(fields.allow_setpoint.type, 'boolean');
  assert.equal(fields.allow_setpoint.default, false);
  assert.match(fields.options_section.description.en, /Hot water is never commanded/);
});

test('sections store nothing', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, section.key);
    assert.equal(section.default, undefined, section.key);
    assert.ok(!(section.key in DEFAULTS), section.key);
    for (const link of section.links ?? []) assert.match(link.url, /^https:\/\//);
  }
});

test('the keys of the manifest are the keys of the code, all registered', () => {
  assert.deepEqual(keys(manifest.actions).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), name);
  }
  assert.ok(manifest.actions.every((a) => a.timeout_seconds >= 5 && a.timeout_seconds <= 120));
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.widgets, undefined);
  for (const handler of ['onScanRequest(', 'onSetValue(', 'onConfigUpdated(']) {
    assert.ok(handlers.includes(handler), handler);
  }
});

test('units: only those the core lists for the category (server/utils/constants.js)', () => {
  // DEVICE_FEATURE_UNITS_BY_CATEGORY of the core, for the categories used here.
  const allowed = {
    'temperature-sensor': ['celsius', 'fahrenheit', 'kelvin'],
    'pressure-sensor': ['pascal', 'hPa', 'kPa', 'bar', 'psi', 'milli-bar'],
    thermostat: ['celsius', 'fahrenheit'],
  };
  const gladys = createFakeGladys({ selector: 'incomfort' });
  const features = [
    ...buildHeaterDevice(gladys, '2110f25190', 'fr').features,
    ...buildRoomDevice(gladys, '2110f25190', 1, 'fr').features,
  ];
  for (const feature of features) {
    if (feature.unit === undefined) continue;
    assert.ok(Object.values(DEVICE_FEATURE_UNITS).includes(feature.unit));
    assert.ok(
      allowed[feature.category]?.includes(feature.unit),
      `${feature.name}: ${feature.unit}`,
    );
  }
  const pressure = features.find((f) => f.external_id.endsWith(':pressure'));
  assert.equal(pressure.unit, 'bar');
  // The thermostat's operating state is an enum: no unit (UNITS_BY_CATEGORY_AND_TYPE).
  const heating = features.find((f) => f.external_id.endsWith(':heating'));
  assert.equal(heating.unit, undefined);
});
