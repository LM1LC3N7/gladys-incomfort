import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseHost } from '../src/config.js';

test('the address: bare, with a port, with http://', () => {
  assert.deepEqual(parseHost('192.168.1.20'), {
    origin: 'http://192.168.1.20:80',
    hostname: '192.168.1.20',
    port: 80,
  });
  assert.equal(parseHost(' Lan2RF.local:8080 ').origin, 'http://lan2rf.local:8080');
  assert.equal(parseHost('http://192.168.1.20/').origin, 'http://192.168.1.20:80');
});

test('the address: what is refused', () => {
  assert.deepEqual(parseHost(''), { error: 'empty' });
  assert.deepEqual(parseHost('https://192.168.1.20'), { error: 'https' });
  assert.deepEqual(parseHost('http://admin:pw@192.168.1.20'), { error: 'credentials' });
  assert.deepEqual(parseHost('192.168.1.20/data.json'), { error: 'invalid' });
  assert.deepEqual(parseHost('192.168.1.20?x=1'), { error: 'invalid' });
  assert.deepEqual(parseHost('ftp://192.168.1.20'), { error: 'invalid' });
  assert.deepEqual(parseHost('http://'), { error: 'invalid' });
});

test('defaults: read only, French', () => {
  const config = normalizeConfig({ host: '192.168.1.20' });
  assert.equal(config.allowSetpoint, false);
  assert.equal(config.language, DEFAULTS.language);
  assert.equal(config.username, '');
  assert.equal(normalizeConfig({ host: 'x', allow_setpoint: 'true' }).allowSetpoint, true);
  assert.equal(normalizeConfig({ host: 'x', language: 'de' }).language, 'fr');
  assert.equal(normalizeConfig(null).hostError, 'empty');
});

test('credentials: a password alone, invisible characters', () => {
  assert.equal(normalizeConfig({ host: 'x', password: 'pw' }).passwordWithoutUser, true);
  assert.equal(normalizeConfig({ host: 'x', username: 'admin' }).passwordWithoutUser, false);
  assert.equal(normalizeConfig({ host: 'x', username: 'ad​min' }).credentialsInvalid, true);
  assert.equal(normalizeConfig({ host: 'x', username: 'a:b' }).credentialsInvalid, true);
  assert.equal(
    normalizeConfig({ host: 'x', username: 'admin', password: 'p w!' }).credentialsInvalid,
    false,
  );
});
