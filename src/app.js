// -----------------------------------------------------------------------------
// IncomfortApp: the integration. One Lan2RF gateway, its boilers and rooms.
//
//   start(config)  (re)connects: the boilers read, Discovery published, the
//                  reading loop started. The same configuration again (Gladys
//                  reconnected) only publishes everything again: the client,
//                  a refusal of the credentials and an HTTP 429 pause stay.
//   reading loop   every 30 s: the heater list, then each boiler (its rooms
//                  come with it). A boiler that fails marks only its own
//                  devices unreachable. The gateway unreachable: every device
//                  unreachable, the next try 30 s to 10 min later (never
//                  faster than the reading), HTTP 429: a pause of 1 min to 6 h.
//   setValue       the room setpoint only, see "Commands" below.
//
// Each loop is one chain of timers: halt() bumps an epoch, and a run of an
// older epoch never schedules itself again. Credentials the gateway refused
// (HTTP 401) are final: nothing is sent again until the configuration is
// saved or "Test the connection" is pressed.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { Budget } from './budget.js';
import { credentialsKey, normalizeConfig } from './config.js';
import {
  COMMAND_ACK_MS,
  COMMAND_BUDGET_MS,
  COMMAND_MIN_READ_MS,
  COMMAND_MIN_SEND_MS,
  HEATER_FEATURES as HF,
  INTERVALS,
  LIMITS,
  ROOM_FEATURES as RF,
  SETPOINT,
} from './constants.js';
import {
  buildHeaterDevice,
  buildRoomDevice,
  createdDevices,
  heaterIds,
  parseExternalId,
  roomIds,
} from './devices.js';
import { T, faultText, statusText } from './i18n.js';
import { GatewayClient } from './lan2rf/client.js';
import { CODES, isAuthRefused } from './lan2rf/errors.js';
import { httpRequest } from './lan2rf/http.js';

/** The "Test the connection" button waits 30 s: answer before. */
const TEST_BUDGET_MS = 25_000;
/** Entries per publishTransports call (the SDK refuses more). */
const TRANSPORTS_PER_CALL = 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const bit = (value) => (value ? 1 : 0);

