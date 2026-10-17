// -----------------------------------------------------------------------------
// Answers of the gateway -> plain objects (pure). Ported from incomfort-client
// (MIT, see THIRD_PARTY_NOTICES.md):
//   - a value is `(msb * 256 + lsb) / 100`, 327.67 (0x7FFF) meaning "none";
//   - `IO` is a bit mask: failure, pump, tap (hot water), burner;
//   - `displ_code` is the operating state, or the fault code when `IO` has
//     the failure bit;
//   - a room thermostat (1 or 2) exists when its measured temperature is valid;
//   - some gateways answer a stray backslash inside a serial: replaced by "0"
//     before parsing, like the reference library.
// -----------------------------------------------------------------------------

import { INVALID_VALUE, IO_BITS, LIMITS, NULL_SERIAL, SERIAL_PATTERN } from '../constants.js';

/** The text of an answer as JSON, the stray backslashes replaced; null when not JSON. */
export function parseJson(body) {
  try {
    return JSON.parse(String(body).replace(/\\/g, '0'));
  } catch {
    return null;
  }
}

const isByte = (value) => Number.isInteger(value) && value >= 0 && value <= 255;

/** The decoded value of `<stub>_msb` / `<stub>_lsb`; null when absent or "none". */
export function decodeValue(data, stub) {
  const msb = data?.[`${stub}_msb`];
  const lsb = data?.[`${stub}_lsb`];
  if (!isByte(msb) || !isByte(lsb)) return null;
  const value = Math.round(msb * 256 + lsb) / 100;
  return value === INVALID_VALUE ? null : value;
}

/**
 * heaterlist.json -> [{ index, serial }] of the bound boilers: `index` is the
 * position in the list (the `heater=` of the other requests), `serial` the
 * external id. Empty slots, the null serial, a serial that is not plain
 * letters and digits, and a serial seen twice are left out. null: not a list.
 */
export function parseHeaterList(json) {
  const list = json?.heaterlist;
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const heaters = [];
  list.slice(0, LIMITS.HEATERS).forEach((value, index) => {
    if (typeof value !== 'string') return;
    const serial = value.trim();
    if (!serial || serial === NULL_SERIAL || !SERIAL_PATTERN.test(serial)) return;
    if (seen.has(serial)) return;
    seen.add(serial);
    heaters.push({ index, serial });
  });
  return heaters;
}

/**
 * data.json -> the state of one boiler and its rooms; null when the answer
 * does not look like the data of a boiler (no IO, no display code).
 */
export function parseHeaterData(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const io = json.IO;
  const code = json.displ_code;
  if (!isByte(io) || !Number.isInteger(code) || code < 0 || code > 255) return null;
  const failed = Boolean(io & IO_BITS.FAILED);
  const rooms = [];
  for (const number of LIMITS.ROOMS) {
    const temperature = decodeValue(json, `room_temp_${number}`);
    if (temperature === null) continue;
    const setpoint = decodeValue(json, `room_temp_set_${number}`);
    const override = decodeValue(json, `room_set_ovr_${number}`);
    rooms.push({ number, temperature, setpoint, override, target: targetOf(setpoint, override) });
  }
  return {
    waterTemperature: decodeValue(json, 'ch_temp'),
    tapTemperature: decodeValue(json, 'tap_temp'),
    pressure: decodeValue(json, 'ch_pressure'),
    burning: Boolean(io & IO_BITS.BURNING),
    pumping: Boolean(io & IO_BITS.PUMPING),
    tapping: Boolean(io & IO_BITS.TAPPING),
    failed,
    displayCode: failed ? null : code,
    faultCode: failed ? code : null,
    rooms,
  };
}

/**
 * The setpoint the room aims for, as the core of Home Assistant shows it: the
 * override Gladys (or another client) sent, else the thermostat's own
 * setpoint. An override of 0 means "none". A value outside 5-30 °C is not a
 * setpoint (an older thermostat may keep garbage there).
 */
export function targetOf(setpoint, override) {
  const valid = (v) => v !== null && v >= 5 && v <= 30;
  if (valid(override)) return override;
  if (valid(setpoint)) return setpoint;
  return null;
}
