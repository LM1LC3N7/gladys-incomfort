// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and the fake gateway, through
// the exact wiring of the container (src/handlers.js).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES as C } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { IncomfortApp } from '../src/app.js';
import { ACTIONS, COMMAND_ACK_MS, INTERVALS } from '../src/constants.js';
import { buildHeaterDevice, buildRoomDevice } from '../src/devices.js';
import { registerHandlers } from '../src/handlers.js';
import {
  PASSWORD,
  SERIAL_A,
  SERIAL_B,
  USERNAME,
  createFakeGateway,
  heaterData,
} from './helpers/fakeGateway.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const T0 = Date.parse('2026-10-17T08:00:00Z');
const SELECTOR = 'incomfort';
const ids = createFakeGladys({ selector: SELECTOR });
const heater = (serial = SERIAL_A, language = 'fr') => buildHeaterDevice(ids, serial, language);
const room = (serial = SERIAL_A, number = 1) => buildRoomDevice(ids, serial, number, 'fr');
const feature = (d, key) => d.features.find((f) => f.external_id.endsWith(`:${key}`));
const BASE_CONFIG = { host: 'lan2rf.local' };

let running;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function setup({ config = {}, created = [heater(), room()], gateway } = {}) {
  const clock = { now: T0 };
  gateway ??= createFakeGateway();
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { ...BASE_CONFIG, ...config },
    devices: created,
  });
  const timers = createFakeTimers();
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.stack ?? String(a)).join(' ')}`),
    ]),
  );
  const app = new IncomfortApp({
    gladys,
    logger,
    request: gateway.request,
    now: () => clock.now,
    timers,
  });
  running = app;
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  return { gladys, gateway, timers, clock, logs, app };
}

const state = (gladys, device, key) => gladys.fake.lastState(feature(device, key).external_id);
const badge = (gladys, device) =>
  gladys.fake.transports.filter((t) => t.device_external_id === device.external_id).at(-1)
    ?.transport;
const poll = (timers) => timers.run((ms) => ms === INTERVALS.POLL_MS);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await tick();
};

test('start: Discovery gets the boiler and its room; states, badges, status', async () => {
  const { gladys, timers } = await setup();
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'The gateway answers: 1 boiler, 1 room thermostat.',
      fr: 'La passerelle répond : 1 chaudière, 1 thermostat de pièce.',
    },
  });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name]),
    [
      [`ext:${SELECTOR}:heater:${SERIAL_A}`, `Chaudière Intergas ${SERIAL_A}`],
      [`ext:${SELECTOR}:room:${SERIAL_A}-1`, `Thermostat de pièce 1 (${SERIAL_A})`],
    ],
  );
  const h = heater();
  const r = room();
  assert.equal(state(gladys, h, 'heater_temp'), 63.12);
  assert.equal(state(gladys, h, 'pressure'), 1.74);
  assert.equal(state(gladys, h, 'tap_temp'), 50.48);
  assert.equal(state(gladys, h, 'burning'), 0);
  assert.equal(state(gladys, h, 'failed'), 0);
  assert.equal(state(gladys, h, 'status'), 'Veille');
  assert.equal(state(gladys, h, 'fault'), 'Aucun défaut');
  assert.equal(state(gladys, r, 'temperature'), 19);
  assert.equal(state(gladys, r, 'target'), 18);
  assert.equal(state(gladys, r, 'heating'), 0);
  assert.equal(badge(gladys, h), 'local');
  assert.equal(badge(gladys, r), 'local');
  assert.deepEqual(timers.delays(), [INTERVALS.POLL_MS]);
});

test('the readings follow the boiler: burner, pump, fault in words', async () => {
  const { gladys, gateway, timers } = await setup();
  gateway.heaters[0] = heaterData({
    io: 0x0b,
    code: 1,
    rooms: { 1: { temperature: 20.5, setpoint: 21, override: 0 } },
  });
  await poll(timers);
  const h = heater();
  assert.equal(state(gladys, h, 'burning'), 1);
  assert.equal(state(gladys, h, 'pumping'), 1);
  assert.equal(state(gladys, h, 'failed'), 1);
  assert.equal(state(gladys, h, 'fault'), 'E1 – Température de l’eau du circuit trop élevée');
  assert.equal(state(gladys, room(), 'heating'), 1);
  assert.equal(state(gladys, room(), 'target'), 21);
});

test('the external id is the serial: a boiler that moves in the list keeps its device', async () => {
  const { gladys, gateway, timers } = await setup();
  gateway.heaterlist = [null, null, SERIAL_A, null, null, null, null, null];
  gateway.heaters = [undefined, undefined, heaterData({ pressure: 1.5 })];
  await poll(timers);
  assert.equal(state(gladys, heater(), 'pressure'), 1.5);
  assert.ok(gateway.requests.some((r) => r.query === '?heater=2'));
});

test('a second boiler that fails alone: its devices unreachable, the others go on', async () => {
  const gateway = createFakeGateway();
  gateway.heaterlist = [SERIAL_A, SERIAL_B, null, null, null, null, null, null];
  gateway.heaters = [heaterData(), heaterData({ rooms: {} })];
  const { gladys, timers } = await setup({
    gateway,
    created: [heater(), room(), heater(SERIAL_B)],
  });
  assert.equal(badge(gladys, heater(SERIAL_B)), 'local');
  gateway.failures.push({ path: '/data.json?heater=1', status: 500 });
  await poll(timers);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /1 boiler does not answer/);
  assert.equal(badge(gladys, heater(SERIAL_B)), 'unreachable');
  assert.equal(badge(gladys, heater()), 'local');
  await poll(timers);
  assert.equal(badge(gladys, heater(SERIAL_B)), 'local', 'back at the next reading');
});

test('gateway unreachable: every device unreachable, retried at 30 s then slower, never faster', async () => {
  const { gladys, gateway, timers } = await setup();
  gateway.unreachable = true;
  await poll(timers);
  assert.equal(badge(gladys, heater()), 'unreachable');
  assert.equal(badge(gladys, room()), 'unreachable');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer: no connection/);
  assert.deepEqual(timers.delays(), [INTERVALS.RETRY_MIN_MS]);
  await timers.run();
  assert.deepEqual(timers.delays(), [60_000]);
  await timers.run();
  assert.deepEqual(timers.delays(), [120_000]);
  for (let i = 0; i < 6; i += 1) await timers.run();
  assert.deepEqual(timers.delays(), [INTERVALS.RETRY_MAX_MS]);
  gateway.unreachable = false;
  await timers.run();
  assert.equal(badge(gladys, heater()), 'local');
  assert.deepEqual(timers.delays(), [INTERVALS.POLL_MS]);
});

test('credentials asked (401): blocked, no timer; a reconnection to Gladys does not retry', async () => {
  const gateway = createFakeGateway({ protect: true });
  const { gladys, timers } = await setup({ gateway });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /asks for a user name and password/);
  assert.deepEqual(timers.delays(), [], 'no retry loop');
  const sent = gateway.requests.length;
  await gladys.disconnect();
  await gladys.connect();
  assert.equal(gateway.requests.length, sent, 'nothing sent again');
  await gladys.fake.configUpdated({ ...BASE_CONFIG, username: USERNAME, password: PASSWORD });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gateway.requests.at(-1).path, '/protect/data.json');
});

test('wrong password: refused once, then only a user action tries again', async () => {
  const gateway = createFakeGateway({ protect: true });
  const { gladys, timers, logs } = await setup({
    gateway,
    config: { username: USERNAME, password: 'wrong-password' },
  });
  assert.match(gladys.fake.connectionStatus.message.en, /refused the user name and password/);
  assert.deepEqual(timers.delays(), []);
  const sent = gateway.requests.length;
  await gladys.disconnect();
  await gladys.connect();
  assert.equal(gateway.requests.length, sent);
  const ack = await gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, false, 'the button tries again (and fails again)');
  assert.equal(gateway.requests.length, sent + 1);
  const all = logs.join('\n');
  assert.ok(!all.includes('wrong-password'), 'the password is never logged');
  assert.ok(!all.includes(Buffer.from(`${USERNAME}:wrong-password`).toString('base64')));
});

test('a reconnection to Gladys publishes everything again, without reading sooner', async () => {
  const { gladys, gateway, timers } = await setup();
  const sent = gateway.requests.length;
  const discovered = gladys.fake.discoveredDevices.length;
  const states = gladys.fake.states.length;
  await gladys.disconnect();
  assert.deepEqual(timers.delays(), [], 'the loop pauses while Gladys is away');
  await gladys.connect();
  assert.equal(gateway.requests.length, sent, 'no reading before the interval');
  assert.ok(gladys.fake.discoveredDevices.length >= discovered);
  assert.ok(gladys.fake.states.length > states, 'states published again');
  assert.equal(timers.delays().length, 1, 'the loop goes on');
  assert.ok(timers.delays()[0] <= INTERVALS.POLL_MS);
});

test('HTTP 429: every path pauses (1 min at least), commands too', async () => {
  const { gladys, gateway, timers } = await setup({ config: { allow_setpoint: true } });
  gateway.failures.push({ path: '/heaterlist.json', status: 429, headers: { 'retry-after': '5' } });
  await poll(timers);
  assert.match(gladys.fake.connectionStatus.message.en, /slow down/);
  assert.deepEqual(timers.delays(), [INTERVALS.BUSY_MIN_MS]);
  const ack = await gladys.fake.setValue(room(), feature(room(), 'target'), 21);
  assert.equal(ack.success, false);
  assert.match(ack.error, /slow down/);
  assert.equal(gateway.setpoints.length, 0);
});

test('remote texts never reach the logs', async () => {
  const { gateway, timers, logs } = await setup();
  gateway.failures.push({
    path: '/heaterlist.json',
    status: 502,
    body: '<html>remote text</html>',
  });
  await poll(timers);
  assert.ok(logs.some((l) => l.includes('HTTP 502')));
  assert.ok(!logs.join('\n').includes('remote text'));
});

// --- Commands -------------------------------------------------------------------

const target = () => feature(room(), 'target');
const setpoint = (gladys, value) => gladys.fake.setValue(room(), target(), value);

test('safety of the features: no switch, only the room setpoint is a command, no hot water command', () => {
  const features = [...heater().features, ...room().features];
  assert.ok(features.every((f) => f.category !== C.SWITCH));
  assert.ok(features.every((f) => f.category !== C.WATER_HEATER));
  assert.deepEqual(
    features.filter((f) => !f.read_only).map((f) => f.external_id),
    [target().external_id],
  );
  assert.equal(target().min, 5);
  assert.equal(target().max, 30);
});

test('the setpoint is refused while not allowed (the default): nothing sent', async () => {
  const { gladys, gateway } = await setup();
  const sent = gateway.requests.length;
  const ack = await setpoint(gladys, 21);
  assert.equal(ack.success, false);
  assert.match(ack.error, /off: allow it first/);
  assert.equal(gateway.requests.length, sent);
});

test('allowed: the state is read again, then the setpoint sent and published', async () => {
  const { gladys, gateway } = await setup({ config: { allow_setpoint: true } });
  const sent = gateway.requests.length;
  const ack = await setpoint(gladys, 21);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    gateway.requests.slice(sent).map((r) => `${r.path}${r.query}`),
    ['/heaterlist.json', '/data.json?heater=0', '/data.json?heater=0&thermostat=0&setpoint=160'],
  );
  await settle();
  assert.equal(state(gladys, room(), 'target'), 21);
});

test('the setpoint already there: nothing sent', async () => {
  const { gladys, gateway } = await setup({ config: { allow_setpoint: true } });
  const ack = await setpoint(gladys, 18);
  assert.equal(ack.success, true);
  assert.equal(gateway.setpoints.length, 0);
});

test('a stale override of an older thermostat: the command is still sent', async () => {
  const gateway = createFakeGateway();
  // Set by hand to 18 on the thermostat, an old remote override of 20 kept.
  gateway.heaters[0] = heaterData({
    rooms: { 1: { temperature: 19, setpoint: 18, override: 20 } },
  });
  const { gladys } = await setup({ gateway, config: { allow_setpoint: true } });
  assert.equal(state(gladys, room(), 'target'), 20, 'shown like Home Assistant');
  const ack = await setpoint(gladys, 20);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    gateway.setpoints.map((s) => s.setpoint),
    [150],
  );
});

test('the answer to Gladys never waits for the publication of the states', async () => {
  const { gladys, app } = await setup({ config: { allow_setpoint: true } });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const publish = app.gladys.publishChangedStates.bind(app.gladys);
  app.gladys.publishChangedStates = async (...args) => {
    await gate;
    return publish(...args);
  };
  const ack = await setpoint(gladys, 21);
  assert.equal(ack.success, true, 'answered while the states are still on their way');
  release();
  await settle();
  assert.equal(state(gladys, room(), 'target'), 21);
});

test('the raw value is checked before rounding', async () => {
  const { gladys, gateway } = await setup({ config: { allow_setpoint: true } });
  for (const value of [30.04, 4.95]) {
    const ack = await setpoint(gladys, value);
    assert.equal(ack.success, false, String(value));
  }
  const ack = await setpoint(gladys, 20.04);
  assert.equal(ack.success, true);
  assert.deepEqual(
    gateway.setpoints.map((s) => s.setpoint),
    [150],
    'rounded to 20.0 once in range',
  );
});

test('a late 401 of a setpoint blocks every path', async () => {
  const { gladys, gateway, timers } = await setup({ config: { allow_setpoint: true } });
  let release;
  gateway.setpointGate = new Promise((resolve) => {
    release = resolve;
  });
  const pending = setpoint(gladys, 22);
  for (let i = 0; i < 10 && gateway.setpoints.length === 0; i += 1) await tick();
  await timers.run((ms) => ms === COMMAND_ACK_MS);
  assert.equal((await pending).success, true);
  gateway.lateStatus = 401; // the answer of the setpoint comes back 401
  release();
  await settle();
  assert.match(gladys.fake.connectionStatus.message.en, /asks for a user name and password/);
  assert.equal(running.blocked, true);
});

test('a device updated in Gladys gets its states and badge again', async () => {
  const { gladys } = await setup();
  const before = gladys.fake.transports.length;
  await gladys.fake.deviceUpdated(heater());
  await settle();
  assert.ok(gladys.fake.transports.length > before, 'badge published again');
  assert.equal(badge(gladys, heater()), 'local');
});

test('the state budget: a cut rotates, no feature held back for ever', async () => {
  const { gladys, app, timers } = await setup();
  app.gladys.forgetPublishedStates();
  app.budget.remaining = () => 3;
  const seen = new Set();
  const from = gladys.fake.states.length;
  for (let i = 0; i < 6; i += 1) {
    app.gladys.forgetPublishedStates();
    await poll(timers);
  }
  for (const s of gladys.fake.states.slice(from)) seen.add(s.device_feature_external_id);
  assert.ok(gladys.fake.states.length - from <= 18, 'never more than the budget per round');
  const all = [...heater().features, ...room().features].map((f) => f.external_id);
  assert.ok(
    all.every((id) => seen.has(id)),
    'every feature published at some round',
  );
});

test('the configuration unreadable on connected: asked again, bounded', async () => {
  const gateway = createFakeGateway();
  const { gladys, timers } = await setup({ gateway });
  await gladys.disconnect();
  const getConfig = gladys.getConfig.bind(gladys);
  let calls = 0;
  let failures = 0;
  gladys.getConfig = async () => {
    calls += 1;
    if (calls === 1) return getConfig(); // the fake's own resync in connect()
    failures += 1;
    throw new Error('Gladys busy');
  };
  await gladys.connect();
  assert.deepEqual(timers.delays(), [30_000]);
  for (let i = 0; i < 6; i += 1) await timers.run();
  assert.equal(failures, 4, 'one read and three retries, then it stops');
  assert.deepEqual(timers.delays(), []);
  gladys.getConfig = getConfig;
});

test('out of range, not a number, unknown feature: refused, never clamped', async () => {
  const { gladys, gateway } = await setup({ config: { allow_setpoint: true } });
  for (const value of [4.9, 30.1, 70, -1, 'abc']) {
    const ack = await setpoint(gladys, value);
    assert.equal(ack.success, false, String(value));
    assert.match(ack.error, /from 5 to 30/);
  }
  const ack = await gladys.fake.setValue(heater(), feature(heater(), 'burning'), 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /only the room setpoint/);
  assert.equal(gateway.setpoints.length, 0);
});

test('fresh read fails, unknown room or boiler: nothing sent', async () => {
  const { gladys, gateway } = await setup({
    config: { allow_setpoint: true },
    created: [heater(), room(), room(SERIAL_A, 2)],
  });
  gateway.failures.push({ path: '/data.json?heater=0', status: 500 });
  let ack = await setpoint(gladys, 21);
  assert.match(ack.error, /could not be read \(HTTP error 500\): nothing was sent/);
  ack = await gladys.fake.setValue(room(SERIAL_A, 2), feature(room(SERIAL_A, 2), 'target'), 21);
  assert.match(ack.error, /does not answer the gateway now: nothing was sent/);
  gateway.heaterlist = [SERIAL_B, null, null, null, null, null, null, null];
  ack = await setpoint(gladys, 21);
  assert.match(ack.error, /no longer bound/);
  assert.equal(gateway.setpoints.length, 0);
});

test('past 3.5 s after the command, nothing is sent', async () => {
  const { gladys, gateway, clock } = await setup({ config: { allow_setpoint: true } });
  const slow = gateway.request;
  gateway.request = async (url, options) => {
    clock.now += 1_500; // each read takes 1.5 s
    return slow(url, options);
  };
  running.request = gateway.request;
  running.client.request = gateway.request;
  const ack = await setpoint(gladys, 21);
  assert.equal(ack.success, false);
  assert.match(ack.error, /nothing was sent/);
  assert.equal(gateway.setpoints.length, 0);
});

test('a slow gateway: Gladys is answered at 4.3 s, the state follows', async () => {
  const { gladys, gateway, timers } = await setup({ config: { allow_setpoint: true } });
  let release;
  gateway.setpointGate = new Promise((resolve) => {
    release = resolve;
  });
  const pending = setpoint(gladys, 22.5);
  for (let i = 0; i < 10 && gateway.setpoints.length === 0; i += 1) await tick();
  assert.equal(gateway.setpoints.length, 1);
  await timers.run((ms) => ms === COMMAND_ACK_MS);
  const ack = await pending;
  assert.equal(ack.success, true);
  release();
  for (let i = 0; i < 10; i += 1) await tick();
  assert.equal(state(gladys, room(), 'target'), 22.5);
});

test('commands run one after the other; a new configuration refuses the ones waiting', async () => {
  const { gladys, gateway } = await setup({ config: { allow_setpoint: true } });
  const [a, b] = await Promise.all([setpoint(gladys, 20), setpoint(gladys, 21)]);
  assert.equal(a.success, true);
  assert.equal(b.success, true);
  assert.deepEqual(
    gateway.setpoints.map((s) => s.setpoint),
    [150, 160],
  );
  await gladys.fake.configUpdated({ ...BASE_CONFIG, allow_setpoint: false });
  const ack = await setpoint(gladys, 22);
  assert.match(ack.error, /off: allow it first/);
});

test('the language of the devices', async () => {
  const { gladys } = await setup({ config: { language: 'en' }, created: [heater(SERIAL_A, 'en')] });
  assert.equal(gladys.fake.discoveredDevices[0].name, `Intergas boiler ${SERIAL_A}`);
  assert.equal(state(gladys, heater(SERIAL_A, 'en'), 'status'), 'Standby');
});

test('configuration problems are said, nothing is sent', async () => {
  for (const [config, pattern] of [
    [{ host: '' }, /Type the address/],
    [{ host: 'https://192.168.1.20' }, /only speaks plain http/],
    [{ password: 'x' }, /without a user name/],
  ]) {
    const { gladys, gateway } = await setup({ config });
    assert.match(gladys.fake.connectionStatus.message.en, pattern);
    assert.equal(gateway.requests.length, 0);
    await running.stop();
  }
});

test('"Test the connection" answers within its timeout', async () => {
  const { gladys } = await setup();
  const ack = await gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.message, {
    en: 'Connected: 1 boiler, 1 room thermostat.',
    fr: 'Connecté : 1 chaudière, 1 thermostat de pièce.',
  });
});
