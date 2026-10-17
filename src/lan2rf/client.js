// -----------------------------------------------------------------------------
// The local HTTP interface of the Intergas Lan2RF (InComfort) gateway:
//   GET /heaterlist.json                                   the bound boilers
//   GET /data.json?heater=<index>                          one boiler and its rooms
//   GET /data.json?heater=<index>&thermostat=<0|1>&setpoint=<(T - 5) * 10>
//                                                          room setpoint (answers the data)
// Newer gateways want HTTP basic authentication and the same paths under
// /protect/ (incomfort-client): with a user name, every request goes there.
// The Authorization header is the only place the credentials go (never a URL,
// never a log). Plain HTTP: the gateway has no TLS.
// -----------------------------------------------------------------------------

import { MAX_BYTES, SETPOINT, TIMEOUTS } from '../constants.js';
import { CODES, GatewayError } from './errors.js';
import { httpRequest } from './http.js';
import { parseHeaterData, parseHeaterList, parseJson } from './parse.js';

/** Room a request needs before its deadline, or it is not sent at all. */
const MIN_SEND_MS = 300;

/** Seconds of a Retry-After header (delta form only), in ms, or null. */
const retryAfterMs = (value) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !/^\d{1,6}$/.test(raw.trim())) return null;
  return Number(raw.trim()) * 1000;
};

const notSent = (err) => {
  if (err && typeof err === 'object') err.notSent = true;
  return err;
};

/** The `setpoint=` of a temperature: tenths of a degree above 5 °C. */
export const encodeSetpoint = (temperature) => Math.round((temperature - SETPOINT.MIN) * 10);

export class GatewayClient {
  /**
   * @param {object} options
   * @param {string} options.origin `http://host:port`
   * @param {string} [options.username] empty: the open paths
   * @param {string} [options.password]
   * @param {Function} [options.request] the HTTP transport (tests inject a fake gateway)
   * @param {() => number} [options.now]
   */
  constructor({ origin, username = '', password = '', request = httpRequest, now = Date.now }) {
    this.base = username ? `${origin}/protect/` : `${origin}/`;
    this.headers = username
      ? { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }
      : {};
    this.request = request;
    this.now = now;
    this.closed = false;
  }

  close() {
    this.closed = true;
  }

  timeoutFor(deadline) {
    if (deadline === undefined) return TIMEOUTS.REQUEST;
    const remaining = deadline - this.now();
    if (remaining < MIN_SEND_MS) {
      throw notSent(new GatewayError(CODES.NO_TIME, 'No time left: request not sent'));
    }
    return Math.min(TIMEOUTS.REQUEST, remaining);
  }

  /** One GET; resolves the parsed JSON, rejects a GatewayError. */
  async get(path, query, { deadline, sendDeadline, onSent } = {}) {
    if (this.closed) throw notSent(new GatewayError(CODES.CLOSED, 'Client closed'));
    const url = new URL(path, this.base);
    if (query) url.search = new URLSearchParams(query).toString();
    const timeout = this.timeoutFor(deadline);
    let sendWithin;
    if (sendDeadline !== undefined) {
      sendWithin = sendDeadline - this.now();
      if (sendWithin < MIN_SEND_MS) {
        throw notSent(new GatewayError(CODES.NO_TIME, 'No time left: request not sent'));
      }
    }
    const response = await this.request(url.toString(), {
      headers: this.headers,
      timeout,
      sendWithin,
      maxBytes: MAX_BYTES,
      onSent,
    });
    if (response.status < 200 || response.status > 299) {
      throw new GatewayError(CODES.HTTP, `HTTP ${response.status}`, {
        status: response.status,
        retryAfterMs: retryAfterMs(response.headers?.['retry-after']),
      });
    }
    const json = parseJson(response.body?.toString('utf8') ?? '');
    if (json === null) throw new GatewayError(CODES.BAD_ANSWER, 'Not JSON');
    return json;
  }

  /** The bound boilers: [{ index, serial }]. */
  async heaters(options) {
    const parsed = parseHeaterList(await this.get('heaterlist.json', undefined, options));
    if (!parsed) throw new GatewayError(CODES.BAD_ANSWER, 'Not a heater list');
    return parsed;
  }

  /** The state of the boiler at `index` and of its rooms. */
  async heater(index, options) {
    const parsed = parseHeaterData(await this.get('data.json', { heater: String(index) }, options));
    if (!parsed) throw new GatewayError(CODES.BAD_ANSWER, 'Not the data of a boiler');
    return parsed;
  }

  /**
   * Set the setpoint of room 1 or 2 of the boiler at `index`; resolves the
   * data the gateway answers (or null when it is not readable: the command was
   * taken anyway). The caller checked the range; checked again here.
   */
  async setSetpoint(index, room, temperature, { deadline, onSent } = {}) {
    if (!(temperature >= SETPOINT.MIN && temperature <= SETPOINT.MAX)) {
      throw notSent(new Error('Setpoint out of range: not sent'));
    }
    if (room !== 1 && room !== 2) throw notSent(new Error('Unknown room: not sent'));
    // The deadline bounds the moment it is SENT; the answer may come later.
    const json = await this.get(
      'data.json',
      {
        heater: String(index),
        thermostat: String(room - 1),
        setpoint: String(encodeSetpoint(temperature)),
      },
      { sendDeadline: deadline, onSent },
    );
    return parseHeaterData(json);
  }
}