export class IncomfortApp {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {object} [options.logger]
   * @param {Function} [options.request] the HTTP transport (tests inject a fake gateway)
   * @param {() => number} [options.now]
   * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
   */
  constructor({
    gladys,
    logger = createLogger({ name: 'incomfort' }),
    request = httpRequest,
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.request = request;
    this.now = now;
    this.timers = timers;
    this.budget = new Budget({ perMinute: LIMITS.STATES_PER_MINUTE, now });
    this.rawConfig = {};
    this.config = normalizeConfig();
    this.configKey = null;
    this.client = null;
    this.generation = 0;
    this.epoch = 0;
    this.handles = new Set();
    this.queue = Promise.resolve();
    /** One gateway: the commands run one after the other. */
    this.commands = Promise.resolve();
    this.activeCommands = 0;
    this.stateVersion = 0;
    this.lastStatus = null;
    /** credentialsKey() of the values the gateway refused (memory only). */
    this.refusedKey = null;
    this.pausedUntil = 0;
    this.reset();
  }

  reset() {
    this.online = false;
    this.blocked = false;
    this.retryDelay = INTERVALS.RETRY_MIN_MS;
    /** No reading starts before this time (the interval, or the retry delay). */
    this.nextReadAt = 0;
    /** serial -> { index, data | null } (null: this boiler did not answer). */
    this.heaters = new Map();
    this.discoveredKey = null;
    this.transports = new Map();
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Run `task` after every start already queued. */
  enqueue(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * (Re)start with a configuration. Calls are serialized. `force`: the user
   * asked (button, saved configuration): refused credentials are tried again
   * and an HTTP 429 pause is lifted.
   */
  start(rawConfig, { force = false } = {}) {
    return this.enqueue(() => this.run(rawConfig, { force }));
  }

  async stop() {
    this.generation += 1;
    this.halt();
    this.dropClient();
  }

  /** Gladys went away: the loop stops, everything else (client, refusal, pause) stays. */
  pause() {
    this.halt();
  }

  /** Clear every timer; the runs still in flight will not schedule again. */
  halt() {
    this.epoch += 1;
    for (const handle of this.handles) this.timers.clearTimeout(handle);
    this.handles.clear();
  }

  dropClient() {
    this.client?.close();
    this.client = null;
  }

  async run(rawConfig, { force = false } = {}) {
    const config = normalizeConfig(rawConfig);
    const key = JSON.stringify(config);
    if (!force && this.client && key === this.configKey && !this.blocked) {
      await this.resume();
      return;
    }
    this.halt();
    this.dropClient();
    const generation = ++this.generation;
    this.rawConfig = rawConfig ?? {};
    this.config = config;
    this.configKey = key;
    this.reset();
    this.lastStatus = null;
    this.gladys.forgetPublishedStates?.();

    const invalid = this.configProblem(config);
    if (invalid) {
      await this.setStatus(false, invalid);
      return;
    }
    if (force) {
      this.refusedKey = null;
      this.pausedUntil = 0;
    }
    if (this.refusedKey && this.refusedKey === credentialsKey(config)) {
      // Refused earlier with these very values: not tried again alone.
      this.blocked = true;
      await this.setStatus(false, config.username ? T.status.authRefused : T.status.authNeeded);
      return;
    }
    this.refusedKey = null;
    this.client = new GatewayClient({
      origin: config.gateway.origin,
      username: config.username,
      password: config.password,
      request: this.request,
      now: this.now,
    });
    this.logger.info(
      `Using the gateway at ${config.gateway.origin}${config.username ? ' (with credentials)' : ''}`,
    );
    if (this.paused()) {
      const delay = this.pausedUntil - this.now();
      await this.setStatus(false, T.status.busy(delay));
      this.scheduleRead(delay, generation);
      return;
    }
    await this.read(generation, this.epoch, { publish: true });
  }

  configProblem(config) {
    if (config.hostError) {
      return (
        {
          empty: T.status.hostEmpty,
          credentials: T.status.hostCredentials,
          https: T.status.hostHttps,
        }[config.hostError] ?? T.status.hostInvalid
      );
    }
    if (config.passwordWithoutUser) return T.status.passwordWithoutUser;
    if (config.credentialsInvalid) return T.status.credentialsInvalid;
    return null;
  }

  /**
   * Gladys reconnected with the same configuration: everything is published
   * again (Gladys may have lost it), the reading loop goes on where it was.
   */
  async resume() {
    this.halt();
    const generation = this.generation;
    const status = this.lastStatus ? JSON.parse(this.lastStatus) : null;
    this.lastStatus = null;
    this.transports.clear();
    this.discoveredKey = null;
    this.gladys.forgetPublishedStates?.();
    if (status) await this.setStatus(status[0], status[1]);
    if (this.heaters.size > 0) await this.publishDiscovered();
    await this.publishStates();
    await this.publishTransports();
    if (this.client && !this.blocked) {
      const wait = Math.max(this.nextReadAt, this.pausedUntil) - this.now();
      this.scheduleRead(Math.max(0, wait), generation);
    }
  }

  schedule(delay, task) {
    const handle = this.timers.setTimeout(async () => {
      this.handles.delete(handle);
      try {
        await task();
      } catch (err) {
        this.logger.error('Loop failed', err);
      }
    }, delay);
    this.handles.add(handle);
    return handle;
  }

  scheduleRead(delay, generation) {
    const epoch = this.epoch;
    this.schedule(delay, () => this.read(generation, epoch, { publish: false }));
  }

  /** May a loop of this generation and epoch go on? */
  current(generation, epoch) {
    return generation === this.generation && epoch === this.epoch && !this.blocked;
  }

  paused() {
    return this.now() < this.pausedUntil;
  }

  /** One round of the reading loop. Never throws. */
  async read(generation, epoch, { publish }) {
    if (!this.client || !this.current(generation, epoch)) return;
    this.nextReadAt = this.now() + INTERVALS.POLL_MS;
    try {
      await this.refresh({ publish });
    } catch (err) {
      // A round halted meanwhile (Gladys away, new configuration) schedules
      // nothing: the next start or resume reads again.
      if (generation === this.generation && epoch === this.epoch)
        await this.failed(err, generation);
      else this.online = false;
      return;
    }
    if (this.current(generation, epoch)) this.scheduleRead(INTERVALS.POLL_MS, generation);
  }

  /** A reading failed: final refusal, or a retry with a growing delay. */
  async failed(err, generation) {
    const wasOnline = this.online;
    this.online = false;
    this.halt();
    await this.publishTransports();
    if (isAuthRefused(err)) {
      this.blocked = true;
      this.refusedKey = credentialsKey(this.config);
      this.logger.warn('The gateway refused the credentials (HTTP 401): not retried until changed');
      await this.setStatus(
        false,
        this.config.username ? T.status.authRefused : T.status.authNeeded,
      );
      return;
    }
    let delay;
    if (err?.status === 429) {
      delay = clamp(
        err.retryAfterMs ?? INTERVALS.BUSY_MIN_MS,
        INTERVALS.BUSY_MIN_MS,
        INTERVALS.BUSY_MAX_MS,
      );
      this.pausedUntil = this.now() + delay;
    } else {
      delay = this.retryDelay;
      this.retryDelay = Math.min(this.retryDelay * 2, INTERVALS.RETRY_MAX_MS);
    }
    this.nextReadAt = this.now() + delay;
    if (wasOnline || delay === INTERVALS.RETRY_MIN_MS) {
      // Our own message: a code or an HTTP status, never the text of the answer.
      this.logger.warn(`The gateway fails: ${err?.code ?? 'error'} ${err?.message ?? ''}`.trim());
    }
    await this.setStatus(false, this.errorMessage(err, delay));
    this.scheduleRead(delay, generation);
  }

  errorMessage(err, delay) {
    if (err?.status === 429) return T.status.busy(delay);
    if (err?.status === 404) return T.status.notFound(Boolean(this.config.username), delay);
    if (err?.code === CODES.BAD_ANSWER || err?.code === CODES.TOO_LARGE) {
      return T.status.notGateway(delay);
    }
    return T.status.unreachable(err, delay);
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    await this.gladys.setConnectionStatus(connected, message).catch((err) => {
      this.lastStatus = null;
      this.logger.warn(`Connection status not sent: ${err.message}`);
    });
  }

  // --- Reading -------------------------------------------------------------------

  /**
   * Read the heater list and every boiler, publish. Resolves false when the
   * reading was dropped (a command ran meanwhile: its result is newer).
   * Throws when the heater list fails, or on a refusal (401) or a 429 of any
   * request; any other failure of a boiler is only that boiler's.
   */
  async refresh({ publish }) {
    const client = this.client;
    if (!client) return true;
    const version = this.stateVersion;
    const list = await client.heaters();
    const readings = new Map();
    for (const { index, serial } of list) {
      try {
        readings.set(serial, { index, data: await client.heater(index) });
      } catch (err) {
        if (isAuthRefused(err) || err?.status === 429) throw err;
        if (client !== this.client) return true;
        this.logger.debug(`Boiler ${index} not read: ${err?.code ?? 'error'}`);
        readings.set(serial, { index, data: null });
      }
    }
    if (client !== this.client) return true;
    if (version !== this.stateVersion || this.activeCommands > 0) return false;
    this.heaters = readings;
    this.online = true;
    this.retryDelay = INTERVALS.RETRY_MIN_MS;
    const discoveredKey = JSON.stringify(
      [...readings].map(([serial, { data }]) => [serial, data?.rooms.map((r) => r.number) ?? null]),
    );
    if (publish || discoveredKey !== this.discoveredKey) await this.publishDiscovered();
    this.discoveredKey = discoveredKey;
    await this.publishStates();
    await this.publishTransports();
    await this.setStatus(true, this.okMessage());
    return true;
  }

  okMessage() {
    if (this.heaters.size === 0) return T.status.noHeater;
    let rooms = 0;
    let down = 0;
    for (const { data } of this.heaters.values()) {
      if (data) rooms += data.rooms.length;
      else down += 1;
    }
    return T.status.ok({ heaters: this.heaters.size, rooms, down });
  }

  /** Never throws: a refusal of Gladys is not a failure of the gateway. */
  async publishDiscovered() {
    const language = this.config.language;
    const devices = [];
    for (const [serial, { data }] of this.heaters) {
      devices.push(buildHeaterDevice(this.gladys, serial, language));
      for (const room of data?.rooms ?? []) {
        devices.push(buildRoomDevice(this.gladys, serial, room.number, language));
      }
    }
    await this.gladys.publishDiscoveredDevices(devices).catch((err) => {
      this.logger.warn(`Discovery not published: ${err.message}`);
    });
  }

  /** Discovery (scan button): read again when connected, else what is known. */
  async publishDiscovery() {
    if (this.online && this.client && !this.blocked && !this.paused()) {
      const generation = this.generation;
      const applied = await this.refresh({ publish: true }).catch(async (err) => {
        if (isAuthRefused(err) || err?.status === 429) await this.failed(err, generation);
        return false;
      });
      if (applied) return;
    }
    await this.publishDiscovered();
  }

  /** The states of the created devices whose boiler answered. */
  states() {
    const created = createdDevices(this.gladys);
    const language = this.config.language;
    const states = [];
    const add = (id, value) => {
      if (value === null || value === undefined) return;
      states.push(
        typeof value === 'string'
          ? { device_feature_external_id: id, text: value }
          : { device_feature_external_id: id, state: value },
      );
    };
    for (const { serial } of created.heaters) {
      const data = this.heaters.get(serial)?.data;
      if (!data) continue; // unknown: nothing published
      const ids = heaterIds(this.gladys, serial);
      add(ids.feature(HF.WATER_TEMPERATURE), data.waterTemperature);
      add(ids.feature(HF.PRESSURE), data.pressure);
      add(ids.feature(HF.TAP_TEMPERATURE), data.tapTemperature);
      add(ids.feature(HF.BURNING), bit(data.burning));
      add(ids.feature(HF.PUMPING), bit(data.pumping));
      add(ids.feature(HF.TAPPING), bit(data.tapping));
      add(ids.feature(HF.FAILED), bit(data.failed));
      add(ids.feature(HF.STATUS), statusText(data, language));
      add(ids.feature(HF.FAULT), faultText(data, language));
    }
    for (const { serial, number } of created.rooms) {
      const data = this.heaters.get(serial)?.data;
      const room = data?.rooms.find((r) => r.number === number);
      if (!room) continue;
      const ids = roomIds(this.gladys, serial, number);
      add(ids.feature(RF.TEMPERATURE), room.temperature);
      add(ids.feature(RF.TARGET), room.target);
      add(ids.feature(RF.HEATING), bit(data.burning && data.pumping));
    }
    return states;
  }

  /** Publish what changed, within the per-minute budget. Never throws. */
  async publishStates() {
    let list = this.states();
    if (list.length === 0) return;
    const remaining = this.budget.remaining();
    if (list.length > remaining) {
      this.logger.debug(`${list.length - remaining} state(s) held back (state budget)`);
      list = list.slice(0, remaining);
    }
    try {
      const result = await this.gladys.publishChangedStates(list, {
        heartbeat: INTERVALS.HEARTBEAT_MS,
      });
      this.budget.record(result?.count ?? list.length);
    } catch (err) {
      this.logger.warn(`States not published: ${err.message}`);
    }
  }

  async publishTransports() {
    const created = createdDevices(this.gladys);
    const entries = [];
    for (const { serial, externalId } of created.heaters) {
      const reachable = this.online && Boolean(this.heaters.get(serial)?.data);
      entries.push({ external_id: externalId, transport: reachable ? 'local' : 'unreachable' });
    }
    for (const { serial, number, externalId } of created.rooms) {
      const data = this.online ? this.heaters.get(serial)?.data : null;
      const reachable = Boolean(data?.rooms.some((r) => r.number === number));
      entries.push({ external_id: externalId, transport: reachable ? 'local' : 'unreachable' });
    }
    const changed = entries.filter((e) => this.transports.get(e.external_id) !== e.transport);
    for (let start = 0; start < changed.length; start += TRANSPORTS_PER_CALL) {
      const batch = changed.slice(start, start + TRANSPORTS_PER_CALL);
      for (const entry of batch) this.transports.set(entry.external_id, entry.transport);
      await this.gladys.publishTransports(batch).catch((err) => {
        for (const entry of batch) this.transports.delete(entry.external_id);
        this.logger.debug(`Transports not published: ${err.message}`);
      });
    }
  }

  // --- Commands --------------------------------------------------------------
  //
  // The room setpoint is the only command (nothing about hot water). It is
  // refused unless the user allowed it (`allow_setpoint`, off by default),
  // checked when the command arrives AND just before it is sent; the value
  // must be 5 to 30 °C (refused, never clamped). The commands run one after
  // the other (one gateway), use the client of the moment they arrived (a new
  // configuration in between refuses them), and read the heater list and the
  // boiler from the gateway just before acting: unknown boiler or room, or a
  // reading that fails, and nothing is sent; the setpoint already there, and
  // nothing is sent either. Gladys waits 5 s: past 3.5 s after the command
  // arrived, nothing is sent any more; once sent, Gladys gets its answer at
  // most 4.3 s after the command.

  async setValue(device, feature, value) {
    const received = this.now();
    const parsed = parseExternalId(this.gladys, feature?.external_id);
    if (parsed?.kind !== 'room' || parsed.feature !== RF.TARGET) {
      throw new Error(T.errors.unknownDevice);
    }
    const temperature = Math.round(Number(value) * 10) / 10;
    if (
      typeof value === 'boolean' ||
      value === null ||
      value === '' ||
      !Number.isFinite(temperature) ||
      temperature < SETPOINT.MIN ||
      temperature > SETPOINT.MAX
    ) {
      throw new Error(T.errors.invalidValue(SETPOINT.MIN, SETPOINT.MAX));
    }
    if (!this.config.allowSetpoint) throw new Error(T.errors.controlDisabled);
    const client = this.client;
    if (!client || this.blocked) throw new Error(T.errors.notConnected);
    if (this.paused()) throw new Error(T.errors.busy);
    const generation = this.generation;
    const run = this.commands.then(() =>
      this.command(received, { client, generation, parsed, temperature }),
    );
    this.commands = run.catch(() => {});
    return run;
  }

  /** The client, the configuration and the permission are still those of the command. */
  stillValid({ client, generation }) {
    if (client !== this.client || generation !== this.generation || this.blocked) {
      throw new Error(T.errors.configChanged);
    }
    if (!this.config.allowSetpoint) throw new Error(T.errors.controlDisabled);
    if (this.paused()) throw new Error(T.errors.busy);
  }

  /** A failure of the gateway met by a command: a 429 or a 401 applies to every path. */
  async shared(err, generation) {
    if (err?.status === 429 || isAuthRefused(err)) await this.failed(err, generation);
  }

  async command(received, { client, generation, parsed, temperature }) {
    this.activeCommands += 1;
    this.stateVersion += 1;
    try {
      this.stillValid({ client, generation });
      const deadline = received + COMMAND_BUDGET_MS;
      if (deadline - this.now() < COMMAND_MIN_READ_MS) throw new Error(T.errors.tooSlow);
      const readDeadline = deadline - COMMAND_MIN_SEND_MS;
      let index;
      let data;
      try {
        const list = await client.heaters({ deadline: readDeadline });
        index = list.find((h) => h.serial === parsed.serial)?.index;
        if (index === undefined) throw new Error(T.errors.unknownHeater);
        data = await client.heater(index, { deadline: readDeadline });
      } catch (err) {
        if (err?.message === T.errors.unknownHeater) throw err;
        await this.shared(err, generation);
        throw new Error(T.errors.unknownState(err), { cause: err });
      }
      this.observed(parsed.serial, index, data);
      const room = data.rooms.find((r) => r.number === parsed.number);
      if (!room) {
        await this.publishStates();
        throw new Error(T.errors.unknownRoom);
      }
      if (room.target !== null && Math.abs(room.target - temperature) < SETPOINT.STEP / 2) {
        await this.publishStates();
        return;
      }
      if (deadline - this.now() < COMMAND_MIN_SEND_MS) throw new Error(T.errors.tooSlow);
      // The last check before acting: the user may have changed things meanwhile.
      this.stillValid({ client, generation });
      await this.send({ client, generation, parsed, index, temperature, received, deadline });
    } finally {
      this.stateVersion += 1;
      this.activeCommands -= 1;
    }
  }

  /** Send, then answer Gladys on the gateway's answer or at COMMAND_ACK_MS, whichever first. */
  async send({ client, generation, parsed, index, temperature, received, deadline }) {
    let sent = false;
    const request = client.setSetpoint(index, parsed.number, temperature, {
      deadline,
      onSent: () => {
        sent = true;
      },
    });
    let handle;
    const ack = new Promise((resolve) => {
      handle = this.timers.setTimeout(resolve, Math.max(0, received + COMMAND_ACK_MS - this.now()));
    });
    const outcome = await Promise.race([
      request.then(
        (data) => ({ done: true, data }),
        (err) => ({ err }),
      ),
      ack.then(() => ({ pending: true })),
    ]);
    this.timers.clearTimeout(handle);
    const label = `Setpoint of room ${parsed.number} of ${parsed.serial}`;
    if (outcome.done) {
      if (outcome.data) this.observed(parsed.serial, index, outcome.data);
      this.logger.info(`${label} sent`);
      if (generation === this.generation) await this.publishStates();
      return;
    }
    if (outcome.pending) {
      // Sent, the gateway still at work: Gladys is answered now, the state follows.
      this.logger.info(`${label} sent, the gateway has not answered yet`);
      request.then(
        async (data) => {
          if (generation !== this.generation) return;
          if (data) this.observed(parsed.serial, index, data);
          await this.publishStates();
        },
        (err) => this.logger.warn(`${label} not confirmed: ${err?.code ?? 'error'}`),
      );
      return;
    }
    const { err } = outcome;
    await this.shared(err, generation);
    if (err?.notSent || !sent) throw new Error(T.errors.notSent(err), { cause: err });
    throw new Error(T.errors.refused(err), { cause: err });
  }

  /** What a command just read, until the next reading. */
  observed(serial, index, data) {
    if (!this.online || !this.heaters.has(serial)) return;
    this.heaters.set(serial, { index, data });
  }

  // --- Devices created / deleted in Gladys -----------------------------------

  async deviceCreated(device) {
    if (!parseExternalId(this.gladys, device?.external_id) || !this.online) return;
    await this.publishStates();
    await this.publishTransports();
  }

  deviceDeleted(device) {
    this.transports.delete(device?.external_id);
  }

  // --- Configuration button --------------------------------------------------

  /** Resolves `promise`, or rejects with `message` after `ms`. */
  within(promise, ms, message) {
    let handle;
    const limit = new Promise((_, reject) => {
      handle = this.timers.setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, limit]).finally(() => this.timers.clearTimeout(handle));
  }

  /** Reconnects (refused credentials included: the user asked), then reports, within 25 s. */
  async testConnection() {
    await this.within(
      this.start(this.rawConfig, { force: true }),
      TEST_BUDGET_MS,
      T.errors.testTooLong,
    );
    if (!this.online) {
      const message = this.lastStatus ? JSON.parse(this.lastStatus)[1] : null;
      throw new Error(message?.en ?? T.errors.notConnected);
    }
    let rooms = 0;
    for (const { data } of this.heaters.values()) rooms += data?.rooms.length ?? 0;
    return T.test.ok({ heaters: this.heaters.size, rooms });
  }
}
