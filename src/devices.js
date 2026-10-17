// -----------------------------------------------------------------------------
// Gladys devices (pure).
//
//   heater  `ext:<selector>:heater:<serial>`
//           one per boiler bound to the gateway: heating water temperature,
//           pressure, hot water temperature, burner / pump / hot water /
//           fault (read only), status and fault in words
//   room    `ext:<selector>:room:<serial>-<1|2>`
//           one per room thermostat of a boiler: room temperature, setpoint
//           (the only command, off by default), heating
//
// The serial is the one the gateway lists (heaterlist.json), stable for a
// boiler; the position in the list only serves the requests and is read
// again at every round.
//
// Never a `switch`: the core hands every switch to the voice assistants, MCP
// and the "turn everything off" scene actions. The binary readings are
// `unknown`/`binary`, read only; nothing about hot water can be commanded.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  HEATER_FEATURES as HF,
  HEATER_TYPE,
  LIMITS,
  ROOM_FEATURES as RF,
  ROOM_TYPE,
  SERIAL_PATTERN,
  SETPOINT,
} from './constants.js';
import { texts } from './i18n.js';

export const heaterIds = (gladys, serial) => gladys.externalIds(HEATER_TYPE, serial);
export const roomIds = (gladys, serial, number) =>
  gladys.externalIds(ROOM_TYPE, `${serial}-${number}`);

const readOnly = (extra) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});
const binary = () => readOnly({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 });
/**
 * A water temperature is a `probe` (a sensor in the water, not the air): the
 * core keeps it out of the temperature of the room the boiler is in.
 */
const temperature = (min, max, type = T.TEMPERATURE_SENSOR.PROBE) =>
  readOnly({ category: C.TEMPERATURE_SENSOR, type, unit: U.CELSIUS, min, max });
const words = () =>
  readOnly({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false });

export function buildHeaterDevice(gladys, serial, language) {
  const ids = heaterIds(gladys, serial);
  const t = texts(language);
  const named = (key, feature) => ({
    name: t.features[key],
    external_id: ids.feature(key),
    ...feature,
  });
  return {
    name: t.heater(serial),
    external_id: ids.device,
    model: 'Intergas (Lan2RF)',
    should_poll: false,
    features: [
      named(HF.WATER_TEMPERATURE, temperature(0, 120)),
      named(
        HF.PRESSURE,
        readOnly({
          category: C.PRESSURE_SENSOR,
          type: T.SENSOR.DECIMAL,
          unit: U.BAR,
          min: 0,
          max: 10,
        }),
      ),
      named(HF.TAP_TEMPERATURE, temperature(0, 120)),
      named(HF.BURNING, binary()),
      named(HF.PUMPING, binary()),
      named(HF.TAPPING, binary()),
      named(HF.FAILED, binary()),
      named(HF.STATUS, words()),
      named(HF.FAULT, words()),
    ],
  };
}

export function buildRoomDevice(gladys, serial, number, language) {
  const ids = roomIds(gladys, serial, number);
  const t = texts(language);
  const named = (key, feature) => ({
    name: t.features[key],
    external_id: ids.feature(key),
    ...feature,
  });
  return {
    name: t.room(number, serial),
    external_id: ids.device,
    model: 'Intergas room thermostat (Lan2RF)',
    should_poll: false,
    features: [
      named(RF.TEMPERATURE, temperature(-20, 60, T.SENSOR.DECIMAL)),
      // A command, refused unless the user allowed it (`allow_setpoint`, off
      // by default): read_only is fixed when the device is created, so the
      // permission is checked at each command instead.
      named(RF.TARGET, {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.TARGET_TEMPERATURE,
        unit: U.CELSIUS,
        min: SETPOINT.MIN,
        max: SETPOINT.MAX,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      }),
      // Burner and pump on, as Home Assistant shows the action of the room.
      named(
        RF.HEATING,
        readOnly({ category: C.THERMOSTAT, type: T.THERMOSTAT.OPERATING_STATE, min: 0, max: 1 }),
      ),
    ],
  };
}

/**
 * What a device or feature external id of this integration designates:
 * { kind: 'heater', serial, feature } | { kind: 'room', serial, number, feature } | null.
 */
export function parseExternalId(gladys, externalId) {
  if (typeof externalId !== 'string') return null;
  const heaterPrefix = gladys.externalId(`${HEATER_TYPE}:`);
  if (externalId.startsWith(heaterPrefix)) {
    const [serial, feature, ...rest] = externalId.slice(heaterPrefix.length).split(':');
    if (rest.length > 0 || !SERIAL_PATTERN.test(serial ?? '')) return null;
    return { kind: 'heater', serial, feature: feature ?? null };
  }
  const roomPrefix = gladys.externalId(`${ROOM_TYPE}:`);
  if (externalId.startsWith(roomPrefix)) {
    const [platformId, feature, ...rest] = externalId.slice(roomPrefix.length).split(':');
    const match = /^([A-Za-z0-9]+)-(\d)$/.exec(platformId ?? '');
    if (rest.length > 0 || !match || !SERIAL_PATTERN.test(match[1])) return null;
    const number = Number(match[2]);
    if (!LIMITS.ROOMS.includes(number)) return null;
    return { kind: 'room', serial: match[1], number, feature: feature ?? null };
  }
  return null;
}

/** The created devices of this integration: { heaters: [...], rooms: [...] }. */
export function createdDevices(gladys, devices = gladys.devices) {
  const heaters = [];
  const rooms = [];
  for (const device of devices ?? []) {
    const parsed = parseExternalId(gladys, device?.external_id);
    if (!parsed || parsed.feature !== null) continue;
    const entry = { ...parsed, externalId: device.external_id };
    if (parsed.kind === 'heater') heaters.push(entry);
    else rooms.push(entry);
  }
  return { heaters, rooms };
}
