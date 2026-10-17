// -----------------------------------------------------------------------------
// Keys, limits and timings. The manifest keys and the external id shapes are
// stored in user devices and scenes: never rename them (test/manifest.test.js
// ties them to the manifest).
// -----------------------------------------------------------------------------

export const ACTIONS = Object.freeze({
  TEST: 'test_connection',
});

/** `ext:<selector>:heater:<serial>`: one per boiler bound to the gateway. */
export const HEATER_TYPE = 'heater';
/** `ext:<selector>:room:<serial>-<1|2>`: one per room thermostat of a boiler. */
export const ROOM_TYPE = 'room';

export const HEATER_FEATURES = Object.freeze({
  WATER_TEMPERATURE: 'heater_temp',
  PRESSURE: 'pressure',
  TAP_TEMPERATURE: 'tap_temp',
  BURNING: 'burning',
  PUMPING: 'pumping',
  TAPPING: 'tapping',
  FAILED: 'failed',
  STATUS: 'status',
  FAULT: 'fault',
});

export const ROOM_FEATURES = Object.freeze({
  TEMPERATURE: 'temperature',
  TARGET: 'target',
  HEATING: 'heating',
});

/** Up to 8 boilers per gateway, up to 2 room thermostats per boiler. */
export const LIMITS = Object.freeze({
  HEATERS: 8,
  ROOMS: [1, 2],
  /** POST /state admits 300 states per minute per integration: we keep under. */
  STATES_PER_MINUTE: 250,
});

/**
 * The room setpoint the gateway accepts: `setpoint = (T - 5) * 10`, 5 to 30 °C
 * (incomfort-client, OVERRIDE_MIN_TEMP / OVERRIDE_MAX_TEMP). A value outside is
 * refused, never clamped (TODO.md, "Decisions").
 */
export const SETPOINT = Object.freeze({ MIN: 5, MAX: 30, STEP: 0.1 });

/** The gateway encodes "no value" as 0x7FFF / 100 (no thermostat, no sensor). */
export const INVALID_VALUE = 327.67;
/** An empty slot of the heater list. */
export const NULL_SERIAL = '000W00000';
/** What a serial must look like to become an external id (digits, letters). */
export const SERIAL_PATTERN = /^[A-Za-z0-9]{4,32}$/;

/** Bits of the `IO` field of data.json. */
export const IO_BITS = Object.freeze({ FAILED: 0x01, PUMPING: 0x02, TAPPING: 0x04, BURNING: 0x08 });

export const TIMEOUTS = Object.freeze({
  /** One request to the gateway (a Lan2RF is slow, the reference library waits 20 s). */
  REQUEST: 10_000,
});

/** Size cap of an answer of the gateway (a few hundred bytes in practice). */
export const MAX_BYTES = 64 * 1024;

/**
 * Gladys waits 5 s for the acknowledgement of a command: past this budget,
 * counted from the moment the command arrives, nothing is sent to the gateway
 * (an action must never run after Gladys showed a failure).
 */
export const COMMAND_BUDGET_MS = 3_500;
/** Room kept after the fresh reads for the command request itself. */
export const COMMAND_MIN_SEND_MS = 800;
/** Room needed to start the fresh reads at all. */
export const COMMAND_MIN_READ_MS = 1_500;
/** Once sent, Gladys gets its answer at the latest this long after the command arrived. */
export const COMMAND_ACK_MS = 4_300;

export const INTERVALS = Object.freeze({
  /** One reading of every boiler. */
  POLL_MS: 30_000,
  /** Gateway unreachable: first retry (never faster than the reading). */
  RETRY_MIN_MS: 30_000,
  RETRY_MAX_MS: 10 * 60_000,
  /** HTTP 429: pause of every request, within these bounds (Retry-After if given). */
  BUSY_MIN_MS: 60_000,
  BUSY_MAX_MS: 6 * 3600_000,
  /** A stable value is published again after this long (dated recently in Gladys). */
  HEARTBEAT_MS: 30 * 60_000,
});
