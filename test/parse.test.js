// -----------------------------------------------------------------------------
// Decoding the answers of the gateway, against the test data of
// incomfort-client (MIT): the same raw answers must give the same values.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeValue,
  parseHeaterData,
  parseHeaterList,
  parseJson,
  targetOf,
} from '../src/lan2rf/parse.js';
import { encodeSetpoint } from '../src/lan2rf/client.js';
import { faultText, statusText } from '../src/i18n.js';

// tests/test_heater.py of incomfort-client: HEATER_WITH_ROOMS_ALT (raw answer).
const ALT = {
  nodenr: 56,
  ch_temp_lsb: 132,
  ch_temp_msb: 8,
  tap_temp_lsb: 221,
  tap_temp_msb: 9,
  ch_pressure_lsb: 176,
  ch_pressure_msb: 0,
  room_temp_1_lsb: 158,
  room_temp_1_msb: 7,
  room_temp_set_1_lsb: 158,
  room_temp_set_1_msb: 7,
  room_temp_2_lsb: 255,
  room_temp_2_msb: 127,
  room_temp_set_2_lsb: 255,
  room_temp_set_2_msb: 127,
  displ_code: 126,
  IO: 0,
  serial_year: 0,
  serial_month: 0,
  serial_line: 0,
  serial_sn1: 0,
  serial_sn2: 0,
  serial_sn3: 0,
  room_set_ovr_1_msb: 7,
  room_set_ovr_1_lsb: 158,
  room_set_ovr_2_msb: 0,
  room_set_ovr_2_lsb: 0,
  rf_message_rssi: 29,
  rfstatus_cntr: 0,
};

test('values: (msb * 256 + lsb) / 100, 0x7FFF is "none"', () => {
  assert.equal(decodeValue({ x_msb: 24, x_lsb: 168 }, 'x'), 63.12);
  assert.equal(decodeValue({ x_msb: 127, x_lsb: 255 }, 'x'), null);
  assert.equal(decodeValue({ x_msb: 300, x_lsb: 0 }, 'x'), null, 'not a byte');
  assert.equal(decodeValue({ x_msb: '1', x_lsb: 0 }, 'x'), null);
  assert.equal(decodeValue({}, 'x'), null);
});

test('a boiler with a room: the values of incomfort-client', () => {
  const data = parseHeaterData(ALT);
  assert.equal(data.waterTemperature, 21.8);
  assert.equal(data.tapTemperature, 25.25);
  assert.equal(data.pressure, 1.76);
  assert.deepEqual(
    [data.burning, data.pumping, data.tapping, data.failed],
    [false, false, false, false],
  );
  assert.equal(data.displayCode, 126);
  assert.equal(data.faultCode, null);
  assert.deepEqual(data.rooms, [
    { number: 1, temperature: 19.5, setpoint: 19.5, override: 19.5, target: 19.5 },
  ]);
  assert.equal(statusText(data, 'en'), 'Standby');
  assert.equal(statusText(data, 'fr'), 'Veille');
  assert.equal(faultText(data, 'fr'), 'Aucun défaut');
});

test('IO bits and fault codes', () => {
  const data = parseHeaterData({ ...ALT, IO: 0x0f, displ_code: 4 });
  assert.deepEqual(
    [data.burning, data.pumping, data.tapping, data.failed],
    [true, true, true, true],
  );
  assert.equal(data.displayCode, null);
  assert.equal(data.faultCode, 4);
  assert.equal(faultText(data, 'en'), 'E4 – No flame signal');
  assert.equal(statusText(data, 'fr'), 'E4 – Pas de signal de flamme');
  assert.equal(
    faultText(parseHeaterData({ ...ALT, IO: 1, displ_code: 99 }), 'en'),
    'E99 – Unknown fault',
  );
  assert.equal(
    statusText(parseHeaterData({ ...ALT, displ_code: 7 }), 'en'),
    'Unknown state (code 7)',
  );
});

test('the target: the override, else the setpoint (an override of 0 is none)', () => {
  assert.equal(targetOf(18, 0), 18);
  assert.equal(targetOf(18, 21.5), 21.5);
  assert.equal(targetOf(null, null), null);
  assert.equal(targetOf(2, 0), null, 'garbage outside 5-30 is not a setpoint');
  const noRoom = parseHeaterData({ ...ALT, room_temp_1_msb: 127, room_temp_1_lsb: 255 });
  assert.deepEqual(noRoom.rooms, [], 'no valid room temperature: no thermostat');
});

test('not the data of a boiler', () => {
  assert.equal(parseHeaterData(null), null);
  assert.equal(parseHeaterData([]), null);
  assert.equal(parseHeaterData({ IO: 0 }), null);
  assert.equal(parseHeaterData({ IO: 'x', displ_code: 1 }), null);
});

test('the heater list: empty slots, the null serial, odd and duplicate serials left out', () => {
  assert.deepEqual(
    parseHeaterList({
      heaterlist: ['2110f25190', null, '000W00000', '', 'bad serial!', '2110f25190', '2110f25191'],
    }),
    [
      { index: 0, serial: '2110f25190' },
      { index: 6, serial: '2110f25191' },
    ],
  );
  assert.equal(parseHeaterList({}), null);
  assert.deepEqual(parseHeaterList({ heaterlist: Array(12).fill('2110f25190') }).length, 1);
});

test('a stray backslash in a serial becomes "0", like incomfort-client', () => {
  const json = parseJson('{"heaterlist": ["2303\\02041", null]}');
  assert.deepEqual(parseHeaterList(json), [{ index: 0, serial: '2303002041' }]);
  assert.equal(parseJson('<html>'), null);
});

test('the setpoint encoding: (T - 5) * 10', () => {
  assert.equal(encodeSetpoint(20), 150);
  assert.equal(encodeSetpoint(5), 0);
  assert.equal(encodeSetpoint(30), 250);
  assert.equal(encodeSetpoint(19.5), 145);
});
